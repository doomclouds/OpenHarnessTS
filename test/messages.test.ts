import { describe, expect, it } from "vitest";
import {
  createAssistantMessage as createAssistantMessageFromRoot,
  createTextBlock as createTextBlockFromRoot,
  createUserMessageFromText as createUserMessageFromTextFromRoot
} from "../src/index.js";
import type {
  ConversationMessage as RootConversationMessage,
  MessageRole as RootMessageRole
} from "../src/index.js";
import {
  createAssistantMessage,
  createTextBlock,
  createToolResultBlock,
  createToolUseBlock,
  createUserMessageFromContent,
  createUserMessageFromText,
  getMessageText,
  getToolUses,
  isAssistantMessage,
  isEffectivelyEmpty,
  isTextBlock,
  isToolResultBlock,
  isToolUseBlock,
  isUserMessage
} from "../src/messages/index.js";

describe("message content blocks", () => {
  it("creates a text block", () => {
    expect(createTextBlock("hello")).toEqual({
      type: "text",
      text: "hello"
    });
  });

  it("creates a tool use block with explicit id and default input", () => {
    expect(
      createToolUseBlock({
        id: "toolu_fixed",
        name: "echo"
      })
    ).toEqual({
      type: "tool_use",
      id: "toolu_fixed",
      name: "echo",
      input: {}
    });
  });

  it("generates a stable tool use id prefix when id is omitted", () => {
    const block = createToolUseBlock({ name: "echo" });

    expect(block.id.startsWith("toolu_")).toBe(true);
    expect(block.id.length).toBeGreaterThan("toolu_".length);
  });

  it("rejects an empty tool name", () => {
    expect(() => createToolUseBlock({ name: "   " })).toThrow(
      "Tool name cannot be empty."
    );
  });

  it("creates a tool result block with defaults", () => {
    expect(
      createToolResultBlock({
        toolUseId: "toolu_fixed",
        content: "done"
      })
    ).toEqual({
      type: "tool_result",
      toolUseId: "toolu_fixed",
      content: "done",
      isError: false,
      metadata: {}
    });
  });

  it("preserves tool result ids as opaque identifiers", () => {
    expect(
      createToolResultBlock({
        toolUseId: " toolu_fixed ",
        content: "done"
      })
    ).toEqual({
      type: "tool_result",
      toolUseId: " toolu_fixed ",
      content: "done",
      isError: false,
      metadata: {}
    });
  });

  it("rejects a missing tool result id", () => {
    expect(() =>
      createToolResultBlock({
        toolUseId: " ",
        content: "done"
      })
    ).toThrow("Tool result must reference a tool use id.");
  });

  it("narrows block types", () => {
    const text = createTextBlock("hello");
    const toolUse = createToolUseBlock({
      id: "toolu_fixed",
      name: "echo"
    });
    const toolResult = createToolResultBlock({
      toolUseId: "toolu_fixed",
      content: "done"
    });

    expect(isTextBlock(text)).toBe(true);
    expect(isToolUseBlock(toolUse)).toBe(true);
    expect(isToolResultBlock(toolResult)).toBe(true);
    expect(isTextBlock(toolUse)).toBe(false);
  });
});

describe("conversation messages", () => {
  it("creates a user message from raw text", () => {
    expect(createUserMessageFromText("hello")).toEqual({
      role: "user",
      content: [{ type: "text", text: "hello" }]
    });
  });

  it("creates a user message from explicit content without reordering blocks", () => {
    const result = createUserMessageFromContent([
      createTextBlock("before"),
      createToolResultBlock({
        toolUseId: "toolu_fixed",
        content: "result"
      }),
      createTextBlock("after")
    ]);

    expect(result.role).toBe("user");
    expect(result.content.map((block) => block.type)).toEqual([
      "text",
      "tool_result",
      "text"
    ]);
  });

  it("creates an assistant message", () => {
    expect(
      createAssistantMessage([
        createTextBlock("answer"),
        createToolUseBlock({
          id: "toolu_fixed",
          name: "echo",
          input: { value: "hello" }
        })
      ])
    ).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "answer" },
        {
          type: "tool_use",
          id: "toolu_fixed",
          name: "echo",
          input: { value: "hello" }
        }
      ]
    });
  });

  it("extracts text from text blocks in order", () => {
    const message = createAssistantMessage([
      createTextBlock("hello"),
      createToolUseBlock({
        id: "toolu_fixed",
        name: "echo"
      }),
      createTextBlock(" world")
    ]);

    expect(getMessageText(message)).toBe("hello world");
  });

  it("extracts tool uses in order", () => {
    const first = createToolUseBlock({
      id: "toolu_1",
      name: "first"
    });
    const second = createToolUseBlock({
      id: "toolu_2",
      name: "second"
    });
    const message = createAssistantMessage([
      createTextBlock("before"),
      first,
      createTextBlock("middle"),
      second
    ]);

    expect(getToolUses(message)).toEqual([first, second]);
  });

  it("detects effectively empty assistant messages", () => {
    expect(isEffectivelyEmpty(createAssistantMessage([]))).toBe(true);
    expect(isEffectivelyEmpty(createAssistantMessage([createTextBlock("  ")]))).toBe(
      true
    );
    expect(
      isEffectivelyEmpty(
        createAssistantMessage([
          createToolResultBlock({
            toolUseId: "toolu_fixed",
            content: "result"
          })
        ])
      )
    ).toBe(true);
    expect(
      isEffectivelyEmpty(createAssistantMessage([createTextBlock("hello")]))
    ).toBe(false);
    expect(
      isEffectivelyEmpty(
        createAssistantMessage([
          createToolUseBlock({
            id: "toolu_fixed",
            name: "echo"
          })
        ])
      )
    ).toBe(false);
  });

  it("narrows message roles", () => {
    const user = createUserMessageFromText("hello");
    const assistant = createAssistantMessage([createTextBlock("hi")]);

    expect(isUserMessage(user)).toBe(true);
    expect(isAssistantMessage(user)).toBe(false);
    expect(isAssistantMessage(assistant)).toBe(true);
    expect(isUserMessage(assistant)).toBe(false);
  });
});

describe("message root exports", () => {
  it("exports message helpers from the package root", () => {
    const message: RootConversationMessage =
      createUserMessageFromTextFromRoot("hello");
    const role: RootMessageRole = message.role;

    expect(role).toBe("user");
    expect(
      createAssistantMessageFromRoot([createTextBlockFromRoot("hi")])
    ).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "hi" }]
    });
  });
});

describe("assistant reasoning content", () => {
  it("preserves optional reasoning content on assistant messages", () => {
    const message = createAssistantMessage([createTextBlock("answer")], {
      reasoningContent: "private reasoning"
    });

    expect(message).toEqual({
      role: "assistant",
      content: [createTextBlock("answer")],
      reasoningContent: "private reasoning"
    });
  });

  it("omits reasoning content when it is not supplied", () => {
    const message = createAssistantMessage([createTextBlock("answer")]);

    expect("reasoningContent" in message).toBe(false);
  });
});
