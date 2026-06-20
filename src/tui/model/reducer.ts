import type {
  CommandDescriptor,
  CreateInitialTuiStateOptions,
  TuiEvent,
  TuiPanelResult,
  TuiReadyState,
  TuiState,
  TuiStatus,
  TuiToolTraceItem,
  TuiTranscriptItem
} from "./types.js";

const defaultCommands: readonly CommandDescriptor[] = [
  {
    name: "/help",
    description: "Show available commands",
    enabled: true,
    category: "help"
  },
  {
    name: "/status",
    description: "Show current session status",
    enabled: true,
    category: "session"
  },
  {
    name: "/clear",
    description: "Clear the local transcript",
    enabled: true,
    category: "session"
  },
  {
    name: "/exit",
    description: "Exit the interactive session",
    enabled: true,
    category: "runtime"
  }
];

const defaultFooterHints = [
  "? for shortcuts",
  "/ for commands",
  "Esc to interrupt"
] as const;

export function createInitialTuiState(
  options: CreateInitialTuiStateOptions = {}
): TuiState {
  return {
    ready: false,
    busy: false,
    mode: "idle",
    status: createInitialStatus(options),
    transcript: [],
    assistantBuffer: "",
    activePanel: null,
    commandPicker: null,
    commands: createDefaultCommands(),
    inputValue: options.inputValue ?? "",
    footerHints: createDefaultFooterHints(),
    colorMode: options.colorMode ?? "full",
    width: options.width ?? 120,
    height: options.height ?? 30,
    transcriptScrollOffset: 0
  };
}

function createDefaultCommands(): readonly CommandDescriptor[] {
  return defaultCommands.map((command) => ({ ...command }));
}

function createDefaultFooterHints(): readonly string[] {
  return [...defaultFooterHints];
}

export function applyTuiEvent(state: TuiState, event: TuiEvent): TuiState {
  switch (event.type) {
    case "ready":
      return applyReadyEvent(state, event.state);
    case "transcript_item":
      return appendTranscriptItem(state, event.item);
    case "turn_started":
      return {
        ...state,
        busy: true,
        mode: "busy",
        activePanel: null,
        commandPicker: null,
        status: {
          ...state.status,
          busyLabel: event.busyLabel ?? "Thinking..."
        }
      };
    case "assistant_delta":
      return {
        ...state,
        assistantBuffer: state.assistantBuffer + event.text
      };
    case "assistant_complete": {
      const text = event.text ?? state.assistantBuffer;
      return {
        ...state,
        assistantBuffer: "",
        transcript:
          text.length > 0
            ? [
                ...state.transcript,
                {
                  kind: "assistant",
                  text
                }
              ]
            : state.transcript
      };
    }
    case "tool_started":
      return {
        ...state,
        busy: true,
        mode: "busy",
        commandPicker: null,
        status: {
          ...state.status,
          busyLabel: `Running ${event.item.toolName}...`
        },
        transcript: [...state.transcript, event.item]
      };
    case "tool_completed":
      return {
        ...state,
        status: state.busy
          ? {
              ...state.status,
              busyLabel: "Processing..."
            }
          : state.status,
        transcript: upsertCompletedToolTrace(state.transcript, event.item)
      };
    case "panel_opened": {
      const nextState =
        event.panel.kind === "permission" ? state : clearPanelSelection(state);

      return {
        ...nextState,
        activePanel: event.panel,
        ...(event.panel.kind === "permission" ? { panelSelectionIndex: 0 } : {}),
        commandPicker: null,
        mode: event.panel.kind === "permission" ? "permission" : state.mode
      };
    }
    case "panel_closed":
      if (state.activePanel === null) {
        return state;
      }
      if (event.result === undefined) {
        const clearedState = clearPanelSelection(state);
        return {
          ...clearedState,
          activePanel: null,
          mode: state.busy ? "busy" : "idle"
        };
      }
      if (!isPanelCloseResultForActivePanel(state.activePanel, event.result)) {
        return state;
      }
      {
        const clearedState = clearPanelSelection(state);
        return {
          ...clearedState,
          activePanel: null,
          mode: state.busy ? "busy" : "idle",
          transcript: appendPanelResult(
            state.transcript,
            state.activePanel,
            event.result
          )
        };
      }
    case "status_changed":
      return {
        ...state,
        status: {
          ...state.status,
          ...event.status
        }
      };
    case "line_complete": {
      const completedState = clearBusyState(state);
      const transcript =
        event.artifacts === undefined
          ? completedState.transcript
          : [
              ...completedState.transcript,
              {
                kind: "status",
                text: `Session saved: ${event.artifacts.sessionId}`
              } satisfies TuiTranscriptItem
            ];

      return event.artifacts === undefined
        ? {
            ...completedState,
            transcript
          }
        : {
            ...completedState,
            sessionArtifacts: event.artifacts,
            transcript
          };
    }
    case "error": {
      const cleared = clearBusyState(state);
      return {
        ...cleared,
        transcript: [
          ...cleared.transcript,
          createErrorItem(event.message, event.detail)
        ]
      };
    }
  }
}

function applyReadyEvent(
  state: TuiState,
  readyState: TuiReadyState | undefined
): TuiState {
  return mergeReadyState(state, readyState);
}

function mergeReadyState(
  state: TuiState,
  incoming: TuiReadyState | undefined
): TuiState {
  if (incoming === undefined) {
    return {
      ...state,
      ready: true
    };
  }

  const nextState: TuiState = {
    ...state,
    ready: true,
    status: {
      ...state.status,
      ...incoming.status
    }
  };

  if (incoming.commands !== undefined) {
    nextState.commands = incoming.commands;
  }
  if (incoming.footerHints !== undefined) {
    nextState.footerHints = incoming.footerHints;
  }
  if (incoming.colorMode !== undefined) {
    nextState.colorMode = incoming.colorMode;
  }
  if (incoming.width !== undefined) {
    nextState.width = incoming.width;
  }
  if (incoming.height !== undefined) {
    nextState.height = incoming.height;
  }
  if (incoming.sessionArtifacts !== undefined) {
    nextState.sessionArtifacts = incoming.sessionArtifacts;
  }

  return nextState;
}

function createInitialStatus(
  options: CreateInitialTuiStateOptions
): TuiStatus {
  return {
    productName: "OpenHarness",
    screenTitle: "Interactive Session",
    ...(options.modelLabel === undefined
      ? {}
      : { modelLabel: options.modelLabel }),
    ...(options.tokenLabel === undefined
      ? {}
      : { tokenLabel: options.tokenLabel }),
    ...(options.permissionMode === undefined
      ? {}
      : { permissionMode: options.permissionMode }),
    ...(options.cwdLabel === undefined ? {} : { cwdLabel: options.cwdLabel })
  };
}

function appendTranscriptItem(
  state: TuiState,
  item: TuiTranscriptItem
): TuiState {
  return {
    ...state,
    transcript: [...state.transcript, item]
  };
}

function upsertCompletedToolTrace(
  transcript: readonly TuiTranscriptItem[],
  item: TuiToolTraceItem
): readonly TuiTranscriptItem[] {
  const index = findRunningToolTraceIndex(transcript, item);

  if (index === -1) {
    return [...transcript, item];
  }

  return transcript.map((existing, existingIndex) => {
    if (existingIndex !== index) {
      return existing;
    }

    if (existing.kind !== "tool_trace") {
      return existing;
    }

    return {
      ...existing,
      ...item,
      inputSummary:
        item.inputSummary === "completed"
          ? existing.inputSummary
          : item.inputSummary
    };
  });
}

function findRunningToolTraceIndex(
  transcript: readonly TuiTranscriptItem[],
  item: TuiToolTraceItem
): number {
  if (item.toolUseId !== undefined) {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const candidate = transcript[index];
      if (
        candidate?.kind === "tool_trace" &&
        candidate.status === "running" &&
        candidate.toolUseId === item.toolUseId
      ) {
        return index;
      }
    }

    return -1;
  }

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const candidate = transcript[index];
    if (
      candidate?.kind === "tool_trace" &&
      candidate.status === "running" &&
      candidate.toolName === item.toolName
    ) {
      return index;
    }
  }

  return -1;
}

function appendPanelResult(
  transcript: readonly TuiTranscriptItem[],
  panel: NonNullable<TuiState["activePanel"]>,
  result: TuiPanelResult | undefined
): readonly TuiTranscriptItem[] {
  if (result === undefined) {
    return transcript;
  }

  return [
    ...transcript,
    {
      kind: "status",
      text: formatPanelResult(panel, result)
    }
  ];
}

function isPanelCloseResultForActivePanel(
  panel: TuiState["activePanel"],
  result: TuiPanelResult | undefined
): result is TuiPanelResult {
  return (
    panel !== null &&
    result !== undefined &&
    panel.kind === result.kind &&
    panel.requestId === result.requestId
  );
}

function clearPanelSelection(state: TuiState): TuiState {
  const { panelSelectionIndex: _panelSelectionIndex, ...stateWithoutSelection } =
    state;

  return stateWithoutSelection;
}

function formatPanelResult(
  panel: NonNullable<TuiState["activePanel"]>,
  result: TuiPanelResult
): string {
  if (result.kind === "question") {
    return `Answered question ${result.requestId}`;
  }

  const toolName =
    panel.kind === "permission" ? panel.toolName : result.requestId;

  switch (result.decision) {
    case "allowed_once":
      return `Permission allowed once for ${toolName}.`;
    case "allowed_always":
      return `Permission allowed always for ${toolName} in this project.`;
    case "denied":
      return `Permission denied for ${toolName}.`;
  }
}

function clearBusyState(state: TuiState): TuiState {
  const { busyLabel: _busyLabel, ...status } = state.status;
  return {
    ...state,
    busy: false,
    mode: "idle",
    commandPicker: null,
    status
  };
}

function createErrorItem(
  message: string,
  detail: string | undefined
): TuiTranscriptItem {
  return {
    kind: "error",
    message,
    ...(detail === undefined ? {} : { detail })
  };
}
