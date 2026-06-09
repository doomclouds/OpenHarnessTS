import { describe, expect, it } from "vitest";
import {
  createTextBlock,
  createToolResultBlock,
  createToolUseBlock,
  isTextBlock,
  isToolResultBlock,
  isToolUseBlock
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
