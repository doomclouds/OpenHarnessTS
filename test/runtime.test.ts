import { describe, expect, it } from "vitest";
import { HarnessRuntime } from "../src/index.js";
import type { ToolExecutionContext } from "../src/index.js";

const context: ToolExecutionContext = {
  sessionId: "test-session",
  metadata: {}
};

describe("HarnessRuntime", () => {
  it("registers and executes a tool", async () => {
    const runtime = new HarnessRuntime();

    runtime.registerTool({
      name: "echo",
      description: "Echoes input.",
      execute(input) {
        return {
          ok: true,
          output: input
        };
      }
    });

    const result = await runtime.executeTool("echo", "hello", context);

    expect(result).toEqual({
      ok: true,
      output: "hello"
    });
  });

  it("reports missing tools without throwing", async () => {
    const runtime = new HarnessRuntime();

    const result = await runtime.executeTool("missing", {}, context);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not registered");
  });

  it("rejects duplicate tool registrations", () => {
    const runtime = new HarnessRuntime({
      tools: [
        {
          name: "echo",
          description: "Echoes input.",
          execute: () => ({ ok: true })
        }
      ]
    });

    expect(() =>
      runtime.registerTool({
        name: "echo",
        description: "Echoes input again.",
        execute: () => ({ ok: true })
      })
    ).toThrow("already registered");
  });
});
