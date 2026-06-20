import { describe, expect, it } from "vitest";
import {
  applyTuiAction,
  applyTuiEvent,
  createInitialTuiState,
  getVisibleCommands,
  moveCommandSelection,
  type TuiState
} from "../src/tui/model/index.js";

function readyState(options: { inputValue?: string; width?: number } = {}): TuiState {
  return applyTuiEvent(
    createInitialTuiState({
      ...(options.inputValue === undefined
        ? {}
        : { inputValue: options.inputValue }),
      width: options.width ?? 120,
      cwdLabel: "OpenHarnessTS",
      modelLabel: "deepseek-chat",
      permissionMode: "default",
      tokenLabel: "0 tokens"
    }),
    { type: "ready" }
  );
}

describe("TUI local actions", () => {
  it("updates prompt input and opens command picker for slash input", () => {
    const updated = applyTuiAction(readyState(), {
      type: "input_changed",
      value: "/st"
    });

    expect(updated.inputValue).toBe("/st");
    expect(updated.mode).toBe("command");
    expect(updated.commandPicker).toEqual({
      query: "st",
      selectedIndex: 0
    });
    expect(getVisibleCommands(updated).map((command) => command.name)).toEqual([
      "/status"
    ]);
  });

  it("closes command picker when input no longer starts with slash", () => {
    const commandState = applyTuiAction(readyState(), {
      type: "input_changed",
      value: "/help"
    });

    const updated = applyTuiAction(commandState, {
      type: "input_changed",
      value: "hello"
    });

    expect(updated.inputValue).toBe("hello");
    expect(updated.mode).toBe("idle");
    expect(updated.commandPicker).toBeNull();
  });

  it("does not open command picker for non-slash input", () => {
    const state = readyState({ inputValue: "hello" });

    const updated = applyTuiAction(state, {
      type: "open_command_picker"
    });

    expect(updated).toBe(state);
  });

  it("submits non-empty normal input as a user transcript item", () => {
    const state = readyState({ inputValue: "Explain this project" });

    const submitted = applyTuiAction(state, {
      type: "submit_input"
    });

    expect(submitted.inputValue).toBe("");
    expect(submitted.commandPicker).toBeNull();
    expect(submitted.mode).toBe("idle");
    expect(submitted.transcript).toEqual([
      {
        kind: "user",
        text: "Explain this project"
      }
    ]);
  });

  it("does not submit empty input", () => {
    const state = readyState({ inputValue: "   " });

    const submitted = applyTuiAction(state, {
      type: "submit_input"
    });

    expect(submitted).toBe(state);
  });

  it("does not submit prompt input while an active panel exists", () => {
    const withPanel = applyTuiEvent(readyState({ inputValue: "hello" }), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-1",
        toolName: "exec"
      }
    });

    const submitted = applyTuiAction(withPanel, {
      type: "submit_input"
    });

    expect(submitted).toBe(withPanel);
    expect(submitted.inputValue).toBe("hello");
    expect(submitted.mode).toBe("permission");
    expect(submitted.transcript).toEqual([]);
  });

  it("opens permission panels with Allow once selected by default", () => {
    const withPanel = applyTuiEvent(readyState(), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-1",
        toolName: "Bash",
        commandPreview: "npm run test",
        reason: "Validate runtime behavior after TUI protocol changes."
      }
    });

    expect(withPanel.mode).toBe("permission");
    expect(withPanel.panelSelectionIndex).toBe(0);
    expect(withPanel.commandPicker).toBeNull();
  });

  it("moves permission panel selection with clamped bounds", () => {
    const withPanel = applyTuiEvent(readyState(), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-1",
        toolName: "Bash"
      }
    });

    const allowAlways = applyTuiAction(withPanel, {
      type: "move_panel_selection",
      direction: "next"
    });
    const deny = applyTuiAction(allowAlways, {
      type: "move_panel_selection",
      direction: "next"
    });
    const clampedDeny = applyTuiAction(deny, {
      type: "move_panel_selection",
      direction: "next"
    });
    const backToAlways = applyTuiAction(deny, {
      type: "move_panel_selection",
      direction: "previous"
    });

    expect(allowAlways.panelSelectionIndex).toBe(1);
    expect(deny.panelSelectionIndex).toBe(2);
    expect(clampedDeny.panelSelectionIndex).toBe(2);
    expect(backToAlways.panelSelectionIndex).toBe(1);
  });

  it("confirms Allow once for an active permission panel", () => {
    const withPanel = applyTuiEvent(readyState(), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-1",
        toolName: "Bash"
      }
    });

    const confirmed = applyTuiAction(withPanel, {
      type: "confirm_panel_selection"
    });

    expect(confirmed.activePanel).toBeNull();
    expect(confirmed.panelSelectionIndex).toBeUndefined();
    expect(confirmed.mode).toBe("idle");
    expect(confirmed.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Permission allowed once for Bash."
    });
  });

  it("confirms Always allow in this project without persisting settings", () => {
    const withPanel = {
      ...applyTuiEvent(readyState(), {
        type: "panel_opened",
        panel: {
          kind: "permission",
          requestId: "permission-1",
          toolName: "Bash"
        }
      }),
      panelSelectionIndex: 1
    };

    const confirmed = applyTuiAction(withPanel, {
      type: "confirm_panel_selection"
    });

    expect(confirmed.activePanel).toBeNull();
    expect(confirmed.panelSelectionIndex).toBeUndefined();
    expect(confirmed.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Permission allowed always for Bash in this project."
    });
  });

  it("does not use Always allow as persistent settings state", () => {
    const withPanel = {
      ...applyTuiEvent(readyState(), {
        type: "panel_opened",
        panel: {
          kind: "permission",
          requestId: "permission-1",
          toolName: "Bash"
        }
      }),
      panelSelectionIndex: 1
    };

    const confirmed = applyTuiAction(withPanel, {
      type: "confirm_panel_selection"
    });

    expect("allowedTools" in confirmed).toBe(false);
    expect("permissionSettings" in confirmed).toBe(false);
    expect(confirmed.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Permission allowed always for Bash in this project."
    });
  });

  it("denies an active permission panel without interrupting the busy turn", () => {
    const withPanel = {
      ...applyTuiEvent(readyState(), {
        type: "panel_opened",
        panel: {
          kind: "permission",
          requestId: "permission-1",
          toolName: "Bash"
        }
      }),
      busy: true,
      status: {
        ...readyState().status,
        busyLabel: "Running Bash..."
      }
    };

    const denied = applyTuiAction(withPanel, {
      type: "deny_panel"
    });

    expect(denied.activePanel).toBeNull();
    expect(denied.panelSelectionIndex).toBeUndefined();
    expect(denied.mode).toBe("busy");
    expect(denied.interruptRequested).toBeUndefined();
    expect(denied.status.busyLabel).toBe("Running Bash...");
    expect(denied.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Permission denied for Bash."
    });
  });

  it("keeps Ctrl+C interrupt distinct from permission denial", () => {
    const withPanel = {
      ...applyTuiEvent(readyState(), {
        type: "panel_opened",
        panel: {
          kind: "permission",
          requestId: "permission-1",
          toolName: "Bash"
        }
      }),
      busy: true,
      status: {
        ...readyState().status,
        busyLabel: "Running Bash..."
      }
    };

    const interrupted = applyTuiAction(withPanel, {
      type: "interrupt"
    });

    expect(interrupted.interruptRequested).toBe(true);
    expect(interrupted.activePanel).toEqual(withPanel.activePanel);
    expect(interrupted.status.busyLabel).toBe("Stopping current operation...");
    expect(interrupted.transcript).toEqual(withPanel.transcript);
  });

  it("keeps slash query when Escape closes the command picker", () => {
    const commandState = applyTuiAction(readyState(), {
      type: "input_changed",
      value: "/sta"
    });

    const cancelled = applyTuiAction(commandState, {
      type: "cancel_panel"
    });

    expect(cancelled.inputValue).toBe("/sta");
    expect(cancelled.commandPicker).toBeNull();
    expect(cancelled.mode).toBe("idle");
  });

  it("moves command selection with clamped bounds", () => {
    const commandState = applyTuiAction(readyState(), {
      type: "input_changed",
      value: "/"
    });
    const lastVisibleIndex = getVisibleCommands(commandState).length - 1;
    const lastCommandState: TuiState = {
      ...commandState,
      commandPicker: {
        query: "",
        selectedIndex: lastVisibleIndex
      }
    };

    expect(moveCommandSelection(commandState, "down").commandPicker).toEqual({
      query: "",
      selectedIndex: 1
    });
    expect(moveCommandSelection(commandState, "up").commandPicker).toEqual({
      query: "",
      selectedIndex: 0
    });
    expect(moveCommandSelection(lastCommandState, "down").commandPicker).toEqual({
      query: "",
      selectedIndex: lastVisibleIndex
    });
  });

  it("does not move command selection outside command mode", () => {
    const state: TuiState = {
      ...readyState({ inputValue: "/" }),
      mode: "idle",
      commandPicker: {
        query: "",
        selectedIndex: 0
      }
    };

    expect(moveCommandSelection(state, "down")).toBe(state);
    expect(
      applyTuiAction(state, {
        type: "move_selection",
        direction: "down"
      })
    ).toBe(state);
  });

  it("executes help command locally", () => {
    const commandState = applyTuiAction(readyState(), {
      type: "input_changed",
      value: "/help"
    });

    const executed = applyTuiAction(commandState, {
      type: "confirm_selection"
    });

    expect(executed.inputValue).toBe("");
    expect(executed.commandPicker).toBeNull();
    expect(executed.mode).toBe("idle");
    expect(executed.transcript).toContainEqual({
      kind: "status",
      text: "Commands: /help show shortcuts, /status show display status, /clear clear transcript, /exit close session"
    });
  });

  it("executes status command from display state only", () => {
    const commandState = applyTuiAction(readyState(), {
      type: "input_changed",
      value: "/status"
    });

    const executed = applyTuiAction(commandState, {
      type: "confirm_selection"
    });

    expect(executed.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Status: idle - model deepseek-chat - cwd OpenHarnessTS - permission default"
    });
  });

  it("includes session artifacts in the local status command", () => {
    const commandState = applyTuiAction(
      {
        ...readyState(),
        sessionArtifacts: {
          sessionId: "sess_tui_001",
          latestPath: "C:\\work\\.openharness\\latest.json",
          transcriptPath: "C:\\work\\.openharness\\session-sess_tui_001.md"
        }
      },
      {
        type: "input_changed",
        value: "/status"
      }
    );

    const executed = applyTuiAction(commandState, {
      type: "confirm_selection"
    });

    expect(executed.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Status: idle - model deepseek-chat - cwd OpenHarnessTS - permission default - session sess_tui_001 - latest latest.json - transcript session-sess_tui_001.md"
    });
  });

  it("executes clear command locally", () => {
    const withTranscript: TuiState = {
      ...readyState(),
      transcript: [
        {
          kind: "user",
          text: "old prompt"
        }
      ],
      assistantBuffer: "partial response"
    };
    const commandState = applyTuiAction(withTranscript, {
      type: "input_changed",
      value: "/clear"
    });

    const executed = applyTuiAction(commandState, {
      type: "confirm_selection"
    });

    expect(executed.transcript).toEqual([]);
    expect(executed.assistantBuffer).toBe("");
    expect(executed.inputValue).toBe("");
    expect(executed.commandPicker).toBeNull();
  });

  it("executes exit command as intent without terminating process", () => {
    const commandState = applyTuiAction(readyState(), {
      type: "input_changed",
      value: "/exit"
    });

    const executed = applyTuiAction(commandState, {
      type: "confirm_selection"
    });

    expect(executed.exitRequested).toBe(true);
    expect(executed.inputValue).toBe("");
    expect(executed.commandPicker).toBeNull();
  });

  it("confirms the clamped visible command when selected index is out of range", () => {
    const commandState: TuiState = {
      ...applyTuiAction(readyState(), {
        type: "input_changed",
        value: "/"
      }),
      commandPicker: {
        query: "",
        selectedIndex: 99
      }
    };

    const executed = applyTuiAction(commandState, {
      type: "confirm_selection"
    });

    expect(executed.exitRequested).toBe(true);
    expect(executed.inputValue).toBe("");
    expect(executed.commandPicker).toBeNull();
  });

  it("does not confirm a command when filtering leaves no matches", () => {
    const commandState = applyTuiAction(readyState(), {
      type: "input_changed",
      value: "/missing"
    });

    const executed = applyTuiAction(commandState, {
      type: "confirm_selection"
    });

    expect(executed).toBe(commandState);
    expect(executed.exitRequested).toBeUndefined();
  });

  it("does not execute disabled commands hidden by filtering", () => {
    const commandState: TuiState = {
      ...readyState(),
      mode: "command",
      inputValue: "/exit",
      commands: [
        {
          name: "/exit",
          description: "Exit the interactive session",
          enabled: false,
          category: "runtime"
        }
      ],
      commandPicker: {
        query: "exit",
        selectedIndex: 0
      }
    };

    const executed = applyTuiAction(commandState, {
      type: "confirm_selection"
    });

    expect(executed).toBe(commandState);
    expect(executed.exitRequested).toBeUndefined();
  });

  it("does not confirm command selection outside command mode", () => {
    const state: TuiState = {
      ...readyState({ inputValue: "/exit" }),
      mode: "idle",
      commandPicker: {
        query: "exit",
        selectedIndex: 0
      }
    };

    const executed = applyTuiAction(state, {
      type: "confirm_selection"
    });

    expect(executed).toBe(state);
    expect(executed.exitRequested).toBeUndefined();
    expect(executed.inputValue).toBe("/exit");
  });

  it("does not edit input while busy and records interrupt intent", () => {
    const busy: TuiState = {
      ...readyState({ inputValue: "keep me" }),
      busy: true,
      mode: "busy",
      status: {
        ...readyState().status,
        busyLabel: "Running read_file..."
      }
    };

    const ignored = applyTuiAction(busy, {
      type: "input_changed",
      value: "ignored"
    });
    const interrupted = applyTuiAction(busy, {
      type: "interrupt"
    });

    expect(ignored.inputValue).toBe("keep me");
    expect(ignored.commandPicker).toBeNull();
    expect(interrupted.interruptRequested).toBe(true);
    expect(interrupted.status.busyLabel).toBe("Stopping current operation...");
  });

  it("does not open command picker while an active panel exists", () => {
    const withPanel = applyTuiEvent(readyState(), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-1",
        toolName: "exec"
      }
    });

    const updated = applyTuiAction(withPanel, {
      type: "input_changed",
      value: "/help"
    });

    expect(updated.inputValue).toBe("/help");
    expect(updated.commandPicker).toBeNull();
    expect(updated.mode).toBe("permission");
  });
});
