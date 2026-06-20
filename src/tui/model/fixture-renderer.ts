import { getVisibleCommands } from "./actions.js";
import { defaultPermissionOptions } from "./permission-options.js";
import type {
  CommandDescriptor,
  TuiState,
  TuiTranscriptItem
} from "./types.js";

const wideLayoutWidth = 100;
const maxTranscriptItems = 40;

export function renderTuiFixture(state: TuiState): string {
  const layout = getFixtureLayout(state);
  const bodyLines = [
    ...renderConversation(state),
    ...renderActivePanel(state)
  ];
  const lines = [
    renderStatusLine(state),
    "",
    ...cropBodyLines(bodyLines, layout.bodyHeight),
    ...renderCommandPicker(state),
    "",
    ...renderPromptFrame(state),
    renderFooter(state)
  ];

  return lines.filter((line) => line !== null).join("\n");
}

function getFixtureLayout(state: TuiState): {
  bodyHeight: number;
} {
  const headerRows = 2;
  const promptRows = 3;
  const footerRows = 1;
  const commandRows =
    state.mode === "command" &&
    state.commandPicker !== null &&
    state.activePanel === null
      ? Math.min(8, state.commands.length + 4)
      : 0;
  const reservedRows = headerRows + commandRows + promptRows + footerRows;
  return {
    bodyHeight: Math.max(3, state.height - reservedRows)
  };
}

function cropBodyLines(lines: readonly string[], height: number): readonly string[] {
  return lines.length <= height ? lines : lines.slice(-height);
}

function renderStatusLine(state: TuiState): string {
  const status = state.status;
  const left = `${status.productName}  alpha tui - ${status.screenTitle.toLowerCase()}`;
  const right = [
    isWide(state) && status.modelLabel !== undefined
      ? `model ${status.modelLabel}`
      : undefined,
    state.width >= 120 ? status.tokenLabel : undefined,
    status.permissionMode
  ]
    .filter(isPresent)
    .join(" - ");

  if (right.length === 0) {
    return left;
  }

  return `${left}${" ".repeat(Math.max(2, state.width - left.length - right.length - 2))}${right}`;
}

function renderConversation(state: TuiState): string[] {
  const items = state.transcript.slice(-maxTranscriptItems);
  const lines =
    items.length === 0
      ? renderWelcomeFrame(state)
      : items.flatMap(renderTranscriptItem);

  if (state.assistantBuffer.length > 0) {
    lines.push("");
    lines.push("* OpenHarness");
    lines.push(...renderAssistantBody(state.assistantBuffer));
  }

  return lines;
}

function renderTranscriptItem(item: TuiTranscriptItem): string[] {
  switch (item.kind) {
    case "user":
      return ["", `> ${item.text}`];
    case "assistant":
      return ["", "* OpenHarness", ...renderAssistantBody(item.text)];
    case "tool_trace":
      return renderToolTrace(item);
    case "status":
      return [`  * Status - ${item.text}`];
    case "error":
      return [
        "",
        "* Error",
        `  ${item.message}`,
        ...(item.detail === undefined ? [] : [`  ${item.detail}`])
      ];
  }
}

function renderToolTrace(
  item: Extract<TuiTranscriptItem, { kind: "tool_trace" }>
): string[] {
  const detail =
    item.status === "failed" ? item.errorSummary : item.resultSummary;
  const detailLine = [item.status, detail, item.durationLabel]
    .filter(isPresent)
    .join(" - ");

  return [
    `    ${formatToolCall(item)}`,
    ...(detailLine.length === 0 ? [] : [`      ${detailLine}`])
  ];
}

function renderActivePanel(state: TuiState): string[] {
  const panel = state.activePanel;

  if (panel === null) {
    return [];
  }

  if (panel.kind === "question") {
    return ["", "  * Question", `    ${panel.prompt}`];
  }

  return [
    "",
    "  * OpenHarness wants to run a command",
    ...renderFrame(
      [
        `${panel.toolName}  permission request`,
        "",
        ...(panel.commandPreview === undefined
          ? []
          : [formatCommandPreview(panel.commandPreview)]),
        ...(isWide(state) && panel.workingDirectory !== undefined
          ? [`Working directory: ${panel.workingDirectory}`]
          : []),
        ...(panel.reason === undefined ? [] : [`Reason: ${panel.reason}`]),
        "",
        defaultPermissionOptions
          .map((option, index) => {
            const marker = index === (state.panelSelectionIndex ?? 0) ? ">" : " ";
            return `${marker} ${option.label}`;
          })
          .join("   "),
        "Enter confirm - Tab move - Esc deny"
      ],
      frameInnerWidth(state, 96),
      4
    )
  ];
}

function renderCommandPicker(state: TuiState): string[] {
  if (
    state.mode !== "command" ||
    state.commandPicker === null ||
    state.activePanel !== null
  ) {
    return [];
  }

  const commands = getVisibleCommands(state);

  if (commands.length === 0) {
    return [
      "",
      ...renderFrame(
        ["Commands  type to filter", "", "No matching commands"],
        frameInnerWidth(state, 78),
        2
      )
    ];
  }

  return [
    "",
    ...renderFrame(
      [
        "Commands  type to filter",
        "",
        ...commands.map((command, index) =>
          renderCommand(command, index === state.commandPicker?.selectedIndex, state)
        )
      ],
      frameInnerWidth(state, 78),
      2
    )
  ];
}

function formatCommandPreview(commandPreview: string): string {
  return commandPreview.startsWith("$")
    ? commandPreview
    : `$ ${commandPreview}`;
}

function renderCommand(
  command: CommandDescriptor,
  selected: boolean,
  state: TuiState
): string {
  const marker = selected ? ">" : "-";

  if (isWide(state)) {
    return `  ${marker} ${command.name.padEnd(12)}  ${command.description}`;
  }

  return `  ${marker} ${command.name}`;
}

function renderPromptFrame(state: TuiState): string[] {
  const prompt = renderPrompt(state);
  return renderFrame([prompt], frameInnerWidth(state, 120), 0);
}

function renderPrompt(state: TuiState): string {
  if (state.busy) {
    return `... ${state.status.busyLabel ?? "Running..."}`;
  }

  return `> ${state.inputValue}`;
}

function renderFooter(state: TuiState): string {
  if (state.activePanel?.kind === "permission") {
    return "Tab to select - Enter to approve - Esc to deny";
  }

  if (state.mode === "command") {
    return "Up/Down move - Enter select - Esc close";
  }

  if (state.busy) {
    return "Esc to interrupt";
  }

  if (isWide(state)) {
    return state.footerHints.join(" - ");
  }

  return (
    state.footerHints.find((hint) => hint.includes("/")) ?? "/ for commands"
  );
}

function isWide(state: TuiState): boolean {
  return state.width >= wideLayoutWidth;
}

function renderAssistantBody(text: string): string[] {
  return text.split(/\r?\n/u).map((line) => `  ${normalizeAssistantLine(line)}`);
}

function normalizeAssistantLine(line: string): string {
  return line.replace(/\*\*([^*]+)\*\*/gu, "$1");
}

function renderWelcomeFrame(state: TuiState): string[] {
  return renderFrame(
    [
      "* Welcome to OpenHarness",
      "/help for help, /status for current setup"
    ],
    frameInnerWidth(state, 72),
    2
  );
}

function renderFrame(
  bodyLines: readonly string[],
  innerWidth: number,
  indent: number
): string[] {
  const prefix = " ".repeat(indent);
  const border = "-".repeat(innerWidth + 2);
  return [
    `${prefix}+${border}+`,
    ...bodyLines.map((line) => `${prefix}| ${line.padEnd(innerWidth)} |`),
    `${prefix}+${border}+`
  ];
}

function frameInnerWidth(state: TuiState, maxWidth: number): number {
  return Math.max(20, Math.min(state.width - 8, maxWidth));
}

function formatToolName(toolName: string): string {
  return toolName
    .split(/[_-]/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function formatToolCall(
  item: Extract<TuiTranscriptItem, { kind: "tool_trace" }>
): string {
  const inputSummary =
    item.inputSummary === "completed" || item.inputSummary === "input"
      ? ""
      : item.inputSummary;

  return inputSummary.length === 0
    ? formatToolName(item.toolName)
    : `${formatToolName(item.toolName)}(${inputSummary})`;
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}
