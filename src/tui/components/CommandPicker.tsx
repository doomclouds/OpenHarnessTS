import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { getVisibleCommandsForQuery } from "../model/index.js";
import type { ColorMode, CommandDescriptor } from "../model/index.js";
import { TuiFrame } from "./TuiFrame.js";

export interface CommandPickerProps {
  query: string;
  commands: readonly CommandDescriptor[];
  selectedIndex: number;
  width: number;
  colorMode: ColorMode;
  showKeyboardHint?: boolean | undefined;
  onSelect?: ((index: number) => void) | undefined;
  onConfirm?: ((commandName: string) => void) | undefined;
  onCancel?: (() => void) | undefined;
}

export function CommandPicker({
  query,
  commands,
  selectedIndex,
  width,
  colorMode,
  showKeyboardHint = true
}: CommandPickerProps): ReactElement {
  const visibleCommands = getVisibleCommandsForQuery(commands, query);
  const selectedVisibleIndex =
    visibleCommands.length === 0
      ? -1
      : clamp(selectedIndex, 0, visibleCommands.length - 1);
  const showDescriptions = width >= 100;
  const accentColor = colorMode === "none" ? undefined : "cyan";
  const mutedColor = colorMode === "none" ? undefined : "gray";

  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <TuiFrame colorMode={colorMode} maxWidth={82} paddingX={0} width={width}>
        <Box paddingX={2}>
          <Text {...textColor(accentColor)} bold>
            Commands
          </Text>
          <Text {...textColor(mutedColor)}>  type to filter</Text>
        </Box>
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          {visibleCommands.length === 0 ? <Text>No matching commands</Text> : null}
          {visibleCommands.map((command, index) => (
            <CommandPickerItem
              key={command.name}
              command={command}
              selected={index === selectedVisibleIndex}
              showDescription={showDescriptions}
              colorMode={colorMode}
            />
          ))}
        </Box>
      </TuiFrame>
      {showKeyboardHint ? (
        <Text {...textColor(mutedColor)}>
          Up/Down move - Enter select - Esc close
        </Text>
      ) : null}
    </Box>
  );
}

function CommandPickerItem({
  command,
  selected,
  showDescription,
  colorMode
}: {
  command: CommandDescriptor;
  selected: boolean;
  showDescription: boolean;
  colorMode: ColorMode;
}): ReactElement {
  const selectedColor = colorMode === "none" ? undefined : "cyan";
  const descriptionColor = colorMode === "none" ? undefined : "gray";
  const commandLabel = showDescription ? command.name.padEnd(12) : command.name;

  return (
    <Box marginBottom={1}>
      <Text {...textColor(selected ? selectedColor : undefined)}>
        {selected ? "> " : "  "}
        {commandLabel}
      </Text>
      {showDescription ? (
        <Text {...textColor(descriptionColor)}>  {command.description}</Text>
      ) : null}
    </Box>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
