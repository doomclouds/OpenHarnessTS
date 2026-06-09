import { describe, expect, it } from "vitest";
import { createAssistantMessage, createTextBlock } from "../src/messages/index.js";
import {
  createAssistantTextDeltaEvent,
  createAssistantTurnCompleteEvent,
  createErrorEvent,
  createStatusEvent,
  createToolExecutionCompletedEvent,
  createToolExecutionStartedEvent
} from "../src/stream-events/index.js";

describe("stream events", () => {
  it("creates assistant text delta events", () => {
    expect(createAssistantTextDeltaEvent("hello")).toEqual({
      type: "assistant_text_delta",
      text: "hello"
    });
  });

  it("creates assistant turn complete events", () => {
    const message = createAssistantMessage([createTextBlock("done")]);

    expect(
      createAssistantTurnCompleteEvent({
        message,
        usage: {
          inputTokens: 10,
          outputTokens: 3
        },
        stopReason: "end_turn"
      })
    ).toEqual({
      type: "assistant_turn_complete",
      message,
      usage: {
        inputTokens: 10,
        outputTokens: 3
      },
      stopReason: "end_turn"
    });
  });

  it("preserves explicit assistant completion fields with falsy values", () => {
    const message = createAssistantMessage([createTextBlock("done")]);

    expect(
      createAssistantTurnCompleteEvent({
        message,
        usage: {
          inputTokens: 0,
          outputTokens: 0
        },
        stopReason: ""
      })
    ).toEqual({
      type: "assistant_turn_complete",
      message,
      usage: {
        inputTokens: 0,
        outputTokens: 0
      },
      stopReason: ""
    });
  });

  it("rejects assistant completion events for non-assistant messages", () => {
    expect(() =>
      createAssistantTurnCompleteEvent({
        message: {
          role: "user",
          content: [createTextBlock("hello")]
        }
      })
    ).toThrow("Assistant turn completion requires an assistant message.");
  });

  it("creates tool execution started events", () => {
    expect(
      createToolExecutionStartedEvent({
        toolName: "echo",
        toolInput: { value: "hello" },
        toolUseId: "toolu_fixed"
      })
    ).toEqual({
      type: "tool_execution_started",
      toolName: "echo",
      toolInput: { value: "hello" },
      toolUseId: "toolu_fixed"
    });
  });

  it("preserves explicit tool started fields with falsy values", () => {
    expect(
      createToolExecutionStartedEvent({
        toolName: "echo",
        toolInput: {},
        toolUseId: ""
      })
    ).toEqual({
      type: "tool_execution_started",
      toolName: "echo",
      toolInput: {},
      toolUseId: ""
    });
  });

  it("creates tool execution completed events with defaults", () => {
    expect(
      createToolExecutionCompletedEvent({
        toolName: "echo",
        output: "hello"
      })
    ).toEqual({
      type: "tool_execution_completed",
      toolName: "echo",
      output: "hello",
      isError: false
    });
  });

  it("preserves explicit tool completed fields with falsy values", () => {
    expect(
      createToolExecutionCompletedEvent({
        toolName: "echo",
        output: "",
        metadata: {},
        toolUseId: ""
      })
    ).toEqual({
      type: "tool_execution_completed",
      toolName: "echo",
      output: "",
      isError: false,
      metadata: {},
      toolUseId: ""
    });
  });

  it("creates status and error events", () => {
    expect(createStatusEvent("Working")).toEqual({
      type: "status",
      message: "Working"
    });
    expect(createErrorEvent("Nope")).toEqual({
      type: "error",
      message: "Nope",
      recoverable: true
    });
    expect(createErrorEvent("Nope", { recoverable: false })).toEqual({
      type: "error",
      message: "Nope",
      recoverable: false
    });
  });
});
