import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode } from "../model/index.js";
import { TuiFrame } from "./TuiFrame.js";

export interface PromptInputProps {
  value: string;
  busy: boolean;
  colorMode: ColorMode;
  width?: number | undefined;
  placeholder?: string | undefined;
  busyLabel?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onSubmit?: ((value: string) => void) | undefined;
  onInterrupt?: (() => void) | undefined;
}

export function PromptInput({
  value,
  busy,
  colorMode,
  width = 96,
  placeholder,
  busyLabel
}: PromptInputProps): ReactElement {
  const promptColor = colorMode === "none" ? undefined : "cyan";
  const mutedColor = colorMode === "none" ? undefined : "gray";

  if (busy) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <TuiFrame colorMode={colorMode} width={width}>
          <Box>
            <Text {...textColor(promptColor)}>{"... "}</Text>
            <Text>{busyLabel ?? "Running..."}</Text>
          </Box>
        </TuiFrame>
      </Box>
    );
  }

  const promptText = value || placeholder;

  return (
    <Box flexDirection="column" marginTop={1}>
      <TuiFrame colorMode={colorMode} width={width}>
        <Box>
          <Text {...textColor(promptColor)}>{"> "}</Text>
          {promptText ? (
            <Text>{promptText}</Text>
          ) : (
            <Text {...textColor(mutedColor)}>|</Text>
          )}
        </Box>
      </TuiFrame>
    </Box>
  );
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
