import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode, TuiTranscriptItem } from "../model/index.js";
import { AssistantText } from "./AssistantText.js";
import { ErrorBlock } from "./ErrorBlock.js";
import { ToolTraceRow } from "./ToolTraceRow.js";
import { WelcomeBanner } from "./WelcomeBanner.js";

export interface ConversationViewProps {
  items: readonly TuiTranscriptItem[];
  assistantBuffer: string;
  showWelcome: boolean;
  maxVisibleItems: number;
  scrollOffset: number;
  colorMode: ColorMode;
  width?: number | undefined;
}

export function ConversationView({
  items,
  assistantBuffer,
  showWelcome,
  maxVisibleItems,
  scrollOffset,
  colorMode,
  width
}: ConversationViewProps): ReactElement {
  const visibleCount = Math.max(0, Math.trunc(maxVisibleItems));
  const visibleItems = selectVisibleTranscriptItems(
    items,
    visibleCount,
    scrollOffset
  );
  const shouldShowWelcome =
    showWelcome && visibleItems.length === 0 && assistantBuffer.length === 0;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {shouldShowWelcome ? (
        <WelcomeBanner colorMode={colorMode} width={width} />
      ) : null}
      {visibleItems.map((item, index) => (
        <TranscriptItemView
          key={`${item.kind}-${index}`}
          item={item}
          colorMode={colorMode}
        />
      ))}
      {assistantBuffer.length > 0 ? (
        <AssistantText text={assistantBuffer} colorMode={colorMode} />
      ) : null}
    </Box>
  );
}

function selectVisibleTranscriptItems(
  items: readonly TuiTranscriptItem[],
  rowBudget: number,
  scrollOffset: number
): readonly TuiTranscriptItem[] {
  if (rowBudget <= 0) {
    return [];
  }

  const sourceItems = items.slice(
    0,
    Math.max(0, items.length - Math.max(0, Math.trunc(scrollOffset)))
  );
  const selected: TuiTranscriptItem[] = [];
  let usedRows = 0;

  for (let index = sourceItems.length - 1; index >= 0; index -= 1) {
    const item = sourceItems[index];
    if (item === undefined) {
      continue;
    }

    const itemRows = estimateTranscriptItemRows(item);
    if (selected.length > 0 && usedRows + itemRows > rowBudget) {
      if (!selected.some(hasConversationContent) && hasConversationContent(item)) {
        selected.unshift(trimTranscriptItemToRows(item, rowBudget - usedRows));
      }
      break;
    }

    selected.unshift(item);
    usedRows += itemRows;

    if (usedRows >= rowBudget) {
      break;
    }
  }

  return selected;
}

function hasConversationContent(item: TuiTranscriptItem): boolean {
  return item.kind !== "status";
}

function trimTranscriptItemToRows(
  item: TuiTranscriptItem,
  rowBudget: number
): TuiTranscriptItem {
  if (item.kind !== "assistant") {
    return item;
  }

  const availableTextRows = Math.max(1, rowBudget - 3);
  const lines = item.text.split(/\r?\n/u);

  if (lines.length <= availableTextRows) {
    return item;
  }

  return {
    ...item,
    text: lines.slice(-availableTextRows).join("\n")
  };
}

function estimateTranscriptItemRows(item: TuiTranscriptItem): number {
  switch (item.kind) {
    case "user":
      return 3;
    case "assistant":
      return 3 + countTextLines(item.text);
    case "tool_trace":
      return item.resultSummary !== undefined || item.errorSummary !== undefined
        ? 4
        : 3;
    case "status":
      return 1;
    case "error":
      return item.detail === undefined ? 3 : 4;
  }
}

function countTextLines(text: string): number {
  return Math.max(1, text.split(/\r?\n/u).length);
}

function TranscriptItemView({
  item,
  colorMode
}: {
  item: TuiTranscriptItem;
  colorMode: ColorMode;
}): ReactElement {
  const mutedColor = colorMode === "none" ? undefined : "gray";

  switch (item.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text>
            <Text {...textColor(colorMode === "none" ? undefined : "cyan")}>
              {"> "}
            </Text>
            <Text bold>{item.text}</Text>
          </Text>
        </Box>
      );
    case "assistant":
      return <AssistantText text={item.text} colorMode={colorMode} />;
    case "tool_trace":
      return <ToolTraceRow item={item} colorMode={colorMode} />;
    case "status":
      return (
        <Box marginLeft={2}>
          <Text {...textColor(mutedColor)}>* Status - {item.text}</Text>
        </Box>
      );
    case "error":
      return (
        <ErrorBlock
          message={item.message}
          detail={item.detail}
          colorMode={colorMode}
        />
      );
  }
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
