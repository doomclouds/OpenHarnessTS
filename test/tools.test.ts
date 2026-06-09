import { describe, expect, it } from "vitest";
import {
  createToolErrorResult,
  createToolResult,
  createToolResultBlockFromToolResult,
  executeRegisteredTool,
  normalizeToolResult,
  ToolRegistry
} from "../src/tools/index.js";
import {
  createToolResult as createToolResultFromRoot,
  createToolResultBlockFromToolResult as createToolResultBlockFromRoot,
  executeRegisteredTool as executeRegisteredToolFromRoot,
  ToolRegistry as ToolRegistryFromRoot
} from "../src/index.js";
import type {
  ToolDefinition,
  ToolExecutionContext
} from "../src/tools/index.js";
import type {
  ToolDefinition as RootToolDefinition,
  ToolExecutionContext as RootToolExecutionContext,
  ToolResult as RootToolResult
} from "../src/index.js";

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

const executionContext: ToolExecutionContext = {
  cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
  metadata: {
    session: "test-session"
  }
};

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

  it("does not share default API schema objects between exports", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "no-schema",
      description: "No schema tool.",
      execute() {
        return createToolResult({ output: "done" });
      }
    });

    const firstSchema = registry.toApiSchema()[0]?.input_schema as Record<
      string,
      unknown
    >;
    firstSchema.properties = { mutated: true };

    expect(registry.toApiSchema()[0]?.input_schema).toEqual({
      type: "object",
      properties: {}
    });
  });

  it("isolates registered input schemas from external mutation", () => {
    const registry = new ToolRegistry();
    const properties: Record<string, unknown> = {
      value: { type: "string" }
    };
    const inputSchema: Record<string, unknown> = {
      type: "object",
      properties
    };

    registry.register({
      name: "echo",
      description: "Echoes input.",
      inputSchema,
      execute(input) {
        return createToolResult({ output: JSON.stringify(input) });
      }
    });

    properties.value = { type: "number" };

    expect(registry.toApiSchema()[0]?.input_schema).toEqual({
      type: "object",
      properties: {
        value: { type: "string" }
      }
    });
  });

  it("isolates input schemas returned from getTool", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool("echo"));

    const retrieved = registry.getTool("echo") as ToolDefinition & {
      inputSchema: Record<string, unknown>;
    };
    retrieved.inputSchema.properties = {
      value: { type: "number" }
    };

    expect(registry.toApiSchema()[0]?.input_schema).toEqual({
      type: "object",
      properties: {
        value: { type: "string" }
      }
    });
  });

  it("isolates input schemas returned from listTools", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool("echo"));

    const listed = registry.listTools()[0] as ToolDefinition & {
      inputSchema: Record<string, unknown>;
    };
    listed.inputSchema.properties = {
      value: { type: "number" }
    };

    expect(registry.toApiSchema()[0]?.input_schema).toEqual({
      type: "object",
      properties: {
        value: { type: "string" }
      }
    });
  });
});

describe("registered tool execution", () => {
  it("executes a registered tool with raw input", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: "Echoes input.",
      execute(input, context) {
        return createToolResult({
          output: `${String(input)}:${context.cwd}:${String(
            context.metadata.session
          )}`
        });
      }
    });

    const result = await executeRegisteredTool(
      registry,
      {
        toolUseId: "toolu_echo",
        toolName: "echo",
        input: "hello"
      },
      executionContext
    );

    expect(result).toEqual({
      output:
        "hello:C:/WorkSpace/ResearchProjects/OpenHarnessTS:test-session",
      isError: false,
      metadata: {}
    });
  });

  it("passes validated input to execute", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "double",
      description: "Doubles a number.",
      validateInput(input) {
        if (
          typeof input === "object" &&
          input !== null &&
          typeof (input as { value?: unknown }).value === "string"
        ) {
          const value = Number((input as { value: string }).value);

          return {
            ok: true,
            value: { value }
          };
        }

        return {
          ok: false,
          error: "value must be a number"
        };
      },
      execute(input: { value: number }) {
        expect(input.value).toBe(5);
        expect("ignored" in input).toBe(false);

        return createToolResult({ output: String(input.value * 2) });
      }
    });

    const result = await executeRegisteredTool(
      registry,
      {
        toolUseId: "toolu_double",
        toolName: "double",
        input: { value: "5", ignored: true }
      },
      executionContext
    );

    expect(result.output).toBe("10");
    expect(result.isError).toBe(false);
  });

  it("returns an unknown-tool error result without throwing", async () => {
    const result = await executeRegisteredTool(
      new ToolRegistry(),
      {
        toolUseId: "toolu_missing",
        toolName: "missing",
        input: {}
      },
      executionContext
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unknown tool: missing");
  });

  it("returns a validation-failure error result without throwing", async () => {
    const registry = new ToolRegistry();
    let executed = false;

    registry.register({
      name: "validated",
      description: "Validated tool.",
      validateInput() {
        return {
          ok: false,
          error: "bad input"
        };
      },
      execute() {
        executed = true;

        return createToolResult({ output: "should not run" });
      }
    });

    const result = await executeRegisteredTool(
      registry,
      {
        toolUseId: "toolu_validated",
        toolName: "validated",
        input: {}
      },
      executionContext
    );

    expect(result).toEqual({
      output: "Invalid input for validated: bad input",
      isError: true,
      metadata: {}
    });
    expect(executed).toBe(false);
  });

  it("normalizes thrown validator errors", async () => {
    const registry = new ToolRegistry();
    let executed = false;

    registry.register({
      name: "throwing_validator",
      description: "Throws in validation.",
      validateInput() {
        throw new Error("validator exploded");
      },
      execute() {
        executed = true;

        return createToolResult({ output: "should not run" });
      }
    });

    const result = await executeRegisteredTool(
      registry,
      {
        toolUseId: "toolu_validator",
        toolName: "throwing_validator",
        input: {}
      },
      executionContext
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain(
      "Invalid input for throwing_validator: validator exploded"
    );
    expect(executed).toBe(false);
  });

  it("normalizes thrown execute errors", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "throwing_execute",
      description: "Throws during execution.",
      execute() {
        throw new Error("execute exploded");
      }
    });

    const result = await executeRegisteredTool(
      registry,
      {
        toolUseId: "toolu_execute",
        toolName: "throwing_execute",
        input: {}
      },
      executionContext
    );

    expect(result).toEqual({
      output: "Tool throwing_execute failed: execute exploded",
      isError: true,
      metadata: {}
    });
  });

  it("normalizes successful result metadata", async () => {
    const registry = new ToolRegistry();
    const metadata = { count: 0, ok: false };
    registry.register({
      name: "metadata",
      description: "Returns metadata.",
      execute() {
        return {
          output: "done",
          isError: false,
          metadata
        };
      }
    });

    const result = await executeRegisteredTool(
      registry,
      {
        toolUseId: "toolu_metadata",
        toolName: "metadata",
        input: {}
      },
      executionContext
    );

    metadata.count = 1;

    expect(result).toEqual({
      output: "done",
      isError: false,
      metadata: {
        count: 0,
        ok: false
      }
    });
  });

  it("converts tool results into tool result blocks", () => {
    const block = createToolResultBlockFromToolResult({
      toolUseId: "toolu_result",
      result: createToolErrorResult("failed", {
        reason: "test"
      })
    });

    expect(block).toEqual({
      type: "tool_result",
      toolUseId: "toolu_result",
      content: "failed",
      isError: true,
      metadata: {
        reason: "test"
      }
    });
  });
});

describe("tool root exports", () => {
  it("exports the tool protocol from the package root", async () => {
    const registry = new ToolRegistryFromRoot();
    const tool: RootToolDefinition = {
      name: "echo",
      description: "Echoes input.",
      execute(input) {
        return createToolResultFromRoot({ output: String(input) });
      }
    };
    const context: RootToolExecutionContext = {
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      metadata: {}
    };

    registry.register(tool);

    const result: RootToolResult = await executeRegisteredToolFromRoot(
      registry,
      {
        toolUseId: "toolu_root",
        toolName: "echo",
        input: "hello"
      },
      context
    );
    const block = createToolResultBlockFromRoot({
      toolUseId: "toolu_root",
      result
    });

    expect(block).toEqual({
      type: "tool_result",
      toolUseId: "toolu_root",
      content: "hello",
      isError: false,
      metadata: {}
    });
  });
});
