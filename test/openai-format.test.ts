import { describe, expect, it } from "vitest";
import {
  convertMessagesToOpenAI,
  convertToolsToOpenAI,
  createAssistantMessage,
  createTextBlock,
  createToolResultBlock,
  createToolUseBlock,
  createUserMessageFromContent,
  createUserMessageFromText
} from "../src/index.js";
import type { ToolApiSchema } from "../src/index.js";

describe("OpenAI-format message conversion", () => {
  it("adds a non-empty system prompt before user text", () => {
    expect(
      convertMessagesToOpenAI(
        [createUserMessageFromText("hello")],
        "You are concise."
      )
    ).toEqual([
      { role: "system", content: "You are concise." },
      { role: "user", content: "hello" }
    ]);
  });

  it("omits an empty system prompt", () => {
    expect(
      convertMessagesToOpenAI([createUserMessageFromText("hello")], "")
    ).toEqual([{ role: "user", content: "hello" }]);
  });

  it("converts assistant text with reasoning content", () => {
    expect(
      convertMessagesToOpenAI([
        createAssistantMessage([createTextBlock("visible")], {
          reasoningContent: "reasoning"
        })
      ])
    ).toEqual([
      { role: "assistant", content: "visible", reasoning_content: "reasoning" }
    ]);
  });

  it("converts assistant tool uses into function tool calls", () => {
    expect(
      convertMessagesToOpenAI([
        createAssistantMessage([
          createToolUseBlock({
            id: "call_1",
            name: "get_test_value",
            input: { key: "openharness" }
          })
        ])
      ])
    ).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "get_test_value",
              arguments: "{\"key\":\"openharness\"}"
            }
          }
        ]
      }
    ]);
  });

  it("emits tool results before user text", () => {
    expect(
      convertMessagesToOpenAI([
        createUserMessageFromContent([
          createToolResultBlock({
            toolUseId: "call_1",
            content: "deepseek-tool-ok"
          }),
          createTextBlock("continue")
        ])
      ])
    ).toEqual([
      { role: "tool", tool_call_id: "call_1", content: "deepseek-tool-ok" },
      { role: "user", content: "continue" }
    ]);
  });

  it("emits multiple tool results in order", () => {
    expect(
      convertMessagesToOpenAI([
        createUserMessageFromContent([
          createToolResultBlock({ toolUseId: "call_1", content: "one" }),
          createToolResultBlock({ toolUseId: "call_2", content: "two" })
        ])
      ])
    ).toEqual([
      { role: "tool", tool_call_id: "call_1", content: "one" },
      { role: "tool", tool_call_id: "call_2", content: "two" }
    ]);
  });
});

describe("OpenAI-format tool conversion", () => {
  it("wraps tool schemas as OpenAI function tools without cloning schema objects", () => {
    const tools: ToolApiSchema[] = [
      {
        name: "get_test_value",
        description: "Return a deterministic test value.",
        input_schema: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"]
        }
      }
    ];

    expect(convertToolsToOpenAI(tools)).toEqual([
      {
        type: "function",
        function: {
          name: "get_test_value",
          description: "Return a deterministic test value.",
          parameters: tools[0]!.input_schema
        }
      }
    ]);
  });
});
