import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode } from "../model/index.js";

export interface AssistantTextProps {
  text: string;
  colorMode: ColorMode;
}

export function AssistantText({
  text,
  colorMode
}: AssistantTextProps): ReactElement {
  const assistantColor = colorMode === "none" ? undefined : "yellow";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text {...textColor(assistantColor)} bold>
        * OpenHarness
      </Text>
      {renderAssistantLines(text).map((line, index) => (
        <Box key={index} marginLeft={2}>
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function renderAssistantLines(text: string): readonly string[] {
  return text.split(/\r?\n/u).map(normalizeAssistantLine);
}

function normalizeAssistantLine(line: string): string {
  return line.replace(/\*\*([^*]+)\*\*/gu, "$1");
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
