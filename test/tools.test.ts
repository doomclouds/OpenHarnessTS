import { describe, expect, it } from "vitest";
import { createToolErrorResult, createToolResult } from "../src/tools/index.js";

describe("tool results", () => {
  it("creates a successful tool result with defaults", () => {
    expect(createToolResult({ output: "ok" })).toEqual({
      output: "ok",
      isError: false,
      metadata: {}
    });
  });

  it("preserves output exactly", () => {
    expect(createToolResult({ output: "  ok\n" }).output).toBe("  ok\n");
  });

  it("preserves falsy metadata values", () => {
    expect(
      createToolResult({
        output: "ok",
        metadata: {
          flag: false,
          count: 0,
          text: "",
          nothing: null
        }
      })
    ).toEqual({
      output: "ok",
      isError: false,
      metadata: {
        flag: false,
        count: 0,
        text: "",
        nothing: null
      }
    });
  });

  it("shallow-copies metadata", () => {
    const metadata = { value: "original" };
    const result = createToolResult({ output: "ok", metadata });

    metadata.value = "changed";

    expect(result.metadata).toEqual({ value: "original" });
    expect(result.metadata).not.toBe(metadata);
  });

  it("creates an explicit error result", () => {
    expect(createToolErrorResult("Unknown tool: missing")).toEqual({
      output: "Unknown tool: missing",
      isError: true,
      metadata: {}
    });
  });
});
