import type { CliOutputFormat } from "./parser.js";
import type { PrintModeResult } from "./print-mode.js";
import type { StreamEvent } from "../stream-events/index.js";

export interface CliToolResultSummary {
  readonly toolName: string;
  readonly isError: boolean;
  readonly output: string;
  readonly toolUseId?: string;
}

export interface CliStatusSummary {
  readonly message: string;
}

export interface CliErrorSummary {
  readonly message: string;
  readonly recoverable: boolean;
}

export interface CliRunSummary {
  readonly eventCount: number;
  readonly textDeltaCount: number;
  readonly toolCallCount: number;
  readonly toolResults: readonly CliToolResultSummary[];
  readonly statuses: readonly CliStatusSummary[];
  readonly errors: readonly CliErrorSummary[];
}

export interface CliFinalResultOutput {
  readonly type: "final_result";
  readonly outputFormat: "json" | "stream-json";
  readonly assistantText: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly model: string;
  readonly snapshotPath: string;
  readonly summary: CliRunSummary;
}

export type CliStreamJsonEvent =
  | {
      readonly type: "assistant_text_delta";
      readonly sequence: number;
      readonly text: string;
    }
  | {
      readonly type: "tool_execution_started";
      readonly sequence: number;
      readonly toolName: string;
      readonly toolInput: Readonly<Record<string, unknown>>;
      readonly toolUseId?: string;
    }
  | {
      readonly type: "tool_execution_completed";
      readonly sequence: number;
      readonly toolName: string;
      readonly output: string;
      readonly isError: boolean;
      readonly toolUseId?: string;
    }
  | {
      readonly type: "status";
      readonly sequence: number;
      readonly message: string;
    }
  | {
      readonly type: "error";
      readonly sequence: number;
      readonly message: string;
      readonly recoverable: boolean;
    }
  | CliFinalResultOutput;

export interface CliErrorOutput {
  readonly type: "error";
  readonly outputFormat: "json" | "stream-json";
  readonly message: string;
  readonly code?: string;
}

export interface RenderCliOutputOptions {
  readonly result: PrintModeResult;
  readonly format: CliOutputFormat;
}

export interface RenderCliErrorOutputOptions {
  readonly format: CliOutputFormat;
  readonly message: string;
  readonly code?: string;
}

export function renderCliOutput(options: RenderCliOutputOptions): string {
  if (options.format === "text") {
    return `${options.result.assistantText}\n`;
  }

  if (options.format === "json") {
    return `${JSON.stringify(createFinalResult(options.result, "json"))}\n`;
  }

  const events = createStreamJsonEvents(options.result);
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

export function renderCliErrorOutput(
  options: RenderCliErrorOutputOptions
): string {
  if (options.format === "text") {
    return `${options.message}\n`;
  }

  const output: CliErrorOutput = {
    type: "error",
    outputFormat: options.format,
    message: options.message,
    ...(options.code === undefined ? {} : { code: options.code })
  };

  return `${JSON.stringify(output)}\n`;
}

function createFinalResult(
  result: PrintModeResult,
  outputFormat: "json" | "stream-json"
): CliFinalResultOutput {
  return {
    type: "final_result",
    outputFormat,
    assistantText: result.assistantText,
    sessionId: result.sessionId,
    cwd: result.cwd,
    model: result.model,
    snapshotPath: result.snapshotPath,
    summary: summarizeEvents(result.events)
  };
}

function summarizeEvents(events: readonly StreamEvent[]): CliRunSummary {
  return {
    eventCount: events.length,
    textDeltaCount: events.filter(
      (event) => event.type === "assistant_text_delta"
    ).length,
    toolCallCount: events.filter(
      (event) => event.type === "tool_execution_started"
    ).length,
    toolResults: events.flatMap((event) =>
      event.type === "tool_execution_completed"
        ? [
            {
              toolName: event.toolName,
              output: event.output,
              isError: event.isError,
              ...(event.toolUseId === undefined
                ? {}
                : { toolUseId: event.toolUseId })
            }
          ]
        : []
    ),
    statuses: events.flatMap((event) =>
      event.type === "status" ? [{ message: event.message }] : []
    ),
    errors: events.flatMap((event) =>
      event.type === "error"
        ? [{ message: event.message, recoverable: event.recoverable }]
        : []
    )
  };
}

function createStreamJsonEvents(
  result: PrintModeResult
): readonly CliStreamJsonEvent[] {
  const events: CliStreamJsonEvent[] = [];

  for (const [index, event] of result.events.entries()) {
    const sequence = index + 1;

    switch (event.type) {
      case "assistant_text_delta":
        events.push({
          type: "assistant_text_delta",
          sequence,
          text: event.text
        });
        break;
      case "tool_execution_started":
        events.push({
          type: "tool_execution_started",
          sequence,
          toolName: event.toolName,
          toolInput: event.toolInput,
          ...(event.toolUseId === undefined
            ? {}
            : { toolUseId: event.toolUseId })
        });
        break;
      case "tool_execution_completed":
        events.push({
          type: "tool_execution_completed",
          sequence,
          toolName: event.toolName,
          output: event.output,
          isError: event.isError,
          ...(event.toolUseId === undefined
            ? {}
            : { toolUseId: event.toolUseId })
        });
        break;
      case "status":
        events.push({
          type: "status",
          sequence,
          message: event.message
        });
        break;
      case "error":
        events.push({
          type: "error",
          sequence,
          message: event.message,
          recoverable: event.recoverable
        });
        break;
      case "assistant_turn_complete":
        break;
      default:
        assertNever(event);
    }
  }

  events.push(createFinalResult(result, "stream-json"));
  return events;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled CLI output event: ${String(value)}`);
}
