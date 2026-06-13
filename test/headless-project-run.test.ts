import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProjectRuntime,
  createAssistantMessage,
  createTextBlock,
  createToolUseBlock,
  getMessageText,
  isToolResultBlock
} from "../src/index.js";
import type {
  ApiClient,
  ApiMessageRequest,
  ApiStreamEvent,
  ConversationMessage,
  StreamEvent,
  ToolResultBlock
} from "../src/index.js";

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
      throw new Error(`No scripted turn ${this.requests.length}`);
    }

    for (const event of turn) {
      yield event;
    }
  }
}

async function makeTempProject(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function removeTempProject(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

function textComplete(text: string): ApiStreamEvent {
  return {
    type: "message_complete",
    message: createAssistantMessage([createTextBlock(text)])
  };
}

function assistantToolUse(args: {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}): ApiStreamEvent {
  return {
    type: "message_complete",
    message: createAssistantMessage([
      createToolUseBlock({
        id: args.id,
        name: args.name,
        input: args.input
      })
    ])
  };
}

async function collectEvents(
  iterable: AsyncIterable<StreamEvent>
): Promise<readonly StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

function getToolResults(
  messages: readonly ConversationMessage[]
): readonly ToolResultBlock[] {
  return messages.flatMap((message) =>
    message.content.filter(isToolResultBlock)
  );
}

function requireFirstRequest(
  requests: readonly ApiMessageRequest[]
): ApiMessageRequest {
  const request = requests[0];
  if (request === undefined) {
    throw new Error("Expected at least one API request.");
  }

  return request;
}

describe("headless project run acceptance", () => {
  it("runs a fixture project turn with default tools and persists a session snapshot", async () => {
    const root = await makeTempProject("openharness-headless-run-");
    const cwd = join(root, "fixture-project");
    const homeDir = join(root, "home");
    const configDir = join(root, "config");

    try {
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(
        join(cwd, "AGENTS.md"),
        [
          "# Fixture Agent Instructions",
          "",
          "Always mention the ALPHA_TARGET marker when summarizing this project.",
          ""
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(cwd, "README.md"),
        "# Fixture Project\n\nThis project exists for headless acceptance.\n",
        "utf8"
      );
      await writeFile(
        join(cwd, "src", "alpha.ts"),
        [
          "export const ALPHA_TARGET = \"headless acceptance\";",
          "export function describeAlpha(): string {",
          "  return ALPHA_TARGET;",
          "}",
          ""
        ].join("\n"),
        "utf8"
      );

      const client = new ScriptedApiClient([
        [
          assistantToolUse({
            id: "toolu_glob",
            name: "glob",
            input: { pattern: "src/**/*.ts", limit: 10 }
          })
        ],
        [
          assistantToolUse({
            id: "toolu_grep",
            name: "grep",
            input: {
              pattern: "ALPHA_TARGET",
              glob: "src/**/*.ts",
              headLimit: 10
            }
          })
        ],
        [
          assistantToolUse({
            id: "toolu_read",
            name: "read_file",
            input: { path: "src/alpha.ts", limit: 20 }
          })
        ],
        [textComplete("ALPHA_TARGET is defined in src/alpha.ts.")]
      ]);
      const runtime = buildProjectRuntime({
        cwd,
        homeDir,
        env: {
          OPENHARNESS_CONFIG_DIR: configDir
        },
        apiClient: client,
        model: "mock-model",
        sessionId: "headless_acceptance"
      });

      const events = await collectEvents(
        runtime.engine.submitMessage(
          "Inspect the fixture project and identify ALPHA_TARGET."
        )
      );
      const messages = runtime.engine.getMessages();
      const toolResults = getToolResults(messages);
      const snapshot = await runtime.sessionBackend.saveSnapshot({
        cwd: runtime.cwd,
        sessionId: runtime.sessionId,
        model: runtime.engine.getModel(),
        systemPrompt: runtime.engine.getSystemPrompt(),
        messages,
        toolMetadata: runtime.engine.getToolMetadata(),
        createdAt: "2026-06-13T00:00:00.000Z",
        updatedAt: "2026-06-13T00:00:01.000Z"
      });
      const latest = await runtime.sessionBackend.loadLatest(runtime.cwd);
      const byId = await runtime.sessionBackend.loadById(
        runtime.cwd,
        runtime.sessionId
      );
      const transcriptPath = await runtime.sessionBackend.exportTranscript({
        cwd: runtime.cwd,
        sessionId: runtime.sessionId
      });
      const transcript = await readFile(transcriptPath, "utf8");
      const firstRequest = requireFirstRequest(client.requests);

      expect(runtime.cwd).toBe(resolve(cwd));
      expect(runtime.prompt.projectInstructions?.section).toContain(
        "ALPHA_TARGET marker"
      );
      expect(client.requests).toHaveLength(4);
      expect(firstRequest.systemPrompt).toContain(
        "ALPHA_TARGET marker"
      );
      expect(firstRequest.tools?.map((tool) => tool.name)).toEqual([
        "read_file",
        "glob",
        "grep"
      ]);
      expect(events.map((event) => event.type)).toEqual([
        "assistant_turn_complete",
        "tool_execution_started",
        "tool_execution_completed",
        "assistant_turn_complete",
        "tool_execution_started",
        "tool_execution_completed",
        "assistant_turn_complete",
        "tool_execution_started",
        "tool_execution_completed",
        "assistant_turn_complete"
      ]);
      expect(toolResults).toHaveLength(3);
      expect(toolResults.map((result) => result.toolUseId)).toEqual([
        "toolu_glob",
        "toolu_grep",
        "toolu_read"
      ]);
      expect(toolResults.every((result) => !result.isError)).toBe(true);
      expect(toolResults[0]?.content).toContain("src/alpha.ts");
      expect(toolResults[1]?.content).toContain("ALPHA_TARGET");
      expect(toolResults[2]?.content).toContain("headless acceptance");
      expect(getMessageText(messages.at(-1) as ConversationMessage)).toContain(
        "ALPHA_TARGET"
      );
      expect(snapshot).toMatchObject({
        sessionId: "headless_acceptance",
        cwd: resolve(cwd),
        model: "mock-model",
        systemPrompt: runtime.prompt.prompt,
        messageCount: messages.length,
        toolMetadata: {
          sessionId: "headless_acceptance",
          projectCwd: resolve(cwd)
        }
      });
      expect(latest?.sessionId).toBe("headless_acceptance");
      expect(byId?.messages).toEqual(messages);
      expect(transcript).toContain("Inspect the fixture project");
      expect(transcript).toContain("ALPHA_TARGET is defined in src/alpha.ts.");
    } finally {
      await removeTempProject(root);
    }
  });
});
