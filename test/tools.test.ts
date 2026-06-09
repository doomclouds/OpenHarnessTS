import { describe, expect, it } from "vitest";
import {
  createToolErrorResult,
  createToolResult,
  normalizeToolResult
} from "../src/tools/index.js";

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

  it("normalizes a tool result with shallow-copied metadata", () => {
    const metadata = { count: 0 };
    const result = {
      output: "failed",
      isError: true,
      metadata
    };

    const normalized = normalizeToolResult(result);
    metadata.count = 1;

    expect(normalized).toEqual({
      output: "failed",
      isError: true,
      metadata: { count: 0 }
    });
    expect(normalized.metadata).not.toBe(result.metadata);
  });

  it("creates an explicit error result", () => {
    expect(createToolErrorResult("Unknown tool: missing")).toEqual({
      output: "Unknown tool: missing",
      isError: true,
      metadata: {}
    });
  });

  it("creates an error result with shallow-copied metadata", () => {
    const metadata = { code: "missing-tool" };
    const result = createToolErrorResult("Unknown tool: missing", metadata);

    metadata.code = "changed";

    expect(result).toEqual({
      output: "Unknown tool: missing",
      isError: true,
      metadata: { code: "missing-tool" }
    });
    expect(result.metadata).not.toBe(metadata);
  });
});
