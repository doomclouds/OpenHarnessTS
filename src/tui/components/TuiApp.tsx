import { Box, Text, useInput } from "ink";
import { useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import { applyTuiAction, defaultPermissionOptions } from "../model/index.js";
import type { TuiAction, TuiState } from "../model/index.js";
import { CommandPicker } from "./CommandPicker.js";
import { ConversationView } from "./ConversationView.js";
import { FooterHints } from "./FooterHints.js";
import { PermissionPanel } from "./PermissionPanel.js";
import { PromptInput } from "./PromptInput.js";
import { TopStatusLine } from "./TopStatusLine.js";

export interface TuiAppProps {
  state: TuiState;
  onStateChange?: ((state: TuiState) => void) | undefined;
  onAction?: ((action: TuiAction, previousState: TuiState) => void) | undefined;
  onSubmitPrompt?: ((prompt: string, state: TuiState) => void) | undefined;
  onInterruptTurn?: ((state: TuiState) => void) | undefined;
}

export function TuiApp({
  state,
  onStateChange,
  onAction,
  onSubmitPrompt,
  onInterruptTurn
}: TuiAppProps): ReactElement {
  useTerminalMouseTracking();

  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  const dispatch = (action: TuiAction): void => {
    const previousState = latestStateRef.current;

    if (onAction !== undefined) {
      onAction(action, previousState);
      latestStateRef.current = applyTuiAction(previousState, action);
      return;
    }

    if (onStateChange === undefined) {
      return;
    }

    const nextState = applyTuiAction(previousState, action);
    latestStateRef.current = nextState;
    onStateChange(nextState);

    if (shouldNotifyPromptSubmit(action, previousState, nextState)) {
      onSubmitPrompt?.(previousState.inputValue.trim(), nextState);
    }

    if (action.type === "interrupt" && previousState.busy) {
      onInterruptTurn?.(nextState);
    }
  };

  useInput(
    (input, key) => {
      const currentState = latestStateRef.current;

      if (input === "\u0003" || (key.ctrl && input.toLowerCase() === "c")) {
        dispatch({ type: "interrupt" });
        return;
      }

      const mouseInput = getTerminalMouseInput(input);
      if (mouseInput !== undefined) {
        if (
          mouseInput.wheelDirection !== undefined &&
          currentState.mode !== "command" &&
          currentState.activePanel === null
        ) {
          dispatch({
            type: "scroll_transcript",
            direction: mouseInput.wheelDirection,
            amount: 1
          });
        }

        return;
      }

      if (currentState.activePanel?.kind === "permission") {
        if (key.escape) {
          dispatch({ type: "deny_panel" });
          return;
        }

        if (key.return) {
          dispatch({ type: "confirm_panel_selection" });
          return;
        }

        if (key.tab || key.rightArrow) {
          dispatch({ type: "move_panel_selection", direction: "next" });
          return;
        }

        if (key.leftArrow) {
          dispatch({ type: "move_panel_selection", direction: "previous" });
          return;
        }

        return;
      }

      if (key.escape) {
        dispatch(
          currentState.busy ? { type: "interrupt" } : { type: "cancel_panel" }
        );
        return;
      }

      if (key.return) {
        if (currentState.activePanel !== null) {
          return;
        }

        dispatch({ type: "submit_input" });
        return;
      }

      if (key.upArrow) {
        dispatch(
          currentState.mode === "command"
            ? { type: "move_selection", direction: "up" }
            : { type: "scroll_transcript", direction: "up", amount: 1 }
        );
        return;
      }

      if (key.downArrow) {
        dispatch(
          currentState.mode === "command"
            ? { type: "move_selection", direction: "down" }
            : { type: "scroll_transcript", direction: "down", amount: 1 }
        );
        return;
      }

      if (key.pageUp || input === "\u001B[5~") {
        dispatch({
          type: "scroll_transcript",
          direction: "up",
          amount: getShellLayout(currentState).maxVisibleItems
        });
        return;
      }

      if (key.pageDown || input === "\u001B[6~") {
        dispatch({
          type: "scroll_transcript",
          direction: "down",
          amount: getShellLayout(currentState).maxVisibleItems
        });
        return;
      }

      if (key.backspace || key.delete) {
        dispatch({
          type: "input_changed",
          value: currentState.inputValue.slice(0, -1)
        });
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        dispatch({
          type: "input_changed",
          value: currentState.inputValue + input
        });
      }
    },
    { isActive: onAction !== undefined || onStateChange !== undefined }
  );

  const layout = getShellLayout(state);

  return (
    <Box
      flexDirection="column"
      height={state.height}
      overflow="hidden"
      paddingX={1}
    >
      <TopStatusLine
        status={state.status}
        width={state.width}
        colorMode={state.colorMode}
      />
      <BodyViewport height={layout.bodyHeight}>
        <ConversationView
          items={state.transcript}
          assistantBuffer={state.assistantBuffer}
          showWelcome={state.ready}
          maxVisibleItems={layout.maxVisibleItems}
          scrollOffset={state.transcriptScrollOffset}
          colorMode={state.colorMode}
          width={state.width}
        />
        <InlinePanelHost state={state} />
      </BodyViewport>
      <CommandPickerReservation state={state} />
      <Box flexDirection="column" flexShrink={0}>
        <PromptInput
          value={state.inputValue}
          busy={state.busy}
          colorMode={state.colorMode}
          width={state.width}
          busyLabel={state.status.busyLabel}
          onChange={(value) => dispatch({ type: "input_changed", value })}
          onSubmit={() => dispatch({ type: "submit_input" })}
          onInterrupt={() => dispatch({ type: "interrupt" })}
        />
        <FooterHints
          mode={state.mode}
          hints={state.footerHints}
          width={state.width}
          colorMode={state.colorMode}
          hasActivePanel={state.activePanel !== null}
          busy={state.busy}
        />
      </Box>
    </Box>
  );
}

function BodyViewport({
  children,
  height
}: {
  children: ReactNode;
  height: number;
}): ReactElement {
  return (
    <Box
      flexDirection="column"
      flexShrink={1}
      height={height}
      justifyContent="flex-end"
      overflow="hidden"
    >
      {children}
    </Box>
  );
}

function getShellLayout(state: TuiState): {
  bodyHeight: number;
  maxVisibleItems: number;
} {
  const headerRows = 1;
  const promptRows = 3;
  const footerRows = 1;
  const commandRows =
    state.mode === "command" &&
    state.commandPicker !== null &&
    state.activePanel === null
      ? Math.min(8, state.commands.length + 4)
      : 0;
  const reservedRows = headerRows + commandRows + promptRows + footerRows;
  const bodyHeight = Math.max(3, state.height - reservedRows);

  return {
    bodyHeight,
    maxVisibleItems: Math.max(3, bodyHeight)
  };
}

function useTerminalMouseTracking(): void {
  useEffect(() => {
    if (!isWritableTty(process.stdout)) {
      return;
    }

    process.stdout.write("\u001B[?1000h\u001B[?1006h");

    return () => {
      process.stdout.write("\u001B[?1006l\u001B[?1000l");
    };
  }, []);
}

function isWritableTty(
  stream: NodeJS.WriteStream | undefined
): stream is NodeJS.WriteStream {
  return stream !== undefined && stream.isTTY === true;
}

function getTerminalMouseInput(
  input: string
): { wheelDirection?: "up" | "down" | undefined } | undefined {
  const sgrButton = getSgrMouseButton(input);
  if (sgrButton !== undefined) {
    return { wheelDirection: getWheelDirectionFromButton(sgrButton) };
  }

  const x10Button = getX10MouseButton(input);
  if (x10Button !== undefined) {
    return { wheelDirection: getWheelDirectionFromButton(x10Button) };
  }

  return undefined;
}

function getSgrMouseButton(input: string): number | undefined {
  const match = /^(?:\u001B)?\[<(\d+);\d+;\d+[mM]$/u.exec(input);
  if (match?.[1] === undefined) {
    return undefined;
  }

  return Number.parseInt(match[1], 10);
}

function getX10MouseButton(input: string): number | undefined {
  const match = /^(?:\u001B)?\[M(.)(.)(.)$/su.exec(input);
  if (match?.[1] === undefined) {
    return undefined;
  }

  return match[1].codePointAt(0)! - 32;
}

function getWheelDirectionFromButton(
  button: number
): "up" | "down" | undefined {
  if ((button & 64) !== 64) {
    return undefined;
  }

  const wheelButton = button & 3;
  if (wheelButton === 0) {
    return "up";
  }

  if (wheelButton === 1) {
    return "down";
  }

  return undefined;
}

function shouldNotifyPromptSubmit(
  action: TuiAction,
  previousState: TuiState,
  nextState: TuiState
): boolean {
  if (
    action.type !== "submit_input" ||
    previousState.mode === "command" ||
    previousState.activePanel !== null ||
    previousState.busy
  ) {
    return false;
  }

  const prompt = previousState.inputValue.trim();
  return (
    prompt.length > 0 && !prompt.startsWith("/") && nextState !== previousState
  );
}

function InlinePanelHost({ state }: { state: TuiState }): ReactElement | null {
  const panel = state.activePanel;

  if (panel === null) {
    return null;
  }

  if (panel.kind === "question") {
    return (
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Text>* Question</Text>
        <Box marginLeft={2}>
          <Text>{panel.prompt}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <PermissionPanel
      title="OpenHarness wants to run a command"
      toolName={panel.toolName}
      commandPreview={panel.commandPreview}
      workingDirectory={panel.workingDirectory}
      reason={panel.reason}
      selectedIndex={state.panelSelectionIndex ?? 0}
      options={defaultPermissionOptions}
      width={state.width}
      colorMode={state.colorMode}
    />
  );
}

function CommandPickerReservation({
  state
}: {
  state: TuiState;
}): ReactElement | null {
  if (
    state.mode !== "command" ||
    state.commandPicker === null ||
    state.activePanel !== null
  ) {
    return null;
  }

  return (
    <CommandPicker
      query={state.commandPicker.query}
      commands={state.commands}
      selectedIndex={state.commandPicker.selectedIndex}
      width={state.width}
      colorMode={state.colorMode}
      showKeyboardHint={false}
    />
  );
}
