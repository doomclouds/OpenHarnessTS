import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode, PermissionOption } from "../model/index.js";
import { TuiFrame } from "./TuiFrame.js";

export interface PermissionPanelProps {
  title: string;
  toolName: string;
  commandPreview?: string | undefined;
  workingDirectory?: string | undefined;
  reason?: string | undefined;
  selectedIndex: number;
  options: readonly PermissionOption[];
  width: number;
  colorMode: ColorMode;
  onSelect?: ((index: number) => void) | undefined;
  onConfirm?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
}

export function PermissionPanel({
  title,
  toolName,
  commandPreview,
  workingDirectory,
  reason,
  selectedIndex,
  options,
  width,
  colorMode
}: PermissionPanelProps): ReactElement {
  const accentColor = colorMode === "none" ? undefined : "yellow";
  const toolColor = colorMode === "none" ? undefined : "cyan";
  const mutedColor = colorMode === "none" ? undefined : "gray";
  const showWideMetadata = width >= 100;

  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <Text {...textColor(accentColor)} bold>
        * {title}
      </Text>
      <TuiFrame
        colorMode={colorMode}
        marginTop={1}
        maxWidth={Math.max(72, width - 8)}
        paddingX={0}
        width={width}
      >
        <Box paddingX={2}>
          <Text {...textColor(toolColor)} bold>
            {toolName}
          </Text>
          <Text {...textColor(mutedColor)}> permission request</Text>
        </Box>
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          {commandPreview ? (
            <Text>
              {commandPreview.startsWith("$")
                ? commandPreview
                : `$ ${commandPreview}`}
            </Text>
          ) : null}
          {showWideMetadata && workingDirectory ? (
            <Text {...textColor(mutedColor)}>
              Working directory: {workingDirectory}
            </Text>
          ) : null}
          {reason ? (
            <Text {...textColor(mutedColor)}>Reason: {reason}</Text>
          ) : null}
          <Box marginTop={1} flexDirection={width >= 100 ? "row" : "column"}>
            {options.map((option, index) => (
              <PermissionOptionView
                key={option.decision}
                option={option}
                selected={index === selectedIndex}
                colorMode={colorMode}
                padRight={width >= 100}
              />
            ))}
          </Box>
          <Text {...textColor(mutedColor)}>
            Enter confirm - Tab move - Esc deny
          </Text>
        </Box>
      </TuiFrame>
    </Box>
  );
}

function PermissionOptionView({
  option,
  selected,
  colorMode,
  padRight
}: {
  option: PermissionOption;
  selected: boolean;
  colorMode: ColorMode;
  padRight: boolean;
}): ReactElement {
  const color =
    colorMode === "none"
      ? undefined
      : option.tone === "success"
        ? "green"
        : option.tone === "danger"
          ? "red"
          : undefined;
  const marker = selected ? "> " : "  ";
  const suffix = padRight ? "   " : "";

  return (
    <Text {...textColor(color)}>
      {marker}
      {option.label}
      {suffix}
    </Text>
  );
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
