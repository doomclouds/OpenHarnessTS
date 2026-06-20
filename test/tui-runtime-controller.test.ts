import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createApiMessageCompleteEvent,
  createApiTextDeltaEvent,
  createAssistantMessage,
  createTextBlock,
  createToolUseBlock,
  type ApiClient,
  type ApiMessageRequest,
  type ApiStreamEvent,
  type ExportSessionTranscriptArgs,
  type ListSessionsOptions,
  type SaveSessionSnapshotArgs,
  type SessionBackend,
  type SessionSnapshot,
  type SessionSummary
} from "../src/index.js";
import type { TuiEvent } from "../src/tui/model/index.js";
import { runTuiRuntimeTurn } from "../src/tui/runtime/index.js";

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

class ThrowingApiClient implements ApiClient {
  public async *streamMessage(): AsyncIterable<ApiStreamEvent> {
    throw new Error("network down");
  }
}

async function makeTempProject(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

describe("TUI runtime controller", () => {
  it("runs a fake-provider runtime turn and dispatches TUI events with session artifacts", async () => {
    const root = await makeTempProject("openharness-tui-runtime-");
    const homeDir = join(root, "home");
    const cwd = join(root, "project");
    const events: TuiEvent[] = [];
    const client = new ScriptedApiClient([
      [
        createApiTextDeltaEvent("Hello"),
        createApiTextDeltaEvent(" from runtime."),
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("Hello from runtime.")])
        })
      ]
    ]);

    try {
      const result = await runTuiRuntimeTurn({
        prompt: "Say hello",
        apiClient: client,
        model: "fake-model",
        cwd,
        homeDir,
        env: {},
        sessionId: "sess_tui_runtime",
        onEvent(event) {
          events.push(event);
        }
      });

      expect(client.requests).toHaveLength(1);
      expect(client.requests[0]?.messages.at(-1)?.role).toBe("user");
      expect(events).toContainEqual({
        type: "turn_started",
        busyLabel: "Thinking..."
      });
      expect(events).toContainEqual({
        type: "assistant_delta",
        text: "Hello"
      });
      expect(events).toContainEqual({
        type: "assistant_delta",
        text: " from runtime."
      });
      expect(events).toContainEqual({
        type: "assistant_complete",
        text: "Hello from runtime."
      });
      expect(events.at(-1)).toMatchObject({
        type: "line_complete",
        artifacts: {
          sessionId: "sess_tui_runtime"
        }
      });
      expect(result.artifacts.sessionId).toBe("sess_tui_runtime");
      expect(result.artifacts.latestPath).toContain("latest.json");
      expect(result.artifacts.transcriptPath).toContain("sess_tui_runtime");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dispatches tool trace events from the real runtime loop", async () => {
    const root = await makeTempProject("openharness-tui-runtime-tools-");
    const homeDir = join(root, "home");
    const cwd = join(root, "project");
    const events: TuiEvent[] = [];
    const client = new ScriptedApiClient([
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([
            createToolUseBlock({
              id: "toolu_grep",
              name: "grep",
              input: {
                pattern: "OpenHarness",
                root: "."
              }
            })
          ])
        })
      ],
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("Tool run complete.")])
        })
      ]
    ]);

    try {
      await mkdir(cwd, { recursive: true });
      await writeFile(join(cwd, "README.md"), "OpenHarness runtime test\n", "utf8");

      await runTuiRuntimeTurn({
        prompt: "Search for OpenHarness",
        apiClient: client,
        model: "fake-model",
        cwd,
        homeDir,
        env: {},
        sessionId: "sess_tui_tools",
        onEvent(event) {
          events.push(event);
        }
      });

      expect(events).toContainEqual({
        type: "tool_started",
        item: {
          kind: "tool_trace",
          toolName: "grep",
          inputSummary: "pattern: OpenHarness",
          status: "running",
          toolUseId: "toolu_grep"
        }
      });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool_completed",
            item: expect.objectContaining({
              kind: "tool_trace",
              toolName: "grep",
              status: expect.stringMatching(/completed|failed/u),
              toolUseId: "toolu_grep"
            })
          })
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the injected fake provider without requiring environment API keys", async () => {
    const root = await makeTempProject("openharness-tui-runtime-no-network-");
    const client = new ScriptedApiClient([
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("No network.")])
        })
      ]
    ]);

    try {
      const result = await runTuiRuntimeTurn({
        prompt: "Use fake provider",
        apiClient: client,
        model: "fake-model",
        cwd: join(root, "project"),
        homeDir: join(root, "home"),
        env: {},
        sessionId: "sess_no_network",
        onEvent() {
          return undefined;
        }
      });

      expect(client.requests).toHaveLength(1);
      expect(result.sessionId).toBe("sess_no_network");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dispatches TUI error events and rejects when the runtime fails", async () => {
    const root = await makeTempProject("openharness-tui-runtime-error-");
    const events: TuiEvent[] = [];

    try {
      await expect(
        runTuiRuntimeTurn({
          prompt: "Fail",
          apiClient: new ThrowingApiClient(),
          model: "fake-model",
          cwd: join(root, "project"),
          homeDir: join(root, "home"),
          env: {},
          onEvent(event) {
            events.push(event);
          }
        })
      ).rejects.toThrow("API error: network down");

      expect(events).toContainEqual({
        type: "error",
        message: "API error: network down",
        detail: "Non-recoverable runtime error"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dispatches an error, rejects, and omits line_complete artifacts when saveSnapshot fails", async () => {
    const root = await makeTempProject("openharness-tui-runtime-save-fail-");
    const events: TuiEvent[] = [];
    const client = new ScriptedApiClient([
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("Save later.")])
        })
      ]
    ]);

    try {
      await expect(
        runTuiRuntimeTurn({
          prompt: "Fail save",
          apiClient: client,
          model: "fake-model",
          cwd: join(root, "project"),
          homeDir: join(root, "home"),
          env: {},
          sessionId: "sess_save_fail",
          sessionBackend: createFailingSessionBackend({
            saveError: new Error("save failed")
          }),
          onEvent(event) {
            events.push(event);
          }
        })
      ).rejects.toThrow("save failed");

      expect(events).toContainEqual({
        type: "error",
        message: "save failed"
      });
      expect(events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "line_complete",
            artifacts: expect.anything()
          })
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dispatches an error, rejects, and omits line_complete artifacts when exportTranscript fails", async () => {
    const root = await makeTempProject("openharness-tui-runtime-export-fail-");
    const events: TuiEvent[] = [];
    const client = new ScriptedApiClient([
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("Export later.")])
        })
      ]
    ]);

    try {
      await expect(
        runTuiRuntimeTurn({
          prompt: "Fail export",
          apiClient: client,
          model: "fake-model",
          cwd: join(root, "project"),
          homeDir: join(root, "home"),
          env: {},
          sessionId: "sess_export_fail",
          sessionBackend: createFailingSessionBackend({
            exportError: new Error("export failed")
          }),
          onEvent(event) {
            events.push(event);
          }
        })
      ).rejects.toThrow("export failed");

      expect(events).toContainEqual({
        type: "error",
        message: "export failed"
      });
      expect(events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "line_complete",
            artifacts: expect.anything()
          })
        ])
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createFailingSessionBackend(options: {
  readonly saveError?: Error;
  readonly exportError?: Error;
}): SessionBackend {
  return {
    async saveSnapshot(args: SaveSessionSnapshotArgs): Promise<SessionSnapshot> {
      if (options.saveError !== undefined) {
        throw options.saveError;
      }

      return createSnapshot(args);
    },
    async loadLatest(): Promise<SessionSnapshot | undefined> {
      return undefined;
    },
    async loadById(): Promise<SessionSnapshot | undefined> {
      return undefined;
    },
    async listRecent(
      _cwd: string | URL,
      _options?: ListSessionsOptions
    ): Promise<readonly SessionSummary[]> {
      return [];
    },
    async exportTranscript(args: ExportSessionTranscriptArgs): Promise<string> {
      if (options.exportError !== undefined) {
        throw options.exportError;
      }

      return join(String(args.cwd), `${args.sessionId}.md`);
    }
  };
}

function createSnapshot(args: SaveSessionSnapshotArgs): SessionSnapshot {
  return {
    sessionId: args.sessionId ?? "sess_generated",
    cwd: String(args.cwd),
    model: args.model,
    systemPrompt: args.systemPrompt,
    messages: [...args.messages],
    ...(args.usage === undefined ? {} : { usage: args.usage }),
    toolMetadata: args.toolMetadata ?? {},
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:01.000Z",
    summary: "summary",
    messageCount: args.messages.length,
    path: join(String(args.cwd), `session-${args.sessionId ?? "sess_generated"}.jsonl`)
  };
}
