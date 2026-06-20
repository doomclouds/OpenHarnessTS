export type ColorMode = "full" | "basic" | "none";

export type TuiMode = "idle" | "busy" | "permission" | "command";

export interface TuiStatus {
  productName: "OpenHarness";
  screenTitle: string;
  modelLabel?: string;
  tokenLabel?: string;
  permissionMode?: string;
  cwdLabel?: string;
  busyLabel?: string;
}

export type TuiTranscriptItem =
  | {
      kind: "user";
      text: string;
    }
  | {
      kind: "assistant";
      text: string;
    }
  | {
      kind: "tool_trace";
      toolName: string;
      status: "running" | "completed" | "failed";
      inputSummary: string;
      toolUseId?: string;
      resultSummary?: string;
      errorSummary?: string;
      durationLabel?: string;
    }
  | {
      kind: "status";
      text: string;
    }
  | {
      kind: "error";
      message: string;
      detail?: string;
};

export type TuiToolTraceItem = Extract<
  TuiTranscriptItem,
  { kind: "tool_trace" }
>;

export type TuiPanel =
  | {
      kind: "permission";
      requestId: string;
      toolName: string;
      reason?: string;
      commandPreview?: string;
      workingDirectory?: string;
    }
  | {
      kind: "question";
      requestId: string;
      prompt: string;
    };

export type TuiPanelResult =
  | {
      kind: "permission";
      requestId: string;
      decision: "allowed_once" | "allowed_always" | "denied";
    }
  | {
      kind: "question";
      requestId: string;
      answer: string;
    };

export type PermissionDecision = Extract<
  TuiPanelResult,
  { kind: "permission" }
>["decision"];

export interface PermissionOption {
  label: string;
  decision: PermissionDecision;
  tone: "success" | "normal" | "danger";
}

export interface CommandDescriptor {
  name: string;
  description: string;
  enabled: boolean;
  category?: "session" | "runtime" | "help";
}

export interface CommandPickerState {
  query: string;
  selectedIndex: number;
}

export interface TuiSessionArtifacts {
  sessionId: string;
  latestPath?: string;
  transcriptPath?: string;
  markdownPath?: string;
}

export interface TuiState {
  ready: boolean;
  busy: boolean;
  mode: TuiMode;
  status: TuiStatus;
  transcript: readonly TuiTranscriptItem[];
  assistantBuffer: string;
  activePanel: TuiPanel | null;
  panelSelectionIndex?: number;
  commandPicker: CommandPickerState | null;
  commands: readonly CommandDescriptor[];
  inputValue: string;
  footerHints: readonly string[];
  colorMode: ColorMode;
  width: number;
  height: number;
  transcriptScrollOffset: number;
  sessionArtifacts?: TuiSessionArtifacts;
  exitRequested?: boolean;
  interruptRequested?: boolean;
}

export interface TuiReadyState {
  status?: Partial<TuiStatus>;
  commands?: readonly CommandDescriptor[];
  footerHints?: readonly string[];
  colorMode?: ColorMode;
  width?: number;
  height?: number;
  sessionArtifacts?: TuiSessionArtifacts;
}

export type TuiEvent =
  | {
      type: "ready";
      state?: TuiReadyState;
    }
  | {
      type: "transcript_item";
      item: TuiTranscriptItem;
    }
  | {
      type: "turn_started";
      busyLabel?: string;
    }
  | {
      type: "assistant_delta";
      text: string;
    }
  | {
      type: "assistant_complete";
      text?: string;
    }
  | {
      type: "tool_started";
      item: TuiToolTraceItem;
    }
  | {
      type: "tool_completed";
      item: TuiToolTraceItem;
    }
  | {
      type: "panel_opened";
      panel: TuiPanel;
    }
  | {
      type: "panel_closed";
      result?: TuiPanelResult;
    }
  | {
      type: "status_changed";
      status: Partial<Omit<TuiStatus, "productName">>;
    }
  | {
      type: "line_complete";
      artifacts?: TuiSessionArtifacts;
    }
  | {
      type: "error";
      message: string;
      detail?: string;
    };

export type TuiAction =
  | {
      type: "input_changed";
      value: string;
    }
  | {
      type: "submit_input";
    }
  | {
      type: "interrupt";
    }
  | {
      type: "open_command_picker";
    }
  | {
      type: "move_selection";
      direction: "up" | "down";
    }
  | {
      type: "scroll_transcript";
      direction: "up" | "down";
      amount: number;
    }
  | {
      type: "confirm_selection";
    }
  | {
      type: "move_panel_selection";
      direction: "previous" | "next";
    }
  | {
      type: "confirm_panel_selection";
    }
  | {
      type: "deny_panel";
    }
  | {
      type: "cancel_panel";
    }
  | {
      type: "exit";
    };

export interface CreateInitialTuiStateOptions {
  cwdLabel?: string;
  modelLabel?: string;
  permissionMode?: string;
  tokenLabel?: string;
  inputValue?: string;
  colorMode?: ColorMode;
  width?: number;
  height?: number;
}
