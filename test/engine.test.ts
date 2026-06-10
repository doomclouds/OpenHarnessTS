import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessage,
  createTextBlock,
  createToolResult,
  createToolUseBlock,
  createUserMessageFromText,
  getMessageText,
  isToolResultBlock,
  PermissionChecker,
  runQuery,
  ToolRegistry
} from "../src/index.js";
import type {
  ApiClient,
  ApiMessageRequest,
  ApiStreamEvent,
  ConversationMessage,
  PermissionMode,
  ToolDefinition,
  StreamEvent
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

async function collectEvents(
  client: ApiClient,
  messages: ConversationMessage[],
  tools: readonly ToolDefinition[] = [],
  options: {
    readonly mode?: PermissionMode;
    readonly maxTurns?: number;
    readonly toolMetadata?: Readonly<Record<string, unknown>>;
  } = {}
): Promise<readonly StreamEvent[]> {
  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }

  const events: StreamEvent[] = [];

  for await (const event of runQuery(
    {
      apiClient: client,
      toolRegistry: registry,
      permissionChecker: new PermissionChecker({ mode: options.mode ?? "full_auto" }),
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      maxTokens: 128,
      maxTurns: options.maxTurns ?? 5,
      toolMetadata: options.toolMetadata ?? {
        session: "test-session"
      }
    },
    messages
  )) {
    events.push(event);
  }

  return events;
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
  const toolUseArgs =
    args.input === undefined
      ? {
          id: args.id,
          name: args.name
        }
      : {
          id: args.id,
          name: args.name,
          input: args.input
        };

  return {
    type: "message_complete",
    message: createAssistantMessage([
      createToolUseBlock(toolUseArgs)
    ])
  };
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

describe("runQuery plain text loop", () => {
  it("streams assistant text and stops after a final message without tool uses", async () => {
    const client = new ScriptedApiClient([
      [
        {
          type: "text_delta",
          text: "hel"
        },
        {
          type: "text_delta",
          text: "lo"
        },
        {
          type: "message_complete",
          message: createAssistantMessage([createTextBlock("hello")])
        }
      ]
    ]);
    const messages = [createUserMessageFromText("say hello")];

    const events = await collectEvents(client, messages);

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      maxTokens: 128
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
    expect(events[0]).toEqual({
      type: "assistant_text_delta",
      text: "hel"
    });
    expect(events[1]).toEqual({
      type: "assistant_text_delta",
      text: "lo"
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("assistant");
    expect(getMessageText(messages[1] as ConversationMessage)).toBe("hello");
  });

  it("converts provider retry events to status events before turn completion", async () => {
    const client = new ScriptedApiClient([
      [
        {
          type: "retry",
          message: "temporary",
          attempt: 0,
          maxAttempts: 2,
          delaySeconds: 0.25
        },
        {
          type: "message_complete",
          message: createAssistantMessage([createTextBlock("ready")])
        }
      ]
    ]);
    const messages = [createUserMessageFromText("say ready")];

    const events = await collectEvents(client, messages);

    expect(events.map((event) => event.type)).toEqual([
      "status",
      "assistant_turn_complete"
    ]);
    expect(events[0]).toEqual({
      type: "status",
      message: "Request failed; retrying in 0.3s (attempt 1 of 2): temporary"
    });
    expect(messages).toHaveLength(2);
    expect(getMessageText(messages[1] as ConversationMessage)).toBe("ready");
  });

});

describe("runQuery tool-call loop", () => {
  it("executes a read-only tool, appends tool results, and continues to the final answer", async () => {
    const execute = vi.fn((input: unknown) =>
      createToolResult({
        output: `echo:${(input as { readonly text: string }).text}`
      })
    );
    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echoes text.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string"
          }
        },
        required: ["text"]
      },
      validateInput(input) {
        if (
          typeof input === "object" &&
          input !== null &&
          typeof (input as { readonly text?: unknown }).text === "string"
        ) {
          return {
            ok: true,
            value: {
              text: (input as { readonly text: string }).text
            }
          };
        }

        return {
          ok: false,
          error: "text is required"
        };
      },
      isReadOnly: () => true,
      execute
    };
    const client = new ScriptedApiClient([
      [
        assistantToolUse({
          id: "toolu_echo",
          name: "echo",
          input: { text: "hello" }
        })
      ],
      [textComplete("final answer")]
    ]);
    const messages = [createUserMessageFromText("echo hello")];

    const events = await collectEvents(client, messages, [echoTool], {
      toolMetadata: {
        requestId: "req-123"
      }
    });

    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]?.tools).toEqual([
      {
        name: "echo",
        description: "Echoes text.",
        input_schema: {
          type: "object",
          properties: {
            text: {
              type: "string"
            }
          },
          required: ["text"]
        }
      }
    ]);
    expect(client.requests[1]?.messages).toEqual(messages.slice(0, 3));
    expect(client.requests[1]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user"
    ]);

    expect(events.map((event) => event.type)).toEqual([
      "assistant_turn_complete",
      "tool_execution_started",
      "tool_execution_completed",
      "assistant_turn_complete"
    ]);
    expect(events[1]).toEqual({
      type: "tool_execution_started",
      toolName: "echo",
      toolInput: { text: "hello" },
      toolUseId: "toolu_echo"
    });
    expect(events[2]).toEqual({
      type: "tool_execution_completed",
      toolName: "echo",
      output: "echo:hello",
      isError: false,
      metadata: {},
      toolUseId: "toolu_echo"
    });
    expect(execute).toHaveBeenCalledWith(
      { text: "hello" },
      {
        cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
        metadata: {
          requestId: "req-123"
        }
      }
    );
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
    expect(getToolResultMessage(messages).content).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_echo",
        content: "echo:hello",
        isError: false,
        metadata: {}
      }
    ]);
    expect(getMessageText(messages[3] as ConversationMessage)).toBe(
      "final answer"
    );
  });

  it("executes multiple read-only tools in order and appends one tool-result message", async () => {
    const firstExecute = vi.fn(() => createToolResult({ output: "first-output" }));
    const secondExecute = vi.fn(() =>
      createToolResult({
        output: "second-output",
        metadata: {
          source: "second"
        }
      })
    );
    const firstTool: ToolDefinition = {
      name: "first",
      description: "First read-only tool.",
      isReadOnly: () => true,
      execute: firstExecute
    };
    const secondTool: ToolDefinition = {
      name: "second",
      description: "Second read-only tool.",
      isReadOnly: () => true,
      execute: secondExecute
    };
    const client = new ScriptedApiClient([
      [
        {
          type: "message_complete",
          message: createAssistantMessage([
            createToolUseBlock({ id: "toolu_first", name: "first" }),
            createToolUseBlock({
              id: "toolu_second",
              name: "second",
              input: { value: 2 }
            })
          ])
        }
      ],
      [textComplete("both done")]
    ]);
    const messages = [createUserMessageFromText("run both")];

    const events = await collectEvents(client, messages, [firstTool, secondTool]);

    expect(events.map((event) => event.type)).toEqual([
      "assistant_turn_complete",
      "tool_execution_started",
      "tool_execution_completed",
      "tool_execution_started",
      "tool_execution_completed",
      "assistant_turn_complete"
    ]);
    expect(events[1]).toMatchObject({
      toolName: "first",
      toolUseId: "toolu_first"
    });
    expect(events[2]).toMatchObject({
      toolName: "first",
      output: "first-output",
      metadata: {},
      toolUseId: "toolu_first"
    });
    expect(events[3]).toMatchObject({
      toolName: "second",
      toolInput: { value: 2 },
      toolUseId: "toolu_second"
    });
    expect(events[4]).toMatchObject({
      toolName: "second",
      output: "second-output",
      metadata: {
        source: "second"
      },
      toolUseId: "toolu_second"
    });
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.messages).toEqual(messages.slice(0, 3));
    expect(getToolResultMessage(messages).content).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_first",
        content: "first-output",
        isError: false,
        metadata: {}
      },
      {
        type: "tool_result",
        toolUseId: "toolu_second",
        content: "second-output",
        isError: false,
        metadata: {
          source: "second"
        }
      }
    ]);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
  });

  it("turns read-only policy errors into aligned tool results", async () => {
    const execute = vi.fn(() => createToolResult({ output: "should not run" }));
    const tool: ToolDefinition = {
      name: "fragile_policy",
      description: "Throws while computing read-only policy.",
      isReadOnly() {
        throw new Error("policy exploded");
      },
      execute
    };
    const client = new ScriptedApiClient([
      [
        assistantToolUse({
          id: "toolu_fragile_policy",
          name: "fragile_policy",
          input: { target: "safe.txt" }
        })
      ],
      [textComplete("policy handled")]
    ]);
    const messages = [createUserMessageFromText("run fragile policy")];

    const events = await collectEvents(client, messages, [tool]);

    expect(execute).not.toHaveBeenCalled();
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.messages).toEqual(messages.slice(0, 3));
    expect(events.map((event) => event.type)).toEqual([
      "assistant_turn_complete",
      "tool_execution_started",
      "tool_execution_completed",
      "assistant_turn_complete"
    ]);
    expect(events[2]).toMatchObject({
      toolName: "fragile_policy",
      output: "Invalid read-only policy for fragile_policy: policy exploded",
      isError: true,
      metadata: {},
      toolUseId: "toolu_fragile_policy"
    });
    expect(getToolResultMessage(messages).content).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_fragile_policy",
        content: "Invalid read-only policy for fragile_policy: policy exploded",
        isError: true,
        metadata: {}
      }
    ]);
    expect(getMessageText(messages[3] as ConversationMessage)).toBe(
      "policy handled"
    );
  });
});
