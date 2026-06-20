import { describe, expect, it } from "vitest";
import {
  applyTuiEvent,
  createIdleWelcomeFixture,
  createInitialTuiState,
  type TuiEvent,
  type TuiReadyState,
  type TuiState
} from "../src/tui/model/index.js";

describe("TUI state model", () => {
  it("creates idle OpenHarness shell state with default commands and footer hints", () => {
    const state = createInitialTuiState();

    expect(state).toMatchObject({
      ready: false,
      busy: false,
      mode: "idle",
      assistantBuffer: "",
      inputValue: "",
      colorMode: "full",
      width: 120,
      height: 30,
      status: {
        productName: "OpenHarness",
        screenTitle: "Interactive Session"
      }
    });
    expect(state.commands.map((command) => command.name)).toEqual([
      "/help",
      "/status",
      "/clear",
      "/exit"
    ]);
    expect(state.commands).toEqual([
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
    ]);
    expect(state.footerHints).toContain("/ for commands");
    expect(state.transcript).toEqual([]);
    expect(state.activePanel).toBeNull();
    expect(state.commandPicker).toBeNull();
  });

  it("creates fresh default command and footer references for each initial state", () => {
    const first = createInitialTuiState();
    const second = createInitialTuiState();
    const firstFixture = createIdleWelcomeFixture();
    const secondFixture = createIdleWelcomeFixture();

    expect(first.commands).not.toBe(second.commands);
    expect(first.commands[0]).not.toBe(second.commands[0]);
    expect(first.footerHints).not.toBe(second.footerHints);
    expect(firstFixture.commands).not.toBe(secondFixture.commands);
    expect(firstFixture.commands[0]).not.toBe(secondFixture.commands[0]);
    expect(firstFixture.footerHints).not.toBe(secondFixture.footerHints);
  });

  it("merges allowed ready display state while preserving UI-local state", () => {
    const state: TuiState = {
      ...createInitialTuiState({
        inputValue: "draft prompt",
        modelLabel: "old-model"
      }),
      busy: true,
      mode: "command",
      transcript: [
        {
          kind: "user",
          text: "existing prompt"
        }
      ],
      assistantBuffer: "partial assistant text",
      activePanel: {
        kind: "question",
        requestId: "local-question",
        prompt: "Local question"
      },
      commandPicker: {
        query: "/st",
        selectedIndex: 1
      }
    };

    const readyState = {
      status: {
        modelLabel: "deepseek-chat",
        tokenLabel: "42 tokens"
      },
      commands: [
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
        }
      ],
      footerHints: ["/ for commands", "Ctrl+C to exit"],
      colorMode: "basic",
      width: 100,
      height: 24,
      sessionArtifacts: {
        sessionId: "session_ready",
        latestPath: "C:\\work\\.openharness\\latest.json"
      }
    } satisfies TuiReadyState;

    const updated = applyTuiEvent(state, {
      type: "ready",
      state: readyState
    });

    expect(updated.ready).toBe(true);
    expect(updated.busy).toBe(true);
    expect(updated.mode).toBe("command");
    expect(updated.status).toMatchObject({
      productName: "OpenHarness",
      screenTitle: "Interactive Session",
      modelLabel: "deepseek-chat",
      tokenLabel: "42 tokens"
    });
    expect(updated.inputValue).toBe("draft prompt");
    expect(updated.transcript).toEqual([
      {
        kind: "user",
        text: "existing prompt"
      }
    ]);
    expect(updated.assistantBuffer).toBe("partial assistant text");
    expect(updated.activePanel).toEqual({
      kind: "question",
      requestId: "local-question",
      prompt: "Local question"
    });
    expect(updated.commandPicker).toEqual({
      query: "/st",
      selectedIndex: 1
    });
    expect(updated.commands).toEqual(readyState.commands);
    expect(updated.footerHints).toEqual(readyState.footerHints);
    expect(updated.colorMode).toBe("basic");
    expect(updated.width).toBe(100);
    expect(updated.height).toBe(24);
    expect(updated.sessionArtifacts).toEqual({
      sessionId: "session_ready",
      latestPath: "C:\\work\\.openharness\\latest.json"
    });
  });

  it("builds assistant transcript items from streaming deltas and completion", () => {
    const streaming = [
      { type: "assistant_delta", text: "Hello" },
      { type: "assistant_delta", text: " from OpenHarness" }
    ].reduce<TuiState>(
      (state, event) => applyTuiEvent(state, event as TuiEvent),
      createInitialTuiState()
    );

    expect(streaming.assistantBuffer).toBe("Hello from OpenHarness");
    expect(streaming.transcript).toEqual([]);

    const completed = applyTuiEvent(streaming, {
      type: "assistant_complete"
    });

    expect(completed.assistantBuffer).toBe("");
    expect(completed.transcript).toEqual([
      {
        kind: "assistant",
        text: "Hello from OpenHarness"
      }
    ]);
  });

  it("marks a runtime turn as busy when it starts", () => {
    const state = createInitialTuiState();

    const started = applyTuiEvent(state, {
      type: "turn_started",
      busyLabel: "Thinking..."
    });

    expect(started.busy).toBe(true);
    expect(started.mode).toBe("busy");
    expect(started.commandPicker).toBeNull();
    expect(started.activePanel).toBeNull();
    expect(started.status.busyLabel).toBe("Thinking...");
  });

  it("opens and closes permission panels with transcript status results", () => {
    const opened = applyTuiEvent(createInitialTuiState(), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-1",
        toolName: "exec",
        reason: "Run project tests",
        commandPreview: "npm test"
      }
    });

    expect(opened.mode).toBe("permission");
    expect(opened.activePanel).toMatchObject({
      kind: "permission",
      requestId: "permission-1",
      toolName: "exec",
      reason: "Run project tests"
    });
    expect(opened.commandPicker).toBeNull();

    const closed = applyTuiEvent(opened, {
      type: "panel_closed",
      result: {
        kind: "permission",
        requestId: "permission-1",
        decision: "denied"
      }
    });

    expect(closed.activePanel).toBeNull();
    expect(closed.mode).toBe("idle");
    expect(closed.transcript).toContainEqual({
      kind: "status",
      text: "Permission denied for exec."
    });
  });

  it("restores busy mode when closing a permission panel during busy work", () => {
    const state: TuiState = {
      ...createInitialTuiState(),
      busy: true,
      mode: "permission",
      activePanel: {
        kind: "permission",
        requestId: "permission-busy",
        toolName: "exec",
        reason: "Continue running command"
      }
    };

    const closed = applyTuiEvent(state, {
      type: "panel_closed",
      result: {
        kind: "permission",
        requestId: "permission-busy",
        decision: "allowed_once"
      }
    });

    expect(closed.activePanel).toBeNull();
    expect(closed.busy).toBe(true);
    expect(closed.mode).toBe("busy");
    expect(closed.transcript).toContainEqual({
      kind: "status",
      text: "Permission allowed once for exec."
    });
  });

  it("renders permission close feedback with the active panel tool name", () => {
    const withPanel = applyTuiEvent(createIdleWelcomeFixture(), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-1",
        toolName: "Bash"
      }
    });

    const closed = applyTuiEvent(withPanel, {
      type: "panel_closed",
      result: {
        kind: "permission",
        requestId: "permission-1",
        decision: "allowed_always"
      }
    });

    expect(closed.activePanel).toBeNull();
    expect(closed.panelSelectionIndex).toBeUndefined();
    expect(closed.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Permission allowed always for Bash in this project."
    });
  });

  it("closes a non-busy permission panel cancellation without transcript status", () => {
    const state: TuiState = {
      ...createInitialTuiState(),
      mode: "permission",
      activePanel: {
        kind: "permission",
        requestId: "permission-cancel",
        toolName: "exec",
        reason: "Run command"
      }
    };

    const closed = applyTuiEvent(state, {
      type: "panel_closed"
    });

    expect(closed.activePanel).toBeNull();
    expect(closed.busy).toBe(false);
    expect(closed.mode).toBe("idle");
    expect(closed.transcript).toEqual([]);
  });

  it("clears permission panel selection when closing without a result", () => {
    const opened = applyTuiEvent(createInitialTuiState(), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-cancel-selection",
        toolName: "exec",
        reason: "Run command"
      }
    });
    const selected: TuiState = {
      ...opened,
      panelSelectionIndex: 2
    };

    const closed = applyTuiEvent(selected, {
      type: "panel_closed"
    });

    expect(closed.activePanel).toBeNull();
    expect(closed.panelSelectionIndex).toBeUndefined();
    expect(closed.mode).toBe("idle");
  });

  it("clears permission panel selection when closing with a matching result", () => {
    const opened = applyTuiEvent(createInitialTuiState(), {
      type: "panel_opened",
      panel: {
        kind: "permission",
        requestId: "permission-result-selection",
        toolName: "exec",
        reason: "Run command"
      }
    });
    const selected: TuiState = {
      ...opened,
      panelSelectionIndex: 1
    };

    const closed = applyTuiEvent(selected, {
      type: "panel_closed",
      result: {
        kind: "permission",
        requestId: "permission-result-selection",
        decision: "allowed_once"
      }
    });

    expect(closed.activePanel).toBeNull();
    expect(closed.panelSelectionIndex).toBeUndefined();
    expect(closed.mode).toBe("idle");
  });

  it("clears permission panel selection when opening a question panel", () => {
    const selectedPermissionPanel = {
      ...applyTuiEvent(createInitialTuiState(), {
        type: "panel_opened",
        panel: {
          kind: "permission",
          requestId: "permission-question-transition",
          toolName: "Bash"
        }
      }),
      panelSelectionIndex: 2
    };

    const withQuestionPanel = applyTuiEvent(selectedPermissionPanel, {
      type: "panel_opened",
      panel: {
        kind: "question",
        requestId: "question-after-permission",
        prompt: "Choose output mode"
      }
    });

    expect(withQuestionPanel.activePanel?.kind).toBe("question");
    expect(withQuestionPanel.panelSelectionIndex).toBeUndefined();
  });

  it("closes a busy permission panel cancellation back to busy mode without transcript status", () => {
    const state: TuiState = {
      ...createInitialTuiState(),
      busy: true,
      mode: "permission",
      activePanel: {
        kind: "permission",
        requestId: "permission-busy-cancel",
        toolName: "exec",
        reason: "Run command"
      }
    };

    const closed = applyTuiEvent(state, {
      type: "panel_closed"
    });

    expect(closed.activePanel).toBeNull();
    expect(closed.busy).toBe(true);
    expect(closed.mode).toBe("busy");
    expect(closed.transcript).toEqual([]);
  });

  it("ignores panel close events without an active matching panel", () => {
    const state = createInitialTuiState();

    const closed = applyTuiEvent(state, {
      type: "panel_closed",
      result: {
        kind: "permission",
        requestId: "permission-2",
        decision: "allowed_once"
      }
    });

    expect(closed).toBe(state);
  });

  it("ignores panel close events when the active panel does not match the result", () => {
    const state: TuiState = {
      ...createInitialTuiState(),
      mode: "permission",
      activePanel: {
        kind: "permission",
        requestId: "permission-active",
        toolName: "exec"
      }
    };

    const closed = applyTuiEvent(state, {
      type: "panel_closed",
      result: {
        kind: "permission",
        requestId: "permission-other",
        decision: "allowed_once"
      }
    });

    expect(closed).toBe(state);
  });

  it("records question panel answers as status transcript items", () => {
    const opened = applyTuiEvent(createInitialTuiState(), {
      type: "panel_opened",
      panel: {
        kind: "question",
        requestId: "question-1",
        prompt: "Choose output mode"
      }
    });

    expect(opened.mode).toBe("idle");

    const closed = applyTuiEvent(opened, {
      type: "panel_closed",
      result: {
        kind: "question",
        requestId: "question-1",
        answer: "json"
      }
    });

    expect(closed.transcript).toContainEqual({
      kind: "status",
      text: "Answered question question-1"
    });
  });

  it("clears busy mode, stores session artifacts, and appends session saved status on line completion", () => {
    const busy = applyTuiEvent(createInitialTuiState(), {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "Searching files",
        status: "running"
      }
    });

    expect(busy.mode).toBe("busy");
    expect(busy.busy).toBe(true);
    expect(busy.status.busyLabel).toBe("Running grep...");

    const completed = applyTuiEvent(busy, {
      type: "line_complete",
      artifacts: {
        sessionId: "session_123",
        latestPath: "C:\\work\\.openharness\\latest.json",
        transcriptPath: "C:\\work\\.openharness\\transcript-session_123.md"
      }
    });

    expect(completed.busy).toBe(false);
    expect(completed.mode).toBe("idle");
    expect(completed.status.busyLabel).toBeUndefined();
    expect(completed.sessionArtifacts).toEqual({
      sessionId: "session_123",
      latestPath: "C:\\work\\.openharness\\latest.json",
      transcriptPath: "C:\\work\\.openharness\\transcript-session_123.md"
    });
    expect(completed.transcript).toContainEqual({
      kind: "status",
      text: "Session saved: session_123"
    });
  });

  it("updates tool trace items from tool completion events", () => {
    const started = applyTuiEvent(createInitialTuiState(), {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "Searching files",
        status: "running",
        toolUseId: "toolu_grep_legacy"
      }
    });

    const completed = applyTuiEvent(started, {
      type: "tool_completed",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "Searching files",
        status: "completed",
        toolUseId: "toolu_grep_legacy",
        resultSummary: "3 matches",
        durationLabel: "0.2s"
      }
    });

    expect(completed.busy).toBe(true);
    expect(completed.mode).toBe("busy");
    expect(completed.status.busyLabel).toBe("Processing...");
    expect(completed.transcript).toEqual([
      {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "Searching files",
        status: "completed",
        toolUseId: "toolu_grep_legacy",
        resultSummary: "3 matches",
        durationLabel: "0.2s"
      }
    ]);
  });

  it("creates running tool traces when tools start", () => {
    const state = applyTuiEvent(createInitialTuiState(), {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: src/index.ts",
        status: "running",
        toolUseId: "toolu_read_1"
      }
    });

    expect(state.busy).toBe(true);
    expect(state.mode).toBe("busy");
    expect(state.status.busyLabel).toBe("Running read_file...");
    expect(state.transcript).toEqual([
      {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: src/index.ts",
        status: "running",
        toolUseId: "toolu_read_1"
      }
    ]);
  });

  it("clears stale command picker state when tools start", () => {
    const commandState: TuiState = {
      ...createInitialTuiState({
        inputValue: "/status"
      }),
      mode: "command",
      commandPicker: {
        query: "status",
        selectedIndex: 0
      }
    };

    const busy = applyTuiEvent(commandState, {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: src/index.ts",
        status: "running"
      }
    });

    expect(busy.busy).toBe(true);
    expect(busy.mode).toBe("busy");
    expect(busy.commandPicker).toBeNull();
  });

  it("clears stale command picker state when busy work completes or errors", () => {
    const busyWithPicker: TuiState = {
      ...createInitialTuiState({
        inputValue: "/status"
      }),
      busy: true,
      mode: "busy",
      status: {
        ...createInitialTuiState().status,
        busyLabel: "Running grep..."
      },
      commandPicker: {
        query: "status",
        selectedIndex: 0
      }
    };

    const completed = applyTuiEvent(busyWithPicker, {
      type: "line_complete"
    });
    const errored = applyTuiEvent(busyWithPicker, {
      type: "error",
      message: "Provider failed"
    });

    expect(completed.busy).toBe(false);
    expect(completed.mode).toBe("idle");
    expect(completed.commandPicker).toBeNull();
    expect(errored.busy).toBe(false);
    expect(errored.mode).toBe("idle");
    expect(errored.commandPicker).toBeNull();
  });

  it("updates running tool traces by toolUseId without replacing the original input summary", () => {
    const running = applyTuiEvent(createInitialTuiState(), {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: OpenHarness",
        status: "running",
        toolUseId: "toolu_grep_1"
      }
    });

    const completed = applyTuiEvent(running, {
      type: "tool_completed",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "completed",
        status: "completed",
        toolUseId: "toolu_grep_1",
        resultSummary: "3 matches",
        durationLabel: "0.4s"
      }
    });

    expect(completed.transcript).toEqual([
      {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: OpenHarness",
        status: "completed",
        toolUseId: "toolu_grep_1",
        resultSummary: "3 matches",
        durationLabel: "0.4s"
      }
    ]);
    expect(completed.status.busyLabel).toBe("Processing...");
  });

  it("updates older same-name running traces by toolUseId instead of the most recent trace", () => {
    const withFirst = applyTuiEvent(createInitialTuiState(), {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: first",
        status: "running",
        toolUseId: "toolu_grep_first"
      }
    });
    const withSecond = applyTuiEvent(withFirst, {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: second",
        status: "running",
        toolUseId: "toolu_grep_second"
      }
    });

    const completed = applyTuiEvent(withSecond, {
      type: "tool_completed",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: first",
        status: "completed",
        toolUseId: "toolu_grep_first",
        resultSummary: "1 match"
      }
    });

    expect(completed.transcript).toEqual([
      {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: first",
        status: "completed",
        toolUseId: "toolu_grep_first",
        resultSummary: "1 match"
      },
      {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: second",
        status: "running",
        toolUseId: "toolu_grep_second"
      }
    ]);
  });

  it("does not fall back to same-name running traces when completion has an unmatched toolUseId", () => {
    const running = applyTuiEvent(createInitialTuiState(), {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: live",
        status: "running",
        toolUseId: "toolu_grep_live"
      }
    });

    const completed = applyTuiEvent(running, {
      type: "tool_completed",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: stale",
        status: "failed",
        toolUseId: "toolu_grep_stale",
        errorSummary: "tool result arrived late"
      }
    });

    expect(completed.transcript).toEqual([
      {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: live",
        status: "running",
        toolUseId: "toolu_grep_live"
      },
      {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "pattern: stale",
        status: "failed",
        toolUseId: "toolu_grep_stale",
        errorSummary: "tool result arrived late"
      }
    ]);
  });

  it("falls back to the most recent same-name running trace without toolUseId", () => {
    const withFirst = applyTuiEvent(createInitialTuiState(), {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: first.ts",
        status: "running"
      }
    });
    const withSecond = applyTuiEvent(withFirst, {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: second.ts",
        status: "running"
      }
    });

    const completed = applyTuiEvent(withSecond, {
      type: "tool_completed",
      item: {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: second.ts",
        status: "completed",
        resultSummary: "12 lines"
      }
    });

    expect(completed.transcript).toEqual([
      {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: first.ts",
        status: "running"
      },
      {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: second.ts",
        status: "completed",
        resultSummary: "12 lines"
      }
    ]);
  });

  it("appends orphan completed tool traces when no running trace matches", () => {
    const completed = applyTuiEvent(createInitialTuiState(), {
      type: "tool_completed",
      item: {
        kind: "tool_trace",
        toolName: "exec",
        inputSummary: "npm test",
        status: "failed",
        errorSummary: "permission denied"
      }
    });

    expect(completed.transcript).toEqual([
      {
        kind: "tool_trace",
        toolName: "exec",
        inputSummary: "npm test",
        status: "failed",
        errorSummary: "permission denied"
      }
    ]);
  });

  it("ignores out-of-order tool completion busy labels while preserving the result", () => {
    const completed = applyTuiEvent(createInitialTuiState(), {
      type: "tool_completed",
      item: {
        kind: "tool_trace",
        toolName: "grep",
        inputSummary: "Searching files",
        status: "completed",
        resultSummary: "3 matches",
        durationLabel: "0.2s"
      }
    });

    expect(completed.busy).toBe(false);
    expect(completed.mode).toBe("idle");
    expect(completed.status.busyLabel).toBeUndefined();
    expect(completed.transcript).toContainEqual({
      kind: "tool_trace",
      toolName: "grep",
      inputSummary: "Searching files",
      status: "completed",
      resultSummary: "3 matches",
      durationLabel: "0.2s"
    });
  });

  it("appends error items and clears busy mode", () => {
    const busy = applyTuiEvent(createInitialTuiState(), {
      type: "tool_started",
      item: {
        kind: "tool_trace",
        toolName: "read",
        inputSummary: "Reading file",
        status: "running"
      }
    });

    const errored = applyTuiEvent(busy, {
      type: "error",
      message: "Provider failed",
      detail: "HTTP 500"
    });

    expect(errored.busy).toBe(false);
    expect(errored.mode).toBe("idle");
    expect(errored.status.busyLabel).toBeUndefined();
    expect(errored.transcript.at(-1)).toEqual({
      kind: "error",
      message: "Provider failed",
      detail: "HTTP 500"
    });
  });
});
