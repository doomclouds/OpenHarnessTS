import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ApiClient } from "../../api/index.js";
import type { ConversationMessage } from "../../messages/index.js";
import type { PermissionMode } from "../../permissions/index.js";
import type { SessionBackend } from "../../sessions/index.js";
import {
  applyTuiAction,
  applyTuiEvent,
  createInitialTuiState
} from "../model/index.js";
import type { ColorMode, TuiAction, TuiEvent, TuiState } from "../model/index.js";
import { runTuiRuntimeTurn } from "../runtime/index.js";
import { TuiApp } from "./TuiApp.js";

export interface TuiRuntimeAppProps {
  readonly apiClient: ApiClient;
  readonly model: string;
  readonly cwd?: string | URL;
  readonly sessionId?: string;
  readonly sessionBackend?: SessionBackend;
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly permissionMode?: PermissionMode;
  readonly colorMode?: ColorMode;
  readonly width?: number;
  readonly height?: number;
  readonly maxTurns?: number;
  readonly onExitRequested?: () => void;
}

export function TuiRuntimeApp(props: TuiRuntimeAppProps): ReactElement {
  const [state, setState] = useState<TuiState>(() =>
    applyTuiEvent(
      createInitialTuiState({
        modelLabel: props.model,
        permissionMode: props.permissionMode ?? "default",
        ...(props.cwd === undefined ? {} : { cwdLabel: String(props.cwd) }),
        ...(props.colorMode === undefined ? {} : { colorMode: props.colorMode }),
        ...(props.width === undefined ? {} : { width: props.width }),
        ...(props.height === undefined ? {} : { height: props.height })
      }),
      {
        type: "ready"
      }
    )
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const runningTurnRef = useRef<Promise<unknown> | null>(null);
  const sessionIdRef = useRef<string | undefined>(props.sessionId);
  const messagesRef = useRef<readonly ConversationMessage[]>([]);
  const exitNotifiedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const reduceState = (reducer: (current: TuiState) => TuiState): void => {
    if (!mountedRef.current) {
      return;
    }

    setState((current) => (mountedRef.current ? reducer(current) : current));
  };

  const dispatchEvent = (event: TuiEvent): void => {
    reduceState((current) => applyTuiEvent(current, event));
  };

  useEffect(() => {
    if (!state.exitRequested) {
      exitNotifiedRef.current = false;
      return;
    }

    if (exitNotifiedRef.current) {
      return;
    }

    exitNotifiedRef.current = true;
    props.onExitRequested?.();
  }, [props.onExitRequested, state.exitRequested]);

  const dispatchAction = (
    action: TuiAction,
    previousState: TuiState
  ): void => {
    const runtimeAction =
      action.type === "cancel_panel" && runningTurnRef.current !== null
        ? ({ type: "interrupt" } satisfies TuiAction)
        : action;

    reduceState((current) => applyTuiAction(current, runtimeAction));

    if (
      runtimeAction.type === "interrupt" &&
      (previousState.busy || runningTurnRef.current !== null)
    ) {
      abortControllerRef.current?.abort();
    }

    const submittedPrompt = getSubmittedPrompt(runtimeAction, previousState);
    if (submittedPrompt !== undefined) {
      startTurn(submittedPrompt);
    }
  };

  const startTurn = (prompt: string): void => {
    if (!mountedRef.current || runningTurnRef.current !== null) {
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const runningTurn = runTuiRuntimeTurn({
      prompt,
      apiClient: props.apiClient,
      model: props.model,
      ...(props.cwd === undefined ? {} : { cwd: props.cwd }),
      ...(sessionIdRef.current === undefined
        ? {}
        : { sessionId: sessionIdRef.current }),
      ...(messagesRef.current.length === 0
        ? {}
        : { initialMessages: messagesRef.current }),
      ...(props.sessionBackend === undefined
        ? {}
        : { sessionBackend: props.sessionBackend }),
      ...(props.homeDir === undefined ? {} : { homeDir: props.homeDir }),
      ...(props.env === undefined ? {} : { env: props.env }),
      ...(props.permissionMode === undefined
        ? {}
        : { permissionMode: props.permissionMode }),
      ...(props.maxTurns === undefined ? {} : { maxTurns: props.maxTurns }),
      signal: abortController.signal,
      onEvent: dispatchEvent
    })
      .then((result) => {
        sessionIdRef.current = result.sessionId;
        messagesRef.current = result.messages;
      })
      .catch(() => undefined)
      .finally(() => {
        if (runningTurnRef.current === runningTurn) {
          runningTurnRef.current = null;
          abortControllerRef.current = null;
        }
      });

    runningTurnRef.current = runningTurn;
  };

  return (
    <TuiApp
      state={state}
      onAction={dispatchAction}
    />
  );
}

function getSubmittedPrompt(
  action: TuiAction,
  previousState: TuiState
): string | undefined {
  if (
    action.type !== "submit_input" ||
    previousState.mode === "command" ||
    previousState.activePanel !== null ||
    previousState.busy
  ) {
    return undefined;
  }

  const prompt = previousState.inputValue.trim();
  if (prompt.length === 0 || prompt.startsWith("/")) {
    return undefined;
  }

  return applyTuiAction(previousState, action) === previousState
    ? undefined
    : prompt;
}
