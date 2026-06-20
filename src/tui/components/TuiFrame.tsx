import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";
import type { ColorMode } from "../model/index.js";

export interface TuiFrameProps {
  children: ReactNode;
  colorMode: ColorMode;
  width: number;
  maxWidth?: number | undefined;
  tone?: "accent" | "muted" | "danger" | undefined;
  paddingX?: number | undefined;
  paddingY?: number | undefined;
  marginTop?: number | undefined;
  marginLeft?: number | undefined;
}

export function TuiFrame({
  children,
  colorMode,
  width,
  maxWidth,
  tone = "muted",
  paddingX = 2,
  paddingY = 0,
  marginTop = 0,
  marginLeft = 0
}: TuiFrameProps): ReactElement {
  return (
    <Box
      borderStyle="single"
      borderColor={frameColor(colorMode, tone)}
      flexDirection="column"
      marginLeft={marginLeft}
      marginTop={marginTop}
      paddingX={paddingX}
      paddingY={paddingY}
      width={frameWidth(width, maxWidth)}
    >
      {children}
    </Box>
  );
}

export function FrameDivider({
  colorMode,
  width
}: {
  colorMode: ColorMode;
  width: number;
}): ReactElement {
  const color = colorMode === "none" ? undefined : "gray";
  return <Text {...textColor(color)}>{"-".repeat(Math.max(12, width))}</Text>;
}

export function frameWidth(width: number, maxWidth?: number | undefined): number {
  const safeWidth = Math.max(24, Math.trunc(width));
  return Math.max(24, Math.min(safeWidth - 4, maxWidth ?? safeWidth - 4));
}

function frameColor(
  colorMode: ColorMode,
  tone: "accent" | "muted" | "danger"
): string | undefined {
  if (colorMode === "none") {
    return undefined;
  }

  if (tone === "accent") {
    return "yellow";
  }

  if (tone === "danger") {
    return "red";
  }

  return "gray";
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
