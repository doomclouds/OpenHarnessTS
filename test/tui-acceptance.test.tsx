import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import {
  createApiMessageCompleteEvent,
  createApiTextDeltaEvent,
  createAssistantMessage,
  createTextBlock,
  type ApiClient,
  type ApiMessageRequest,
  type ApiStreamEvent
} from "../src/index.js";
import { TuiRuntimeApp } from "../src/tui/index.js";

describe("deterministic TUI acceptance", () => {
  it("starts, submits a Chinese prompt, streams a fake response, and shows saved session feedback", async () => {
    const root = await mkdtemp(join(tmpdir(), "openharness-tui-acceptance-"));
    const client = new ScriptedApiClient([
      [
        createApiTextDeltaEvent("收到"),
        createApiTextDeltaEvent("，正在整理。"),
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("收到，正在整理。")])
        })
      ]
    ]);

    try {
      const { stdin, lastFrame } = render(
        <TuiRuntimeApp
          apiClient={client}
          model="fake-model"
          cwd={join(root, "project")}
          homeDir={join(root, "home")}
          env={{}}
          sessionId="sess_tui_acceptance"
          colorMode="none"
          width={72}
        />
      );

      expect(lastFrame()).toContain("OpenHarness");
      expect(lastFrame()).toContain("alpha tui - interactive session");
      expect(lastFrame()).toContain("/ for commands");

      stdin.write("请总结当前项目状态");
      stdin.write("\r");

      await waitUntil(() => {
        const output = lastFrame() ?? "";
        expect(client.requests).toHaveLength(1);
        expect(client.requests[0]?.messages.at(-1)).toMatchObject({
          role: "user",
          content: [
            {
              type: "text",
              text: "请总结当前项目状态"
            }
          ]
        });
        expect(output).toContain("> 请总结当前项目状态");
        expect(output).toContain("* OpenHarness");
        expect(output).toContain("收到，正在整理。");
        expect(output).toContain("Session saved: sess_tui_acceptance");
        expect(output).not.toContain("\u001B[");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps /help, /status, /clear, and /exit usable in the runtime shell", async () => {
    const exitRequests: string[] = [];
    const { stdin, lastFrame } = render(
      <TuiRuntimeApp
        apiClient={new ScriptedApiClient([])}
        model="fake-model"
        cwd="."
        colorMode="none"
        width={72}
        onExitRequested={() => exitRequests.push("exit")}
      />
    );

    stdin.write("/help");
    stdin.write("\r");

    await waitUntil(() => {
      expect(lastFrame()).toContain(
        "Commands: /help show shortcuts, /status show display status"
      );
    });

    stdin.write("/status");
    stdin.write("\r");

    await waitUntil(() => {
      const output = lastFrame() ?? "";
      expect(output).toContain("Status: idle");
      expect(output).toContain("model fake-model");
    });

    stdin.write("/clear");
    stdin.write("\r");

    await waitUntil(() => {
      const output = lastFrame() ?? "";
      expect(output).toContain("Welcome to OpenHarness");
      expect(output).not.toContain("Commands: /help show shortcuts");
      expect(output).not.toContain("Status: idle");
    });

    stdin.write("/exit");
    stdin.write("\r");

    await waitUntil(() => {
      expect(exitRequests).toEqual(["exit"]);
    });
  });

  it("keeps busy interrupt deterministic with a fake abort-aware provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "openharness-tui-interrupt-"));
    const client = new AbortAwareApiClient();
    let unmount: (() => void) | undefined;

    try {
      const rendered = render(
        <TuiRuntimeApp
          apiClient={client}
          model="fake-model"
          cwd={join(root, "project")}
          homeDir={join(root, "home")}
          env={{}}
          sessionId="sess_tui_interrupt_acceptance"
          colorMode="none"
          width={72}
        />
      );
      const { stdin, lastFrame } = rendered;
      unmount = rendered.unmount;

      stdin.write("interrupt this turn");
      stdin.write("\r");
      const signal = await client.requestReceived;

      await waitUntil(() => {
        expect(lastFrame()).toContain("Thinking...");
      });

      stdin.write("\u001B[27u");

      await waitUntil(() => {
        expect(signal?.aborted).toBe(true);
        expect(lastFrame()).toContain("API error: provider aborted");
      });
    } finally {
      unmount?.();
      await rm(root, { recursive: true, force: true });
    }
  });
});

class ScriptedApiClient implements ApiClient {
  public readonly requests: ApiMessageRequest[] = [];

  public constructor(
    private readonly turns: readonly (readonly ApiStreamEvent[])[]
  ) {}

  public async *streamMessage(
    request: ApiMessageRequest
  ): AsyncIterable<ApiStreamEvent> {
    this.requests.push({
      ...request,
      messages: [...request.messages],
      ...(request.tools === undefined ? {} : { tools: [...request.tools] })
    });

    const turn = this.turns[this.requests.length - 1];
    if (turn === undefined) {
      throw new Error(`No scripted turn ${this.requests.length}.`);
    }

    for (const event of turn) {
      yield event;
    }
  }
}

class AbortAwareApiClient implements ApiClient {
  public readonly requestReceived: Promise<AbortSignal | undefined>;

  private resolveRequest: (signal: AbortSignal | undefined) => void = () => {};

  public constructor() {
    this.requestReceived = new Promise((resolve) => {
      this.resolveRequest = resolve;
    });
  }

  public async *streamMessage(
    request: ApiMessageRequest
  ): AsyncIterable<ApiStreamEvent> {
    this.resolveRequest(request.signal);

    if (request.signal === undefined) {
      throw new Error("missing request signal");
    }

    await new Promise<void>((resolve, reject) => {
      if (request.signal?.aborted === true) {
        reject(new Error("provider aborted"));
        return;
      }

      const timeout = setTimeout(resolve, 5_000);
      request.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new Error("provider aborted"));
        },
        { once: true }
      );
    });

    yield createApiMessageCompleteEvent({
      message: createAssistantMessage([createTextBlock("not aborted")])
    });
  }
}

async function waitUntil(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}
