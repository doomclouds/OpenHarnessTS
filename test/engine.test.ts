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
    readonly permissionChecker?: PermissionChecker;
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
      permissionChecker:
        options.permissionChecker ??
        new PermissionChecker({ mode: options.mode ?? "full_auto" }),
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

describe("runQuery permission integration", () => {
  it("denies mutating tools in default mode, emits aligned error events, and feeds the error result back", async () => {
    const execute = vi.fn(() => createToolResult({ output: "should not run" }));
    const tool: ToolDefinition = {
      name: "write_file",
      description: "Writes a file.",
      isReadOnly: () => false,
      execute
    };
    const client = new ScriptedApiClient([
      [
        assistantToolUse({
          id: "toolu_default_denied",
          name: "write_file",
          input: { path: "notes.txt" }
        })
      ],
      [textComplete("handled denial")]
    ]);
    const messages = [createUserMessageFromText("write file")];

    const events = await collectEvents(client, messages, [tool], {
      mode: "default"
    });

    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "assistant_turn_complete",
      "tool_execution_started",
      "tool_execution_completed",
      "assistant_turn_complete"
    ]);
    expect(events[2]).toMatchObject({
      type: "tool_execution_completed",
      toolName: "write_file",
      output:
        "This mutating tool requires user confirmation in default mode. Approve the prompt when asked.",
      isError: true,
      toolUseId: "toolu_default_denied"
    });
    expect(getToolResultMessage(messages).content).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_default_denied",
        content:
          "This mutating tool requires user confirmation in default mode. Approve the prompt when asked.",
        isError: true,
        metadata: {}
      }
    ]);
    expect(client.requests[1]?.messages).toEqual(messages.slice(0, 3));
  });

  it("denies mutating tools in plan mode before execution", async () => {
    const execute = vi.fn(() => createToolResult({ output: "should not run" }));
    const tool: ToolDefinition = {
      name: "edit_file",
      description: "Edits a file.",
      isReadOnly: () => false,
      execute
    };
    const client = new ScriptedApiClient([
      [
        assistantToolUse({
          id: "toolu_plan_denied",
          name: "edit_file",
          input: { path: "notes.txt" }
        })
      ],
      [textComplete("handled plan denial")]
    ]);
    const messages = [createUserMessageFromText("edit file")];

    await collectEvents(client, messages, [tool], { mode: "plan" });

    expect(execute).not.toHaveBeenCalled();
    expect(getToolResultMessage(messages).content[0]).toMatchObject({
      toolUseId: "toolu_plan_denied",
      content: "Plan mode blocks mutating tools until the user exits plan mode",
      isError: true
    });
  });

  it("executes mutating tools in full-auto mode", async () => {
    const execute = vi.fn(() => createToolResult({ output: "written" }));
    const tool: ToolDefinition = {
      name: "write_file",
      description: "Writes a file.",
      isReadOnly: () => false,
      execute
    };
    const client = new ScriptedApiClient([
      [
        assistantToolUse({
          id: "toolu_full_auto_write",
          name: "write_file",
          input: { path: "notes.txt" }
        })
      ],
      [textComplete("write done")]
    ]);
    const messages = [createUserMessageFromText("write file")];

    await collectEvents(client, messages, [tool], { mode: "full_auto" });

    expect(execute).toHaveBeenCalledOnce();
    expect(getToolResultMessage(messages).content[0]).toMatchObject({
      toolUseId: "toolu_full_auto_write",
      content: "written",
      isError: false
    });
  });

  it.each(["default", "plan"] as const)(
    "executes read-only tools in %s mode",
    async (mode) => {
      const execute = vi.fn(() => createToolResult({ output: mode }));
      const tool: ToolDefinition = {
        name: "read",
        description: "Reads data.",
        isReadOnly: () => true,
        execute
      };
      const client = new ScriptedApiClient([
        [assistantToolUse({ id: `toolu_${mode}`, name: "read", input: {} })],
        [textComplete("read done")]
      ]);
      const messages = [createUserMessageFromText("read")];

      await collectEvents(client, messages, [tool], { mode });

      expect(execute).toHaveBeenCalledOnce();
      expect(getToolResultMessage(messages).content[0]).toMatchObject({
        toolUseId: `toolu_${mode}`,
        content: mode,
        isError: false
      });
    }
  );

  it("computes read-only status from validated input", async () => {
    const execute = vi.fn(() => createToolResult({ output: "validated read" }));
    const tool: ToolDefinition = {
      name: "mode_sensitive",
      description: "Uses validated input for read-only policy.",
      validateInput(input) {
        return {
          ok: true,
          value: {
            readOnly:
              typeof input === "object" &&
              input !== null &&
              (input as { readonly mode?: unknown }).mode === "read"
          }
        };
      },
      isReadOnly(input) {
        return (input as { readonly readOnly: boolean }).readOnly;
      },
      execute
    };
    const client = new ScriptedApiClient([
      [
        assistantToolUse({
          id: "toolu_validated_read",
          name: "mode_sensitive",
          input: { mode: "read" }
        })
      ],
      [textComplete("done")]
    ]);
    const messages = [createUserMessageFromText("read")];

    await collectEvents(client, messages, [tool], { mode: "plan" });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      { readOnly: true },
      expect.objectContaining({
        cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS"
      })
    );
  });

  it("fails invalid input before permission evaluation or execution", async () => {
    const permissionChecker = new PermissionChecker({ mode: "full_auto" });
    const evaluate = vi.spyOn(permissionChecker, "evaluate");
    const isReadOnly = vi.fn(() => true);
    const execute = vi.fn(() => createToolResult({ output: "should not run" }));
    const tool: ToolDefinition = {
      name: "validated",
      description: "Validated tool.",
      validateInput() {
        return {
          ok: false,
          error: "bad input"
        };
      },
      isReadOnly,
      execute
    };
    const client = new ScriptedApiClient([
      [assistantToolUse({ id: "toolu_invalid", name: "validated", input: {} })],
      [textComplete("done")]
    ]);
    const messages = [createUserMessageFromText("validate")];

    await collectEvents(client, messages, [tool], { permissionChecker });

    expect(evaluate).not.toHaveBeenCalled();
    expect(isReadOnly).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(getToolResultMessage(messages).content[0]).toMatchObject({
      toolUseId: "toolu_invalid",
      content: "Invalid input for validated: bad input",
      isError: true
    });
  });

  it.each([
    ["filePath", "toolu_file_path", { filePath: "C:\\Users\\me\\.ssh\\id_rsa" }],
    ["path", "toolu_path", { path: "C:\\Users\\me\\.aws\\credentials" }]
  ] as const)(
    "extracts %s input for sensitive path checks even in full-auto mode",
    async (_field, id, input) => {
      const execute = vi.fn(() => createToolResult({ output: "should not run" }));
      const tool: ToolDefinition = {
        name: "read_secret",
        description: "Reads secret paths.",
        isReadOnly: () => true,
        execute
      };
      const client = new ScriptedApiClient([
        [assistantToolUse({ id, name: "read_secret", input })],
        [textComplete("blocked")]
      ]);
      const messages = [createUserMessageFromText("read secret")];

      await collectEvents(client, messages, [tool], { mode: "full_auto" });

      expect(execute).not.toHaveBeenCalled();
      expect(getToolResultMessage(messages).content[0]).toMatchObject({
        toolUseId: id,
        isError: true
      });
      expect(
        (getToolResultMessage(messages).content[0] as { readonly content: string })
          .content
      ).toContain("sensitive credential path");
    }
  );

  it("checks sensitive paths from raw input when validation returns a normalized value without paths", async () => {
    const execute = vi.fn(() => createToolResult({ output: "should not run" }));
    const tool: ToolDefinition = {
      name: "validated_secret_read",
      description: "Normalizes raw secret path input.",
      validateInput() {
        return {
          ok: true,
          value: {
            readOnly: true
          }
        };
      },
      isReadOnly(input) {
        return (input as { readonly readOnly: boolean }).readOnly;
      },
      execute
    };
    const client = new ScriptedApiClient([
      [
        assistantToolUse({
          id: "toolu_raw_secret",
          name: "validated_secret_read",
          input: { path: "C:\\Users\\me\\.ssh\\id_rsa" }
        })
      ],
      [textComplete("blocked")]
    ]);
    const messages = [createUserMessageFromText("read normalized secret")];

    await collectEvents(client, messages, [tool], { mode: "full_auto" });

    expect(execute).not.toHaveBeenCalled();
    expect(getToolResultMessage(messages).content[0]).toMatchObject({
      toolUseId: "toolu_raw_secret",
      isError: true
    });
    expect(
      (getToolResultMessage(messages).content[0] as { readonly content: string })
        .content
    ).toContain("sensitive credential path");
    expect(client.requests[1]?.messages).toEqual(messages.slice(0, 3));
  });
});

describe("runQuery tool failure alignment", () => {
  it("preserves tool use ids for unknown tools, invalid inputs, thrown validators, thrown tools, and sibling successes", async () => {
    const invalidTool: ToolDefinition = {
      name: "invalid",
      description: "Invalid input tool.",
      validateInput() {
        return {
          ok: false,
          error: "bad input"
        };
      },
      execute() {
        return createToolResult({ output: "should not run" });
      }
    };
    const throwingValidator: ToolDefinition = {
      name: "throwing_validator",
      description: "Throws during validation.",
      validateInput() {
        throw new Error("validator exploded");
      },
      execute() {
        return createToolResult({ output: "should not run" });
      }
    };
    const throwingTool: ToolDefinition = {
      name: "throwing_tool",
      description: "Throws during execution.",
      isReadOnly: () => true,
      execute() {
        throw new Error("tool exploded");
      }
    };
    const successfulTool: ToolDefinition = {
      name: "successful_tool",
      description: "Succeeds next to failures.",
      isReadOnly: () => true,
      execute() {
        return createToolResult({ output: "success" });
      }
    };
    const client = new ScriptedApiClient([
      [
        {
          type: "message_complete",
          message: createAssistantMessage([
            createToolUseBlock({ id: "toolu_unknown", name: "missing" }),
            createToolUseBlock({ id: "toolu_invalid", name: "invalid" }),
            createToolUseBlock({
              id: "toolu_throwing_validator",
              name: "throwing_validator"
            }),
            createToolUseBlock({
              id: "toolu_throwing_tool",
              name: "throwing_tool"
            }),
            createToolUseBlock({
              id: "toolu_successful",
              name: "successful_tool"
            })
          ])
        }
      ],
      [textComplete("done")]
    ]);
    const messages = [createUserMessageFromText("fail tools")];

    await collectEvents(
      client,
      messages,
      [invalidTool, throwingValidator, throwingTool, successfulTool],
      { mode: "full_auto" }
    );

    expect(getToolResultMessage(messages).content).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_unknown",
        content: "Unknown tool: missing",
        isError: true,
        metadata: {}
      },
      {
        type: "tool_result",
        toolUseId: "toolu_invalid",
        content: "Invalid input for invalid: bad input",
        isError: true,
        metadata: {}
      },
      {
        type: "tool_result",
        toolUseId: "toolu_throwing_validator",
        content: "Invalid input for throwing_validator: validator exploded",
        isError: true,
        metadata: {}
      },
      {
        type: "tool_result",
        toolUseId: "toolu_throwing_tool",
        content: "Tool throwing_tool failed: tool exploded",
        isError: true,
        metadata: {}
      },
      {
        type: "tool_result",
        toolUseId: "toolu_successful",
        content: "success",
        isError: false,
        metadata: {}
      }
    ]);
    expect(client.requests[1]?.messages).toEqual(messages.slice(0, 3));
  });
});

describe("runQuery loop control", () => {
  it("emits an unrecoverable error and does not append empty assistant messages", async () => {
    const client = new ScriptedApiClient([
      [
        {
          type: "message_complete",
          message: createAssistantMessage([createTextBlock("   ")])
        }
      ]
    ]);
    const messages = [createUserMessageFromText("empty")];

    const events = await collectEvents(client, messages);

    expect(events).toEqual([
      {
        type: "error",
        message:
          "Model returned an empty assistant message. The turn was ignored to keep the session healthy.",
        recoverable: false
      }
    ]);
    expect(messages).toEqual([createUserMessageFromText("empty")]);
  });

  it("emits an unrecoverable error when the provider stream has no final message", async () => {
    const client = new ScriptedApiClient([[{ type: "text_delta", text: "orphan" }]]);
    const messages = [createUserMessageFromText("missing final")];

    const events = await collectEvents(client, messages);

    expect(events).toEqual([
      {
        type: "assistant_text_delta",
        text: "orphan"
      },
      {
        type: "error",
        message: "Model stream finished without a final message",
        recoverable: false
      }
    ]);
  });

  it("emits an unrecoverable error when the provider throws", async () => {
    const client: ApiClient = {
      async *streamMessage() {
        throw new Error("network down");
      }
    };
    const messages = [createUserMessageFromText("throw")];

    const events = await collectEvents(client, messages);

    expect(events).toEqual([
      {
        type: "error",
        message: "API error: network down",
        recoverable: false
      }
    ]);
  });

  it("counts max turns by provider turn rather than tool count", async () => {
    const tool: ToolDefinition = {
      name: "read",
      description: "Reads data.",
      isReadOnly: () => true,
      execute() {
        return createToolResult({ output: "read-output" });
      }
    };
    const client = new ScriptedApiClient([
      [
        {
          type: "message_complete",
          message: createAssistantMessage([
            createToolUseBlock({ id: "toolu_first", name: "read" }),
            createToolUseBlock({ id: "toolu_second", name: "read" })
          ])
        }
      ],
      [assistantToolUse({ id: "toolu_third", name: "read", input: {} })]
    ]);
    const messages = [createUserMessageFromText("loop")];

    const events = await collectEvents(client, messages, [tool], {
      maxTurns: 2
    });

    expect(client.requests).toHaveLength(2);
    expect(getToolResultMessage(messages).content).toHaveLength(2);
    expect(messages.at(-1)?.content).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_third",
        content: "read-output",
        isError: false,
        metadata: {}
      }
    ]);
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "Max turns exceeded: 2",
      recoverable: false
    });
  });
});
