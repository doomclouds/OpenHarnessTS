import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode, TuiMode } from "../model/index.js";

export interface FooterHintsProps {
  mode: TuiMode;
  hints: readonly string[];
  width: number;
  colorMode: ColorMode;
  hasActivePanel: boolean;
  busy: boolean;
}

export function FooterHints({
  mode,
  hints,
  width,
  colorMode,
  hasActivePanel,
  busy
}: FooterHintsProps): ReactElement {
  const mutedColor = colorMode === "none" ? undefined : "gray";

  return (
    <Box marginBottom={0}>
      <Text {...textColor(mutedColor)}>
        {getFooterText({ mode, hints, width, hasActivePanel, busy })}
      </Text>
    </Box>
  );
}

function getFooterText({
  mode,
  hints,
  width,
  hasActivePanel,
  busy
}: {
  mode: TuiMode;
  hints: readonly string[];
  width: number;
  hasActivePanel: boolean;
  busy: boolean;
}): string {
  if (hasActivePanel) {
    return "Tab to select - Enter to approve - Esc to deny";
  }

  if (mode === "command") {
    return "Up/Down move - Enter select - Esc close";
  }

  if (busy) {
    return "Esc to interrupt";
  }

  if (width < 100) {
    return hints.find((hint) => hint.includes("/")) ?? "/ for commands";
  }

  return hints.join(" - ");
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
