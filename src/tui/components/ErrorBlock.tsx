import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode } from "../model/index.js";
import { TuiFrame } from "./TuiFrame.js";

export interface ErrorBlockProps {
  message: string;
  detail?: string | undefined;
  colorMode: ColorMode;
}

export function ErrorBlock({
  message,
  detail,
  colorMode
}: ErrorBlockProps): ReactElement {
  const dangerColor = colorMode === "none" ? undefined : "red";
  const mutedColor = colorMode === "none" ? undefined : "gray";

  return (
    <Box flexDirection="column" marginTop={1}>
      <TuiFrame colorMode={colorMode} maxWidth={88} tone="danger" width={96}>
        <Text {...textColor(dangerColor)} bold>
          * Error
        </Text>
        <Text>{message}</Text>
        {detail ? <Text {...textColor(mutedColor)}>{detail}</Text> : null}
      </TuiFrame>
    </Box>
  );
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
