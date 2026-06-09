import { describe, expect, it } from "vitest";
import {
  createToolErrorResult,
  createToolResult,
  normalizeToolResult,
  ToolRegistry
} from "../src/tools/index.js";
import type { ToolDefinition } from "../src/tools/index.js";

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

function createEchoTool(name = "echo"): ToolDefinition {
  return {
    name,
    description: "Echoes input.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" }
      }
    },
    execute(input) {
      return createToolResult({ output: JSON.stringify(input) });
    }
  };
}

describe("tool registry", () => {
  it("registers and retrieves a tool by name", () => {
    const registry = new ToolRegistry();
    const tool = createEchoTool();

    registry.register(tool);

    expect(registry.getTool("echo")).toEqual(tool);
    expect(registry.hasTool("echo")).toBe(true);
  });

  it("trims tool names during registration and lookup", () => {
    const registry = new ToolRegistry();

    registry.register(createEchoTool("  echo  "));

    expect(registry.getTool("echo")?.name).toBe("echo");
    expect(registry.getTool("  echo  ")?.name).toBe("echo");
  });

  it("rejects empty tool names", () => {
    const registry = new ToolRegistry();

    expect(() => registry.register(createEchoTool("   "))).toThrow(
      "Tool name cannot be empty."
    );
  });

  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();

    registry.register(createEchoTool("echo"));

    expect(() => registry.register(createEchoTool("echo"))).toThrow(
      "already registered"
    );
  });

  it("preserves registration order", () => {
    const registry = new ToolRegistry();
    const first = createEchoTool("first");
    const second = createEchoTool("second");

    registry.register(first);
    registry.register(second);

    expect(registry.listTools()).toEqual([first, second]);
  });

  it("returns a copy from listTools", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool("echo"));

    const firstList = registry.listTools();
    const secondList = registry.listTools();

    expect(firstList).toEqual(secondList);
    expect(firstList).not.toBe(secondList);
  });

  it("returns undefined for unknown tools", () => {
    const registry = new ToolRegistry();

    expect(registry.getTool("missing")).toBeUndefined();
    expect(registry.hasTool("missing")).toBe(false);
  });

  it("treats tool names as case-sensitive", () => {
    const registry = new ToolRegistry();

    registry.register(createEchoTool("Echo"));

    expect(registry.getTool("Echo")).toBeDefined();
    expect(registry.getTool("echo")).toBeUndefined();
  });

  it("exports API schemas in registration order", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool("first"));
    registry.register({
      name: "second",
      description: "No schema tool.",
      execute() {
        return createToolResult({ output: "done" });
      }
    });

    expect(registry.toApiSchema()).toEqual([
      {
        name: "first",
        description: "Echoes input.",
        input_schema: {
          type: "object",
          properties: {
            value: { type: "string" }
          }
        }
      },
      {
        name: "second",
        description: "No schema tool.",
        input_schema: {
          type: "object",
          properties: {}
        }
      }
    ]);
  });
});
