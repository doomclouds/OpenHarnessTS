import { describe, expect, it } from "vitest";
import {
  createAssistantMessage,
  createTextBlock,
  createToolResult,
  createToolUseBlock,
  createUserMessageFromText,
  getMessageText,
  InMemoryHookExecutor,
  PermissionChecker,
  QueryEngine,
  ToolRegistry,
  type ApiClient,
  type ApiMessageRequest,
  type ApiStreamEvent,
  type ConversationMessage,
  type StreamEvent,
  type ToolDefinition
} from "../src/index.js";

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
      createToolUseBlock({
        id: args.id,
        name: args.name,
        ...(args.input === undefined ? {} : { input: args.input })
      })
    ])
  };
}

function createEchoTool(args: {
  readonly readOnly?: boolean;
  readonly output?: string;
} = {}): ToolDefinition {
  return {
    name: "echo",
    description: "Echoes input.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" }
      },
      required: ["value"]
    },
    isReadOnly: () => args.readOnly ?? true,
    execute(input) {
      const value =
        typeof input === "object" &&
        input !== null &&
        typeof (input as { readonly value?: unknown }).value === "string"
          ? (input as { readonly value: string }).value
          : args.output ?? "missing";
      return createToolResult({ output: value });
    }
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

describe("QueryEngine plain text facade", () => {
  it("submits a string prompt, streams events, and owns message history", async () => {
    const client = new ScriptedApiClient([
      [
        { type: "text_delta", text: "hel" },
        { type: "text_delta", text: "lo" },
        textComplete("hello")
      ]
    ]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    const events = await collectEvents(engine.submitMessage("say hello"));

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });
    expect(client.requests[0]?.messages).toEqual([
      createUserMessageFromText("say hello")
    ]);
    expect(client.requests[0]?.tools).toEqual([]);
    expect(events.map((event) => event.type)).toEqual([
      "assistant_text_delta",
      "assistant_text_delta",
      "assistant_turn_complete"
    ]);
    expect(engine.getMessages()).toHaveLength(2);
    expect(engine.getMessages()[0]).toEqual(
      createUserMessageFromText("say hello")
    );
    expect(getMessageText(engine.getMessages()[1]!)).toBe("hello");
  });

  it("accepts a user ConversationMessage", async () => {
    const client = new ScriptedApiClient([[textComplete("done")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    await collectEvents(
      engine.submitMessage(createUserMessageFromText("message object"))
    );

    expect(client.requests[0]?.messages).toEqual([
      createUserMessageFromText("message object")
    ]);
  });

  it("passes the engine abort signal to API requests", async () => {
    const controller = new AbortController();
    const client = new ScriptedApiClient([[textComplete("done")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      signal: controller.signal
    });

    await collectEvents(engine.submitMessage("abortable"));

    expect(client.requests[0]?.signal).toBe(controller.signal);
  });

  it("rejects assistant messages before mutating history", async () => {
    const client = new ScriptedApiClient([[textComplete("unused")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    expect(() =>
      engine.submitMessage(createAssistantMessage([createTextBlock("bad")]))
    ).toThrow("QueryEngine.submitMessage only accepts user messages.");
    expect(engine.getMessages()).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it("returns a message array copy from getMessages", async () => {
    const client = new ScriptedApiClient([[textComplete("done")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    await collectEvents(engine.submitMessage("copy"));

    const snapshot = engine.getMessages() as ConversationMessage[];
    snapshot.pop();

    expect(snapshot).toHaveLength(1);
    expect(engine.getMessages()).toHaveLength(2);
  });

  it("exposes read-only snapshot metadata for persistence helpers", () => {
    const client = new ScriptedApiClient([[textComplete("unused")]]);
    const toolMetadata = { permissionMode: "default" };
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      toolMetadata
    });

    expect(engine.getCwd()).toBe("C:/WorkSpace/ResearchProjects/OpenHarnessTS");
    expect(engine.getModel()).toBe("mock-model");
    expect(engine.getSystemPrompt()).toBe("You are a test assistant.");
    expect(engine.getToolMetadata()).toEqual(toolMetadata);
    expect(engine.getToolMetadata()).not.toBe(toolMetadata);
  });

  it("rejects overlapping turns before the active turn is consumed", async () => {
    const client = new ScriptedApiClient([
      [textComplete("first done")],
      [textComplete("second done")]
    ]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    const first = engine.submitMessage("first");

    expect(() => engine.submitMessage("second")).toThrow(
      "QueryEngine already has an active turn."
    );
    expect(engine.getMessages()).toEqual([createUserMessageFromText("first")]);
    expect(client.requests).toEqual([]);

    await collectEvents(first);

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.messages).toEqual([
      createUserMessageFromText("first")
    ]);

    const secondEvents = await collectEvents(engine.submitMessage("second"));

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.messages).toEqual([
      createUserMessageFromText("first"),
      createAssistantMessage([createTextBlock("first done")]),
      createUserMessageFromText("second")
    ]);
    expect(secondEvents.map((event) => event.type)).toEqual([
      "assistant_turn_complete"
    ]);
    expect(getMessageText(engine.getMessages().at(-1)!)).toBe("second done");
  });
});

describe("QueryEngine composition", () => {
  it("runs a tool-call loop through registered tools", async () => {
    const client = new ScriptedApiClient([
      [assistantToolUse({ id: "toolu_echo", name: "echo", input: { value: "ok" } })],
      [textComplete("done")]
    ]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      permissionMode: "full_auto",
      tools: [createEchoTool()]
    });

    const events = await collectEvents(engine.submitMessage("use echo"));

    expect(events.map((event) => event.type)).toEqual([
      "assistant_turn_complete",
      "tool_execution_started",
      "tool_execution_completed",
      "assistant_turn_complete"
    ]);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]?.tools).toEqual([
      {
        name: "echo",
        description: "Echoes input.",
        input_schema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"]
        }
      }
    ]);
    expect(engine.getMessages().map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
  });

  it("uses default permission mode when no checker is supplied", async () => {
    const client = new ScriptedApiClient([
      [assistantToolUse({ id: "toolu_write", name: "echo", input: { value: "write" } })],
      [textComplete("handled")]
    ]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      tools: [createEchoTool({ readOnly: false })]
    });

    const events = await collectEvents(engine.submitMessage("write"));

    expect(events[2]).toMatchObject({
      type: "tool_execution_completed",
      isError: true
    });
    expect(
      (events[2] as { readonly output?: string }).output
    ).toContain("requires user confirmation");
  });

  it("honors an injected permission checker", async () => {
    const client = new ScriptedApiClient([
      [assistantToolUse({ id: "toolu_write", name: "echo", input: { value: "write" } })],
      [textComplete("handled")]
    ]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      permissionChecker: new PermissionChecker({ mode: "full_auto" }),
      tools: [createEchoTool({ readOnly: false })]
    });

    const events = await collectEvents(engine.submitMessage("write"));

    expect(events[2]).toMatchObject({
      type: "tool_execution_completed",
      output: "write",
      isError: false
    });
  });

  it("honors an injected hook executor", async () => {
    const client = new ScriptedApiClient([[textComplete("done")]]);
    const hookExecutor = new InMemoryHookExecutor();
    const calls: string[] = [];

    hookExecutor.register("user_prompt_submit", (payload) => {
      calls.push(`${payload.event}:${payload.prompt}`);
      return { hookType: "recorder", success: true };
    });
    hookExecutor.register("stop", (payload) => {
      calls.push(`${payload.event}:${payload.stopReason}`);
      return { hookType: "recorder", success: true };
    });

    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      hookExecutor
    });

    await collectEvents(engine.submitMessage("hook me"));

    expect(calls).toEqual([
      "user_prompt_submit:hook me",
      "stop:tool_uses_empty"
    ]);
  });

  it("uses an injected tool registry and rejects ambiguous tool ownership", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());
    const client = new ScriptedApiClient([[textComplete("done")]]);

    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      toolRegistry: registry
    });

    expect(engine.getTool("echo")).toBeDefined();
    expect(engine.getTool("echo")).toEqual(registry.getTool("echo"));
    expect(engine.listTools()).toHaveLength(1);
    expect(() =>
      new QueryEngine({
        apiClient: client,
        cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
        model: "mock-model",
        systemPrompt: "You are a test assistant.",
        toolRegistry: registry,
        tools: [createEchoTool()]
      })
    ).toThrow("cannot include both toolRegistry and tools");
  });

  it("builds the default prompt when systemPrompt is omitted", async () => {
    const client = new ScriptedApiClient([[textComplete("done")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      customSystemPrompt: "Custom facade prompt.",
      environment: {
        osName: "Windows",
        osVersion: "11.0.0",
        platformMachine: "x64",
        shell: "powershell",
        cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
        homeDir: "C:/Users/10062",
        date: "2026-06-12",
        nodeVersion: "v20.14.0",
        nodeExecutable: "node.exe",
        isGitRepo: false
      }
    });

    await collectEvents(engine.submitMessage("prompt"));

    expect(client.requests[0]?.systemPrompt).toContain("Custom facade prompt.");
    expect(client.requests[0]?.systemPrompt).toContain("# Environment");
    expect(client.requests[0]?.systemPrompt).toContain("- Date: 2026-06-12");
  });

  it("uses explicit systemPrompt without merging customSystemPrompt", async () => {
    const client = new ScriptedApiClient([[textComplete("done")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "Explicit prompt.",
      customSystemPrompt: "Ignored custom prompt."
    });

    await collectEvents(engine.submitMessage("prompt"));

    expect(client.requests[0]?.systemPrompt).toBe("Explicit prompt.");
  });
});

describe("QueryEngine root exports", () => {
  it("exports the public facade and DeepSeek factory from the package root", async () => {
    const root = await import("../src/index.js");

    expect(root.QueryEngine).toBe(QueryEngine);
    expect(typeof root.createDeepSeekQueryEngineFromEnv).toBe("function");
    expect(typeof root.runQuery).toBe("function");
    expect(typeof root.HarnessRuntime).toBe("function");
  });
});
