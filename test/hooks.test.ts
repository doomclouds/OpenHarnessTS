import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createAggregatedHookResult,
  InMemoryHookExecutor
} from "../src/hooks/index.js";
import type {
  HookEvent,
  HookExecutor,
  HookPayload
} from "../src/hooks/index.js";
import type { HookExecutor as RootHookExecutor } from "../src/index.js";

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
  it("binds registered handlers and payloads to the hook event type", () => {
    const executor = new InMemoryHookExecutor();

    executor.register("pre_tool_use", (payload) => {
      expectTypeOf(payload.toolName).toEqualTypeOf<string>();

      return {
        hookType: "guard",
        success: true
      };
    });

    const dynamicPayload: HookPayload = {
      event: "stop",
      stopReason: "tool_uses_empty"
    };
    void executor.execute(dynamicPayload);

    if (false) {
      // @ts-expect-error stop payloads cannot be executed as pre-tool hooks.
      void executor.execute("pre_tool_use", { event: "stop", stopReason: "tool_uses_empty" });

      const event: HookEvent = "pre_tool_use";
      const payload: HookPayload = {
        event: "stop",
        stopReason: "tool_uses_empty"
      };

      // @ts-expect-error mismatched event and payload variables are rejected.
      void executor.execute(event, payload);
    }
  });

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

  it("awaits async handlers when dispatching by payload", async () => {
    const executor = new InMemoryHookExecutor();
    const payload: HookPayload = {
      event: "stop",
      stopReason: "tool_uses_empty"
    };

    executor.register("stop", async () => {
      await Promise.resolve();

      return {
        hookType: "async",
        success: true,
        output: "done"
      };
    });

    const result = await executor.execute(payload);

    expect(result).toEqual({
      results: [
        {
          hookType: "async",
          success: true,
          output: "done"
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

describe("hook root exports", () => {
  it("exports the hook public surface from the package root", async () => {
    const root = await import("../src/index.js");

    expect(root.InMemoryHookExecutor).toBe(InMemoryHookExecutor);
    expect(root.createAggregatedHookResult).toBe(createAggregatedHookResult);
    expectTypeOf<RootHookExecutor>().toEqualTypeOf<HookExecutor>();
  });
});
