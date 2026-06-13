import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProjectRuntime,
  createAssistantMessage,
  createTextBlock,
  createToolResult,
  createToolUseBlock,
  FileSessionBackend,
  getMessageText,
  InMemoryHookExecutor,
  isToolResultBlock,
  PermissionChecker,
  ToolRegistry
} from "../src/index.js";
import type {
  ApiClient,
  ApiMessageRequest,
  ApiStreamEvent,
  BuildProjectRuntimeOptions,
  ConversationMessage,
  ExportSessionTranscriptArgs,
  ListSessionsOptions,
  ProjectRuntimeBundle,
  SaveSessionSnapshotArgs,
  SessionBackend,
  SessionSnapshot,
  SessionSummary,
  StreamEvent,
  ToolDefinition
} from "../src/index.js";

type RootProjectRuntimeTypeExports = {
  readonly options: BuildProjectRuntimeOptions;
  readonly bundle: ProjectRuntimeBundle;
};

class ScriptedApiClient implements ApiClient {
  public readonly requests: ApiMessageRequest[] = [];
  private readonly turns: readonly (readonly ApiStreamEvent[])[];

  public constructor(turns: readonly (readonly ApiStreamEvent[])[]) {
    this.turns = turns;
  }

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

class FakeSessionBackend implements SessionBackend {
  public readonly saved: SaveSessionSnapshotArgs[] = [];

  public async saveSnapshot(
    args: SaveSessionSnapshotArgs
  ): Promise<SessionSnapshot> {
    this.saved.push(args);
    return {
      sessionId: args.sessionId ?? "fake-session",
      cwd: String(args.cwd),
      model: args.model,
      systemPrompt: args.systemPrompt,
      messages: [...args.messages],
      toolMetadata: args.toolMetadata ?? {},
      createdAt: args.createdAt ?? "2026-06-13T00:00:00.000Z",
      updatedAt: args.updatedAt ?? "2026-06-13T00:00:00.000Z",
      summary: "",
      messageCount: args.messages.length,
      path: "fake-session.jsonl",
      ...(args.usage === undefined ? {} : { usage: args.usage })
    };
  }

  public async loadLatest(): Promise<SessionSnapshot | undefined> {
    return undefined;
  }

  public async loadById(): Promise<SessionSnapshot | undefined> {
    return undefined;
  }

  public async listRecent(
    _cwd: string | URL,
    _options: ListSessionsOptions = {}
  ): Promise<readonly SessionSummary[]> {
    return [];
  }

  public async exportTranscript(
    _args: ExportSessionTranscriptArgs
  ): Promise<string> {
    return "fake-transcript.md";
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
  readonly input?: Readonly<Record<string, unknown>>;
}): ApiStreamEvent {
  return {
    type: "message_complete",
    message: createAssistantMessage([
      createToolUseBlock(
        args.input === undefined
          ? {
              id: args.id,
              name: args.name
            }
          : {
              id: args.id,
              name: args.name,
              input: args.input
            }
      )
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

function getToolResultMessage(
  messages: readonly ConversationMessage[]
): ConversationMessage {
  const message = messages.find((candidate) =>
    candidate.content.some(isToolResultBlock)
  );

  if (message === undefined) {
    throw new Error("Expected a tool result message.");
  }

  return message;
}

function createEchoTool(): ToolDefinition {
  return {
    name: "echo",
    description: "Echoes text.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" }
      },
      required: ["value"],
      additionalProperties: false
    },
    isReadOnly() {
      return true;
    },
    execute(input) {
      const value =
        typeof input === "object" &&
        input !== null &&
        typeof (input as { readonly value?: unknown }).value === "string"
          ? (input as { readonly value: string }).value
          : "";

      return createToolResult({ output: value });
    }
  };
}

describe("buildProjectRuntime", () => {
  it("builds a runtime with resolved cwd, project paths, prompt metadata, and a session id", async () => {
    const cwd = await makeTempProject("openharness-project-runtime-");
    try {
      const client = new ScriptedApiClient([[textComplete("ready")]]);
      const runtime = buildProjectRuntime({
        cwd,
        apiClient: client,
        model: "mock-model",
        env: {
          OPENHARNESS_CONFIG_DIR: join(cwd, ".config")
        },
        homeDir: cwd
      });

      expect(runtime.cwd).toBe(resolve(cwd));
      expect(runtime.paths.cwd).toBe(resolve(cwd));
      expect(runtime.paths.projectConfigDir).toBe(join(resolve(cwd), ".openharness"));
      expect(runtime.sessionId).toMatch(/^[A-Za-z0-9_-]+$/u);
      expect(runtime.prompt.prompt).toContain("# Permission Mode");
      expect(runtime.prompt.permissionMode).toBe("default");
      expect(runtime.engine.getCwd()).toBe(resolve(cwd));
      expect(runtime.engine.getModel()).toBe("mock-model");
      expect(runtime.engine.getSystemPrompt()).toBe(runtime.prompt.prompt);
      expect(runtime.engine.getToolMetadata()).toEqual({
        sessionId: runtime.sessionId,
        projectCwd: resolve(cwd)
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("defaults cwd to the process current directory when omitted", () => {
    const runtime = buildProjectRuntime({
      apiClient: new ScriptedApiClient([[textComplete("ready")]]),
      model: "mock-model",
      includeDefaultProjectTools: false
    });

    expect(runtime.cwd).toBe(resolve(process.cwd()));
    expect(runtime.paths.cwd).toBe(resolve(process.cwd()));
  });

  it("requires an options object, apiClient, and a non-empty model", () => {
    expect(() => buildProjectRuntime(undefined as never)).toThrow(
      "BuildProjectRuntime options are required."
    );
    expect(() =>
      buildProjectRuntime({
        model: "mock-model"
      } as never)
    ).toThrow("buildProjectRuntime apiClient is required.");
    expect(() =>
      buildProjectRuntime({
        apiClient: new ScriptedApiClient([[textComplete("ready")]]),
        model: "   "
      })
    ).toThrow("buildProjectRuntime model is required.");
  });

  it("rejects conflicting tool and prompt options", () => {
    const client = new ScriptedApiClient([[textComplete("ready")]]);
    const registry = new ToolRegistry();

    expect(() =>
      buildProjectRuntime({
        apiClient: client,
        model: "mock-model",
        tools: [createEchoTool()],
        toolRegistry: registry
      })
    ).toThrow("BuildProjectRuntime options cannot include both toolRegistry and tools.");

    expect(() =>
      buildProjectRuntime({
        apiClient: client,
        model: "mock-model",
        systemPrompt: "exact",
        customSystemPrompt: "custom"
      })
    ).toThrow(
      "BuildRuntimePrompt options cannot include both systemPrompt and customSystemPrompt."
    );
  });

  it("accepts an explicit session id and rejects invalid session ids", () => {
    const client = new ScriptedApiClient([[textComplete("ready")]]);
    const runtime = buildProjectRuntime({
      apiClient: client,
      model: "mock-model",
      sessionId: "session_alpha-1",
      includeDefaultProjectTools: false
    });

    expect(runtime.sessionId).toBe("session_alpha-1");
    expect(() =>
      buildProjectRuntime({
        apiClient: client,
        model: "mock-model",
        sessionId: "bad session id",
        includeDefaultProjectTools: false
      })
    ).toThrow("sessionId must contain only letters, numbers, underscores, or hyphens.");
  });

  it("creates default runtime dependencies and accepts injected dependencies", () => {
    const client = new ScriptedApiClient([[textComplete("ready")]]);
    const customPermissionChecker = new PermissionChecker({ mode: "plan" });
    const customHookExecutor = new InMemoryHookExecutor();
    const customSessionBackend = new FakeSessionBackend();

    const defaultRuntime = buildProjectRuntime({
      apiClient: client,
      model: "mock-model",
      permissionMode: "plan",
      includeDefaultProjectTools: false
    });

    expect(defaultRuntime.permissionChecker).toBeInstanceOf(PermissionChecker);
    expect(defaultRuntime.hookExecutor).toBeInstanceOf(InMemoryHookExecutor);
    expect(defaultRuntime.sessionBackend).toBeInstanceOf(FileSessionBackend);
    expect(defaultRuntime.prompt.permissionMode).toBe("plan");

    const injectedRuntime = buildProjectRuntime({
      apiClient: client,
      model: "mock-model",
      permissionChecker: customPermissionChecker,
      hookExecutor: customHookExecutor,
      sessionBackend: customSessionBackend,
      includeDefaultProjectTools: false
    });

    expect(injectedRuntime.permissionChecker).toBe(customPermissionChecker);
    expect(injectedRuntime.hookExecutor).toBe(customHookExecutor);
    expect(injectedRuntime.sessionBackend).toBe(customSessionBackend);
  });

  it("registers read_file, glob, and grep by default", () => {
    const runtime = buildProjectRuntime({
      apiClient: new ScriptedApiClient([[textComplete("ready")]]),
      model: "mock-model"
    });

    expect(runtime.toolRegistry.hasTool("read_file")).toBe(true);
    expect(runtime.toolRegistry.hasTool("glob")).toBe(true);
    expect(runtime.toolRegistry.hasTool("grep")).toBe(true);
  });

  it("allows caller-provided tools to extend the default project tools", () => {
    const runtime = buildProjectRuntime({
      apiClient: new ScriptedApiClient([[textComplete("ready")]]),
      model: "mock-model",
      tools: [createEchoTool()]
    });

    expect(runtime.toolRegistry.listTools().map((tool) => tool.name)).toEqual([
      "read_file",
      "glob",
      "grep",
      "echo"
    ]);
  });

  it("uses a custom registry as-is without silently adding default project tools", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    const runtime = buildProjectRuntime({
      apiClient: new ScriptedApiClient([[textComplete("ready")]]),
      model: "mock-model",
      toolRegistry: registry
    });

    expect(runtime.toolRegistry).toBe(registry);
    expect(runtime.toolRegistry.hasTool("echo")).toBe(true);
    expect(runtime.toolRegistry.hasTool("read_file")).toBe(false);
    expect(runtime.toolRegistry.hasTool("glob")).toBe(false);
    expect(runtime.toolRegistry.hasTool("grep")).toBe(false);
  });

  it("can omit default project tools when explicitly requested", () => {
    const runtime = buildProjectRuntime({
      apiClient: new ScriptedApiClient([[textComplete("ready")]]),
      model: "mock-model",
      includeDefaultProjectTools: false
    });

    expect(runtime.toolRegistry.listTools()).toEqual([]);
  });

  it("executes a no-network tool turn through the bundled QueryEngine", async () => {
    const client = new ScriptedApiClient([
      [
        assistantToolUse({
          id: "toolu_echo",
          name: "echo",
          input: { value: "echo-output" }
        })
      ],
      [textComplete("done")]
    ]);
    const runtime = buildProjectRuntime({
      apiClient: client,
      model: "mock-model",
      tools: [createEchoTool()]
    });

    const events = await collectEvents(runtime.engine.submitMessage("run echo"));

    expect(events.map((event) => event.type)).toEqual([
      "assistant_turn_complete",
      "tool_execution_started",
      "tool_execution_completed",
      "assistant_turn_complete"
    ]);
    expect(client.requests).toHaveLength(2);
    expect(getMessageText(runtime.engine.getMessages()[0] as ConversationMessage)).toBe(
      "run echo"
    );
    expect(getToolResultMessage(runtime.engine.getMessages()).content).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_echo",
        content: "echo-output",
        isError: false,
        metadata: {}
      }
    ]);
  });
});
