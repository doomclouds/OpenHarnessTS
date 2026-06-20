import { basename, win32 } from "node:path";
import {
  clampPermissionSelection,
  defaultPermissionOptions
} from "./permission-options.js";
import type {
  CommandDescriptor,
  PermissionDecision,
  TuiAction,
  TuiPanel,
  TuiPanelResult,
  TuiState,
  TuiTranscriptItem
} from "./types.js";

const maxVisibleCommands = 10;

const helpText =
  "Commands: /help show shortcuts, /status show display status, /clear clear transcript, /exit close session";

export function applyTuiAction(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "input_changed":
      return applyInputChanged(state, action.value);
    case "submit_input":
      return applySubmitInput(state);
    case "interrupt":
      return applyInterrupt(state);
    case "open_command_picker":
      return openCommandPicker(state);
    case "move_selection":
      return moveCommandSelection(state, action.direction);
    case "scroll_transcript":
      return scrollTranscript(state, action.direction, action.amount);
    case "confirm_selection":
      return confirmCommandSelection(state);
    case "move_panel_selection":
      return movePanelSelection(state, action.direction);
    case "confirm_panel_selection":
      return confirmPanelSelection(state);
    case "deny_panel":
      return closePermissionPanel(state, "denied");
    case "cancel_panel":
      return cancelPanel(state);
    case "exit":
      return requestExit(state);
  }
}

export function getVisibleCommands(
  state: TuiState
): readonly CommandDescriptor[] {
  return getVisibleCommandsForQuery(
    state.commands,
    state.commandPicker?.query ?? ""
  );
}

export function getVisibleCommandsForQuery(
  commands: readonly CommandDescriptor[],
  query: string
): readonly CommandDescriptor[] {
  const normalizedQuery = query.toLowerCase();

  return commands
    .filter((command) => command.enabled)
    .filter((command) => command.name.toLowerCase().includes(normalizedQuery))
    .slice(0, maxVisibleCommands);
}

export function moveCommandSelection(
  state: TuiState,
  direction: "up" | "down"
): TuiState {
  if (state.mode !== "command" || state.commandPicker === null) {
    return state;
  }

  const visibleCommands = getVisibleCommands(state);
  const maxIndex = Math.max(visibleCommands.length - 1, 0);
  const delta = direction === "down" ? 1 : -1;
  const selectedIndex = clamp(
    state.commandPicker.selectedIndex + delta,
    0,
    maxIndex
  );

  if (selectedIndex === state.commandPicker.selectedIndex) {
    return state;
  }

  return {
    ...state,
    commandPicker: {
      ...state.commandPicker,
      selectedIndex
    }
  };
}

function movePanelSelection(
  state: TuiState,
  direction: "previous" | "next"
): TuiState {
  if (state.activePanel?.kind !== "permission") {
    return state;
  }

  const currentIndex = state.panelSelectionIndex ?? 0;
  const delta = direction === "next" ? 1 : -1;
  const panelSelectionIndex = clampPermissionSelection(currentIndex + delta);

  if (panelSelectionIndex === currentIndex) {
    return state;
  }

  return {
    ...state,
    panelSelectionIndex
  };
}

function confirmPanelSelection(state: TuiState): TuiState {
  if (state.activePanel?.kind !== "permission") {
    return state;
  }

  const selectedIndex = clampPermissionSelection(state.panelSelectionIndex ?? 0);
  const selectedOption = defaultPermissionOptions[selectedIndex];
  if (selectedOption === undefined) {
    return state;
  }

  return closePermissionPanel(state, selectedOption.decision);
}

function closePermissionPanel(
  state: TuiState,
  decision: PermissionDecision
): TuiState {
  const panel = state.activePanel;
  if (panel?.kind !== "permission") {
    return state;
  }

  return closePanelWithResult(state, panel, {
    kind: "permission",
    requestId: panel.requestId,
    decision
  });
}

function closePanelWithResult(
  state: TuiState,
  panel: Extract<TuiPanel, { kind: "permission" }>,
  result: Extract<TuiPanelResult, { kind: "permission" }>
): TuiState {
  const { panelSelectionIndex: _panelSelectionIndex, ...stateWithoutSelection } =
    state;

  return {
    ...stateWithoutSelection,
    activePanel: null,
    commandPicker: null,
    mode: state.busy ? "busy" : "idle",
    transcript: [
      ...state.transcript,
      {
        kind: "status",
        text: formatPermissionPanelResult(panel.toolName, result.decision)
      } satisfies TuiTranscriptItem
    ]
  };
}

function formatPermissionPanelResult(
  toolName: string,
  decision: PermissionDecision
): string {
  switch (decision) {
    case "allowed_once":
      return `Permission allowed once for ${toolName}.`;
    case "allowed_always":
      return `Permission allowed always for ${toolName} in this project.`;
    case "denied":
      return `Permission denied for ${toolName}.`;
  }
}

function applyInputChanged(state: TuiState, value: string): TuiState {
  if (state.busy) {
    return {
      ...state,
      commandPicker: null,
      mode: "busy"
    };
  }

  if (state.activePanel !== null) {
    return {
      ...state,
      inputValue: value,
      commandPicker: null
    };
  }

  if (!value.startsWith("/")) {
    return {
      ...state,
      inputValue: value,
      commandPicker: null,
      mode: "idle"
    };
  }

  return openCommandPicker({
    ...state,
    inputValue: value
  });
}

function applySubmitInput(state: TuiState): TuiState {
  if (state.busy) {
    return state;
  }

  if (state.activePanel !== null) {
    return state;
  }

  if (state.mode === "command" && state.commandPicker !== null) {
    return confirmCommandSelection(state);
  }

  const trimmedText = state.inputValue.trim();
  if (trimmedText.length === 0) {
    return state;
  }

  return {
    ...state,
    mode: "idle",
    inputValue: "",
    commandPicker: null,
    transcriptScrollOffset: 0,
    transcript: [
      ...state.transcript,
      {
        kind: "user",
        text: trimmedText
      }
    ]
  };
}

function applyInterrupt(state: TuiState): TuiState {
  if (!state.busy) {
    return state;
  }

  return {
    ...state,
    interruptRequested: true,
    commandPicker: null,
    status: {
      ...state.status,
      busyLabel: "Stopping current operation..."
    }
  };
}

function openCommandPicker(state: TuiState): TuiState {
  if (
    state.busy ||
    state.activePanel !== null ||
    !state.inputValue.startsWith("/")
  ) {
    return state;
  }

  const query = state.inputValue.slice(1);
  const selectedIndex = clampSelectedIndex(state, query);

  return {
    ...state,
    mode: "command",
    commandPicker: {
      query,
      selectedIndex
    }
  };
}

function confirmCommandSelection(state: TuiState): TuiState {
  if (state.mode !== "command" || state.commandPicker === null) {
    return state;
  }

  const visibleCommands = getVisibleCommands(state);
  if (visibleCommands.length === 0) {
    return state;
  }

  const command =
    visibleCommands[
      clamp(state.commandPicker.selectedIndex, 0, visibleCommands.length - 1)
    ];
  if (command === undefined) {
    return state;
  }

  return executeLocalCommand(state, command);
}

function cancelPanel(state: TuiState): TuiState {
  if (state.activePanel?.kind === "permission") {
    return closePermissionPanel(state, "denied");
  }

  if (state.commandPicker === null) {
    return state;
  }

  return {
    ...state,
    commandPicker: null,
    mode: state.busy ? "busy" : "idle"
  };
}

function executeLocalCommand(
  state: TuiState,
  command: CommandDescriptor
): TuiState {
  switch (command.name) {
    case "/help":
      return appendStatusAndClose(state, helpText);
    case "/status":
      return appendStatusAndClose(state, formatDisplayStatus(state));
    case "/clear":
      return {
        ...state,
        transcript: [],
        assistantBuffer: "",
        inputValue: "",
        transcriptScrollOffset: 0,
        commandPicker: null,
        mode: "idle"
      };
    case "/exit":
      return requestExit(state);
    default:
      return state;
  }
}

function appendStatusAndClose(state: TuiState, text: string): TuiState {
  return {
    ...state,
    inputValue: "",
    commandPicker: null,
    mode: "idle",
    transcript: [
      ...state.transcript,
      {
        kind: "status",
        text
      } satisfies TuiTranscriptItem
    ]
  };
}

function requestExit(state: TuiState): TuiState {
  return {
    ...state,
    exitRequested: true,
    inputValue: "",
    commandPicker: null,
    mode: "idle"
  };
}

function scrollTranscript(
  state: TuiState,
  direction: "up" | "down",
  amount: number
): TuiState {
  const safeAmount = Math.max(1, Math.trunc(amount));
  const delta = direction === "up" ? safeAmount : -safeAmount;
  const maxOffset = Math.max(0, state.transcript.length - 1);
  const transcriptScrollOffset = clamp(
    state.transcriptScrollOffset + delta,
    0,
    maxOffset
  );

  if (transcriptScrollOffset === state.transcriptScrollOffset) {
    return state;
  }

  return {
    ...state,
    transcriptScrollOffset
  };
}

function formatDisplayStatus(state: TuiState): string {
  const modeLabel = state.busy ? "busy" : "idle";
  const parts = [`Status: ${modeLabel}`];

  if (state.status.modelLabel !== undefined) {
    parts.push(`model ${state.status.modelLabel}`);
  }
  if (state.status.cwdLabel !== undefined) {
    parts.push(`cwd ${state.status.cwdLabel}`);
  }
  if (state.status.permissionMode !== undefined) {
    parts.push(`permission ${state.status.permissionMode}`);
  }
  if (state.sessionArtifacts !== undefined) {
    parts.push(`session ${state.sessionArtifacts.sessionId}`);
    if (state.sessionArtifacts.latestPath !== undefined) {
      parts.push(`latest ${formatPathBasename(state.sessionArtifacts.latestPath)}`);
    }
    const transcriptPath =
      state.sessionArtifacts.transcriptPath ?? state.sessionArtifacts.markdownPath;
    if (transcriptPath !== undefined) {
      parts.push(`transcript ${formatPathBasename(transcriptPath)}`);
    }
  }

  return parts.join(" - ");
}

function formatPathBasename(path: string): string {
  return path.includes("\\") ? win32.basename(path) : basename(path);
}

function clampSelectedIndex(state: TuiState, query: string): number {
  const selectedIndex = state.commandPicker?.selectedIndex ?? 0;
  const candidateState: TuiState = {
    ...state,
    mode: "command",
    commandPicker: {
      query,
      selectedIndex
    }
  };
  const visibleCount = getVisibleCommands(candidateState).length;

  return clamp(
    selectedIndex,
    0,
    Math.max(visibleCount - 1, 0)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
