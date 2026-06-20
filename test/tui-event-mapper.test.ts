import { describe, expect, it } from "vitest";
import {
  createAssistantTurnCompleteEvent,
  createAssistantTextDeltaEvent,
  createErrorEvent,
  createStatusEvent,
  createToolExecutionCompletedEvent,
  createToolExecutionStartedEvent
} from "../src/stream-events/index.js";
import {
  createAssistantMessage,
  createTextBlock
} from "../src/index.js";
import {
  mapStreamEventToTuiEvents,
  summarizeToolInput,
  summarizeToolOutput
} from "../src/tui/model/event-mapper.js";
import * as tuiModel from "../src/tui/model/index.js";

describe("TUI stream event mapper", () => {
  it("keeps mapper helpers out of the TUI model barrel", () => {
    expect("mapStreamEventToTuiEvents" in tuiModel).toBe(false);
    expect("summarizeToolInput" in tuiModel).toBe(false);
    expect("summarizeToolOutput" in tuiModel).toBe(false);
  });

  it("maps assistant deltas into assistant display events", () => {
    expect(mapStreamEventToTuiEvents(createAssistantTextDeltaEvent("hello"))).toEqual([
      {
        type: "assistant_delta",
        text: "hello"
      }
    ]);
  });

  it("maps assistant turn completion into assistant completion display events", () => {
    expect(
      mapStreamEventToTuiEvents(
        createAssistantTurnCompleteEvent({
          message: createAssistantMessage([createTextBlock("Final response.")])
        })
      )
    ).toEqual([
      {
        type: "assistant_complete",
        text: "Final response."
      }
    ]);
  });

  it("maps tool start events into running tool traces", () => {
    expect(
      mapStreamEventToTuiEvents(
        createToolExecutionStartedEvent({
          toolName: "read_file",
          toolInput: { path: "src/index.ts" },
          toolUseId: "toolu_read_1"
        })
      )
    ).toEqual([
      {
        type: "tool_started",
        item: {
          kind: "tool_trace",
          toolName: "read_file",
          inputSummary: "path: src/index.ts",
          status: "running",
          toolUseId: "toolu_read_1"
        }
      }
    ]);
  });

  it("omits toolUseId from tool start events when the stream event has none", () => {
    const [event] = mapStreamEventToTuiEvents(
      createToolExecutionStartedEvent({
        toolName: "read_file",
        toolInput: { path: "src/index.ts" }
      })
    );

    expect(event).toEqual({
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: src/index.ts",
        status: "running"
      }
    });
    expect(event).not.toHaveProperty("item.toolUseId");
  });

  it("maps successful tool completion into completed tool traces", () => {
    expect(
      mapStreamEventToTuiEvents(
        createToolExecutionCompletedEvent({
          toolName: "grep",
          output: "src/index.ts:1:OpenHarness\nsrc/tui/index.ts:1:OpenHarness",
          toolUseId: "toolu_grep_1"
        })
      )
    ).toEqual([
      {
        type: "tool_completed",
        item: {
          kind: "tool_trace",
          toolName: "grep",
          inputSummary: "completed",
          status: "completed",
          toolUseId: "toolu_grep_1",
          resultSummary: "2 lines"
        }
      }
    ]);
  });

  it("omits toolUseId from tool completion events when the stream event has none", () => {
    const [event] = mapStreamEventToTuiEvents(
      createToolExecutionCompletedEvent({
        toolName: "grep",
        output: "src/index.ts:1:OpenHarness"
      })
    );

    expect(event).toEqual({
      type: "tool_completed",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "completed",
        status: "completed",
        resultSummary: "src/index.ts:1:OpenHarness"
      }
    });
    expect(event).not.toHaveProperty("item.toolUseId");
  });

  it("maps failed tool completion into failed tool traces", () => {
    expect(
      mapStreamEventToTuiEvents(
        createToolExecutionCompletedEvent({
          toolName: "exec",
          output: "permission denied\nstack omitted",
          isError: true
        })
      )
    ).toEqual([
      {
        type: "tool_completed",
        item: {
          kind: "tool_trace",
          toolName: "exec",
          inputSummary: "completed",
          status: "failed",
          errorSummary: "permission denied"
        }
      }
    ]);
  });

  it("maps status and error events into transcript items", () => {
    expect(mapStreamEventToTuiEvents(createStatusEvent("Retrying request"))).toEqual([
      {
        type: "transcript_item",
        item: {
          kind: "status",
          text: "Retrying request"
        }
      }
    ]);
    expect(
      mapStreamEventToTuiEvents(createErrorEvent("API error", { recoverable: false }))
    ).toEqual([
      {
        type: "error",
        message: "API error",
        detail: "Non-recoverable runtime error"
      }
    ]);
    expect(mapStreamEventToTuiEvents(createErrorEvent("Retry later"))).toEqual([
      {
        type: "error",
        message: "Retry later"
      }
    ]);
  });

  it("summarizes tool input deterministically", () => {
    expect(summarizeToolInput({ path: "src/index.ts" })).toBe("path: src/index.ts");
    expect(summarizeToolInput({ pattern: "OpenHarness", path: "src" })).toBe(
      "path: src - pattern: OpenHarness"
    );
    expect(summarizeToolInput({})).toBe("input");
  });

  it("coalesces path aliases by priority before adding other fields", () => {
    expect(
      summarizeToolInput({
        filePath: "b",
        file_path: "c",
        path: "a",
        pattern: "OpenHarness"
      })
    ).toBe("path: a - pattern: OpenHarness");
  });

  it("summarizes output by non-empty line count and first error line", () => {
    expect(summarizeToolOutput("one\ntwo\n")).toBe("2 lines");
    expect(summarizeToolOutput("")).toBe("empty output");
    expect(summarizeToolOutput("permission denied\nextra detail", { isError: true })).toBe(
      "permission denied"
    );
  });
});
