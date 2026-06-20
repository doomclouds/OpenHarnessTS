import { getMessageText } from "../../messages/index.js";
import type { StreamEvent } from "../../stream-events/index.js";
import type { TuiEvent } from "./types.js";

interface SummarizeToolOutputOptions {
  readonly isError?: boolean;
}

export function mapStreamEventToTuiEvents(
  event: StreamEvent
): readonly TuiEvent[] {
  switch (event.type) {
    case "assistant_text_delta":
      return [
        {
          type: "assistant_delta",
          text: event.text
        }
      ];
    case "assistant_turn_complete": {
      const text = getMessageText(event.message);
      return [
        {
          type: "assistant_complete",
          ...(text.length === 0 ? {} : { text })
        }
      ];
    }
    case "tool_execution_started":
      return [
        {
          type: "tool_started",
          item: {
            kind: "tool_trace",
            toolName: event.toolName,
            inputSummary: summarizeToolInput(event.toolInput),
            status: "running",
            ...(event.toolUseId === undefined ? {} : { toolUseId: event.toolUseId })
          }
        }
      ];
    case "tool_execution_completed":
      return [
        {
          type: "tool_completed",
          item: {
            kind: "tool_trace",
            toolName: event.toolName,
            inputSummary: "completed",
            status: event.isError ? "failed" : "completed",
            ...(event.toolUseId === undefined ? {} : { toolUseId: event.toolUseId }),
            ...(event.isError
              ? { errorSummary: summarizeToolOutput(event.output, { isError: true }) }
              : { resultSummary: summarizeToolOutput(event.output) })
          }
        }
      ];
    case "status":
      return [
        {
          type: "transcript_item",
          item: {
            kind: "status",
            text: event.message
          }
        }
      ];
    case "error":
      return [
        {
          type: "error",
          message: event.message,
          ...(event.recoverable ? {} : { detail: "Non-recoverable runtime error" })
        }
      ];
  }
}

export function summarizeToolInput(
  input: Readonly<Record<string, unknown>>
): string {
  const fields = ["pattern", "command", "query"];
  const pathPart = summarizePathInput(input);
  const parts = fields.flatMap((field) => {
    const value = input[field];
    return value === undefined
      ? []
      : [`${field}: ${String(value)}`];
  });
  const summaryParts =
    pathPart === undefined ? parts : [pathPart, ...parts];

  if (summaryParts.length === 0) {
    return "input";
  }

  return shortenSummary(summaryParts.join(" - "), 96);
}

export function summarizeToolOutput(
  output: string,
  options: SummarizeToolOutputOptions = {}
): string {
  const trimmed = output.trim();

  if (trimmed.length === 0) {
    return "empty output";
  }

  if (options.isError) {
    return shortenSummary(trimmed.split(/\r?\n/u)[0] ?? "error", 96);
  }

  const lines = trimmed.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length === 1) {
    return shortenSummary(lines[0] ?? "1 line", 96);
  }

  return `${lines.length} lines`;
}

function summarizePathInput(
  input: Readonly<Record<string, unknown>>
): string | undefined {
  for (const field of ["path", "filePath", "file_path"]) {
    const value = input[field];
    if (value !== undefined) {
      return `path: ${String(value)}`;
    }
  }

  return undefined;
}

function shortenSummary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
