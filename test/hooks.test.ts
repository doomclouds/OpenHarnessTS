import { describe, expect, it } from "vitest";
import {
  createAggregatedHookResult,
  InMemoryHookExecutor
} from "../src/hooks/index.js";

describe("hook aggregation", () => {
  it("returns the first blocking reason", () => {
    const result = createAggregatedHookResult([
      {
        hookType: "first",
        success: true,
        blocked: false
      },
      {
        hookType: "second",
        success: true,
        blocked: true,
        reason: "blocked by second"
      },
      {
        hookType: "third",
        success: true,
        blocked: true,
        reason: "blocked by third"
      }
    ]);

    expect(result).toEqual({
      results: [
        {
          hookType: "first",
          success: true,
          blocked: false
        },
        {
          hookType: "second",
          success: true,
          blocked: true,
          reason: "blocked by second"
        },
        {
          hookType: "third",
          success: true,
          blocked: true,
          reason: "blocked by third"
        }
      ],
      blocked: true,
      reason: "blocked by second"
    });
  });

  it("uses blocking output when reason is absent", () => {
    const result = createAggregatedHookResult([
      {
        hookType: "guard",
        success: true,
        blocked: true,
        output: "blocked by output"
      }
    ]);

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("blocked by output");
  });
});

describe("InMemoryHookExecutor", () => {
  it("returns a non-blocking aggregate when no handlers are registered", async () => {
    const executor = new InMemoryHookExecutor();

    const result = await executor.execute("stop", {
      event: "stop",
      stopReason: "tool_uses_empty"
    });

    expect(result).toEqual({
      results: [],
      blocked: false,
      reason: ""
    });
  });

  it("runs handlers in insertion order", async () => {
    const executor = new InMemoryHookExecutor();
    const calls: string[] = [];

    executor.register("pre_tool_use", () => {
      calls.push("first");
      return {
        hookType: "first",
        success: true
      };
    });
    executor.register("pre_tool_use", () => {
      calls.push("second");
      return {
        hookType: "second",
        success: true
      };
    });

    const result = await executor.execute("pre_tool_use", {
      event: "pre_tool_use",
      toolName: "read",
      toolInput: { path: "README.md" },
      toolUseId: "toolu_read"
    });

    expect(calls).toEqual(["first", "second"]);
    expect(result.results.map((entry) => entry.hookType)).toEqual([
      "first",
      "second"
    ]);
  });

  it("records void handlers as successful in-memory results", async () => {
    const executor = new InMemoryHookExecutor();

    executor.register("user_prompt_submit", () => undefined);

    const result = await executor.execute("user_prompt_submit", {
      event: "user_prompt_submit",
      prompt: "hello"
    });

    expect(result).toEqual({
      results: [
        {
          hookType: "in_memory",
          success: true
        }
      ],
      blocked: false,
      reason: ""
    });
  });

  it("turns thrown handlers into failed non-blocking results", async () => {
    const executor = new InMemoryHookExecutor();

    executor.register("stop", () => {
      throw new Error("hook exploded");
    });

    const result = await executor.execute("stop", {
      event: "stop",
      stopReason: "tool_uses_empty"
    });

    expect(result).toEqual({
      results: [
        {
          hookType: "in_memory",
          success: false,
          output: "hook exploded"
        }
      ],
      blocked: false,
      reason: ""
    });
  });
});
