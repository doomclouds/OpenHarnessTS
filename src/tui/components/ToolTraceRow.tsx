import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode, TuiToolTraceItem } from "../model/index.js";

export interface ToolTraceRowProps {
  item: TuiToolTraceItem;
  colorMode: ColorMode;
}

export function ToolTraceRow({
  item,
  colorMode
}: ToolTraceRowProps): ReactElement {
  const rowColor =
    colorMode === "none" ? undefined : item.status === "failed" ? "red" : "cyan";
  const mutedColor = colorMode === "none" ? undefined : "gray";
  const detail = formatToolDetail(item);

  return (
    <Box flexDirection="column" marginLeft={4} marginTop={1}>
      <Text {...textColor(rowColor)}>{formatToolTrace(item)}</Text>
      {detail ? (
        <Box marginLeft={2}>
          <Text {...textColor(mutedColor)}>{detail}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function formatToolTrace(item: TuiToolTraceItem): string {
  const summary = formatInputSummary(item.inputSummary);
  return summary.length === 0
    ? formatToolName(item.toolName)
    : `${formatToolName(item.toolName)}(${summary})`;
}

export function formatToolDetail(item: TuiToolTraceItem): string {
  const detail =
    item.status === "failed" ? item.errorSummary : item.resultSummary;

  return [
    item.status,
    detail,
    item.durationLabel
  ]
    .filter(isPresent)
    .join(" - ");
}

function formatToolName(toolName: string): string {
  return toolName
    .split(/[_-]/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function formatInputSummary(inputSummary: string): string {
  return inputSummary === "completed" || inputSummary === "input"
    ? ""
    : inputSummary;
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
