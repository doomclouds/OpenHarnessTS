import { describe, expect, it } from "vitest";
import { HarnessRuntime } from "../src/index.js";
import { createToolResult } from "../src/tools/index.js";
import type { ToolExecutionContext } from "../src/index.js";

const context: ToolExecutionContext = {
  cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
  metadata: {
    session: "test-session"
  }
};

describe("HarnessRuntime", () => {
  it("registers and executes a tool", async () => {
    const runtime = new HarnessRuntime();

    runtime.registerTool({
      name: "echo",
      description: "Echoes input.",
      execute(input) {
        return createToolResult({
          output: String(input)
        });
      }
    });

    const result = await runtime.executeTool("echo", "hello", context);

    expect(result).toEqual({
      output: "hello",
      isError: false,
      metadata: {}
    });
  });

  it("reports missing tools without throwing", async () => {
    const runtime = new HarnessRuntime();

    const result = await runtime.executeTool("missing", {}, context);

    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unknown tool: missing");
  });

  it("rejects duplicate tool registrations", () => {
    const runtime = new HarnessRuntime({
      tools: [
        {
          name: "echo",
          description: "Echoes input.",
          execute: () => createToolResult({ output: "ok" })
        }
      ]
    });

    expect(() =>
      runtime.registerTool({
        name: "echo",
        description: "Echoes input again.",
        execute: () => createToolResult({ output: "ok" })
      })
    ).toThrow("already registered");
  });
});
