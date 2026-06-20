import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { useState } from "react";
import type { ReactElement } from "react";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createApiMessageCompleteEvent,
  createApiTextDeltaEvent,
  createAssistantMessage,
  createTextBlock,
  createToolUseBlock,
  getMessageText,
  type ApiClient,
  type ApiMessageRequest,
  type ApiStreamEvent,
  type ExportSessionTranscriptArgs,
  type ListSessionsOptions,
  type SaveSessionSnapshotArgs,
  type SessionBackend,
  type SessionSnapshot,
  type SessionSummary
} from "../src/index.js";
import type {
  ColorMode,
  CommandDescriptor,
  PermissionOption,
  TuiAction,
  TuiState
} from "../src/tui/model/index.js";
import {
  createAssistantTextFixture,
  createBusyFixture,
  createCommandPickerFixture,
  createChineseTranscriptFixture,
  createErrorFixture,
  createIdleWelcomeFixture,
  createNarrowIdleFixture,
  createPermissionPanelFixture,
  defaultPermissionOptions,
  createToolTraceFixture
} from "../src/tui/model/index.js";
import {
  CommandPicker,
  ConversationView,
  PermissionPanel,
  TuiApp,
  TuiRuntimeApp,
  type CommandPickerProps,
  type PermissionPanelProps,
  type PromptInputProps,
  type TuiAppProps
} from "../src/tui/index.js";

describe("TUI shell components", () => {
  it("renders the idle shell", () => {
    const { lastFrame } = render(<TuiApp state={createIdleWelcomeFixture()} />);

    const output = lastFrame() ?? "";

    expect(output).toContain("OpenHarness");
    expect(output).toContain("alpha tui - interactive session");
    expect(output).toContain("Welcome to OpenHarness");
    expect(output).toContain("> ");
    expect(output).toContain("/ for commands");
  });

  it("keeps the header, prompt, and footer fixed while clipping older body content", () => {
    const transcript = Array.from({ length: 18 }, (_, index) => ({
      kind: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index}`
    })) as TuiState["transcript"];
    const { lastFrame } = render(
      <TuiApp
        state={{
          ...createIdleWelcomeFixture(),
          height: 14,
          transcript
        }}
      />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("OpenHarness");
    expect(output).toContain("alpha tui - interactive session");
    expect(output).toContain("message 17");
    expect(output).not.toContain("message 0");
    expect(output).toContain("> ");
    expect(output).toContain("/ for commands");
  });

  it("keeps the tail of an oversized assistant response when a session status follows it", () => {
    const assistantText = Array.from(
      { length: 14 },
      (_, index) => `assistant line ${index}`
    ).join("\n");
    const { lastFrame } = render(
      <TuiApp
        state={{
          ...createIdleWelcomeFixture(),
          height: 14,
          transcript: [
            {
              kind: "user",
              text: "make a long answer"
            },
            {
              kind: "assistant",
              text: assistantText
            },
            {
              kind: "status",
              text: "Session saved: sess_fixed_height"
            }
          ]
        }}
      />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("assistant line 13");
    expect(output).toContain("Session saved: sess_fixed_height");
    expect(output).toContain("> ");
    expect(output).toContain("/ for commands");
  });

  it("scrolls transcript history with arrow keys and returns to the latest content", async () => {
    const transcript = Array.from({ length: 30 }, (_, index) => ({
      kind: "user",
      text: `scroll message ${index}`
    })) as TuiState["transcript"];
    const { stdin, lastFrame } = render(
      <ControlledTuiApp
        initialState={{
          ...createIdleWelcomeFixture(),
          height: 14,
          transcript
        }}
      />
    );

    expect(lastFrame()).toContain("scroll message 29");

    stdin.write("\u001B[A");

    await waitUntil(() => {
      expect(lastFrame()).toContain("scroll message 28");
      expect(lastFrame()).not.toContain("scroll message 29");
      expect(lastFrame()).toContain("> ");
      expect(lastFrame()).toContain("/ for commands");
    });

    stdin.write("\u001B[B");

    await waitUntil(() => {
      expect(lastFrame()).toContain("scroll message 29");
    });
  });

  it("scrolls transcript history with terminal mouse wheel events", async () => {
    const transcript = Array.from({ length: 30 }, (_, index) => ({
      kind: "user",
      text: `wheel message ${index}`
    })) as TuiState["transcript"];
    const { stdin, lastFrame } = render(
      <ControlledTuiApp
        initialState={{
          ...createIdleWelcomeFixture(),
          height: 14,
          transcript
        }}
      />
    );

    expect(lastFrame()).toContain("wheel message 29");

    stdin.write("\u001B[<64;8;6M");

    await waitUntil(() => {
      expect(lastFrame()).toContain("wheel message 28");
      expect(lastFrame()).not.toContain("wheel message 29");
    });

    stdin.write("\u001B[<65;8;6M");

    await waitUntil(() => {
      expect(lastFrame()).toContain("wheel message 29");
    });
  });

  it("does not write terminal mouse click events into the prompt", async () => {
    let currentState: TuiState | undefined;
    const { stdin, lastFrame } = render(
      <ControlledTuiApp
        initialState={createIdleWelcomeFixture()}
        onChange={(state) => {
          currentState = state;
        }}
      />
    );

    stdin.write("\u001B[<0;45;28M");
    stdin.write("\u001B[<2;45;28M");
    stdin.write("\u001B[<0;18;28m");

    await new Promise((resolve) => setTimeout(resolve, 20));

    const output = lastFrame() ?? "";
    expect(currentState?.inputValue ?? "").toBe("");
    expect(output).not.toContain("[<0;45;28M");
    expect(output).not.toContain("[<2;45;28M");
    expect(output).not.toContain("[<0;18;28m");
  });

  it("hides low-priority metadata in narrow layouts", () => {
    const { lastFrame } = render(<TuiApp state={createNarrowIdleFixture()} />);

    const output = lastFrame() ?? "";

    expect(output).not.toContain("deepseek-reasoner");
    expect(output).not.toContain("0 tokens");
  });

  it("renders busy shell status and interrupt hint", () => {
    const { lastFrame } = render(<TuiApp state={createBusyFixture()} />);

    const output = lastFrame() ?? "";

    expect(output).toContain("Running read_file...");
    expect(output).toContain("Esc to interrupt");
  });

  it("renders assistant paragraphs, lists, and fenced code blocks", () => {
    const { lastFrame } = render(
      <TuiApp state={createAssistantTextFixture()} />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("* OpenHarness");
    expect(output).toContain("Here is the fixture transcript:");
    expect(output).toContain("- Preserve paragraphs");
    expect(output).toContain("- Preserve lists");
    expect(output).toContain("```ts");
    expect(output).toContain("const status = \"ready\";");
    expect(output).toContain("```");
  });

  it("does not expose lightweight markdown emphasis markers in assistant output", () => {
    const { lastFrame } = render(
      <TuiApp
        state={{
          ...createIdleWelcomeFixture(),
          transcript: [
            {
              kind: "assistant",
              text: "This is **important** output."
            }
          ]
        }}
      />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("This is important output.");
    expect(output).not.toContain("**important**");
  });

  it("renders compact completed and failed tool traces", () => {
    const { lastFrame } = render(<TuiApp state={createToolTraceFixture()} />);

    const output = lastFrame() ?? "";

    expect(output).toContain("Grep(pattern: tool_trace)");
    expect(output).toContain("completed - 3 matches - 42ms");
    expect(output).toContain("Shell(command: npm test)");
    expect(output).toContain("failed - exit code 1 - 1.2s");
  });

  it("renders error blocks with details", () => {
    const { lastFrame } = render(<TuiApp state={createErrorFixture()} />);

    const output = lastFrame() ?? "";

    expect(output).toContain("* Error");
    expect(output).toContain("Runtime initialization failed");
    expect(output).toContain("Missing model");
  });

  it("renders Chinese and full-width transcript content", () => {
    const { lastFrame } = render(
      <TuiApp state={createChineseTranscriptFixture()} />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("> 请读取配置文件");
    expect(output).toContain("已完成：配置项校验通过。");
    expect(output).toContain("ReadFile(path: 配置/默认设置.json)");
    expect(output).toContain("completed - 读取 １２ 行");
  });

  it("renders permission panels inline", () => {
    const { lastFrame } = render(
      <TuiApp state={createPermissionPanelFixture()} />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("OpenHarness wants to run a command");
    expect(output).toContain("Bash");
    expect(output).toContain("permission request");
    expect(output).toContain("> Allow once");
    expect(output).not.toContain("popup");
    expect(output).not.toContain("overlay");
  });

  it("renders permission panel inline in the app shell", () => {
    const { lastFrame } = render(<TuiApp state={createPermissionPanelFixture()} />);

    const output = lastFrame() ?? "";

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).toContain("$ npm run test");
    expect(output).toContain("> Allow once");
    expect(output).toContain("> ");
    expect(output).not.toContain("popup");
    expect(output).not.toContain("overlay");
  });

  it("renders command picker suggestions next to the prompt", () => {
    const { lastFrame } = render(
      <TuiApp state={createCommandPickerFixture()} />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("/status");
    expect(output).toContain("Show current session status");
    expect(output).toContain("> /sta");
  });

  it("renders command picker as a named prompt-adjacent component", () => {
    const { lastFrame } = render(
      <CommandPicker
        query="st"
        commands={createCommandPickerFixture().commands}
        selectedIndex={0}
        width={120}
        colorMode="full"
      />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("Commands");
    expect(output).toContain("> /status");
    expect(output).toContain("Show current session status");
    expect(output).not.toContain("/help");
    expect(output).not.toContain("/clear");
    expect(output).not.toContain("/exit");
    expect(output).toContain("Up/Down");
  });

  it("hides command descriptions in narrow command picker", () => {
    const { lastFrame } = render(
      <CommandPicker
        query=""
        commands={createCommandPickerFixture().commands}
        selectedIndex={0}
        width={72}
        colorMode="none"
      />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("> /help");
    expect(output).not.toContain("Show available commands");
  });

  it("renders permission panel details and selected option", () => {
    const { lastFrame } = render(
      <PermissionPanel
        title="OpenHarness wants to run a command"
        toolName="Bash"
        commandPreview="npm run test"
        workingDirectory="C:\\WorkSpace\\ResearchProjects\\OpenHarnessTS"
        reason="Validate runtime behavior after TUI protocol changes."
        selectedIndex={0}
        options={defaultPermissionOptions}
        width={120}
        colorMode="full"
      />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).toContain("Bash");
    expect(output).toContain("$ npm run test");
    expect(output).toContain("Validate runtime behavior after TUI protocol changes.");
    expect(output).toContain("> Allow once");
    expect(output).toContain("Deny");
    expect(output).not.toContain("popup");
    expect(output).not.toContain("overlay");
  });

  it("renders permission panel selected state in no-color mode", () => {
    const { lastFrame } = render(
      <PermissionPanel
        title="OpenHarness wants to run a command"
        toolName="Bash"
        selectedIndex={2}
        options={defaultPermissionOptions}
        width={72}
        colorMode="none"
      />
    );

    const output = lastFrame() ?? "";

    expect(output).toContain("> Deny");
    expect(output).toContain("Allow once");
    expect(output).not.toContain("[accent]");
  });

  it("hides command picker while an inline panel is active", () => {
    const state = {
      ...createCommandPickerFixture(),
      activePanel: createPermissionPanelFixture().activePanel
    };
    const { lastFrame } = render(<TuiApp state={state} />);

    const output = lastFrame() ?? "";

    expect(output).toContain("OpenHarness wants to run a command");
    expect(output).not.toContain("Commands");
    expect(output).not.toContain("Show current session status");
  });

  it("keeps display props wired through app-level action callbacks", () => {
    expectTypeOf<TuiAppProps>().toEqualTypeOf<{
      state: TuiState;
      onStateChange?: ((state: TuiState) => void) | undefined;
      onAction?: ((action: TuiAction, previousState: TuiState) => void) | undefined;
      onSubmitPrompt?: ((prompt: string, state: TuiState) => void) | undefined;
      onInterruptTurn?: ((state: TuiState) => void) | undefined;
    }>();
    expectTypeOf<PromptInputProps>().toEqualTypeOf<{
      value: string;
      busy: boolean;
      colorMode: ColorMode;
      width?: number | undefined;
      placeholder?: string | undefined;
      busyLabel?: string | undefined;
      onChange?: ((value: string) => void) | undefined;
      onSubmit?: ((value: string) => void) | undefined;
      onInterrupt?: (() => void) | undefined;
    }>();
    expectTypeOf<CommandPickerProps>().toEqualTypeOf<{
      query: string;
      commands: readonly CommandDescriptor[];
      selectedIndex: number;
      width: number;
      colorMode: ColorMode;
      showKeyboardHint?: boolean | undefined;
      onSelect?: ((index: number) => void) | undefined;
      onConfirm?: ((commandName: string) => void) | undefined;
      onCancel?: (() => void) | undefined;
    }>();
    expectTypeOf<PermissionPanelProps>().toEqualTypeOf<{
      title: string;
      toolName: string;
      commandPreview?: string | undefined;
      workingDirectory?: string | undefined;
      reason?: string | undefined;
      selectedIndex: number;
      options: readonly PermissionOption[];
      width: number;
      colorMode: ColorMode;
      onSelect?: ((index: number) => void) | undefined;
      onConfirm?: (() => void) | undefined;
      onCancel?: (() => void) | undefined;
    }>();
  });

  it("routes printable input through onStateChange", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={createIdleWelcomeFixture()}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("x");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.inputValue).toBe("x");
  });

  it("delegates routed actions to onAction before using the display reducer fallback", () => {
    const actions: TuiAction[] = [];
    const previousStates: TuiState[] = [];
    const changes: TuiState[] = [];
    const state = createIdleWelcomeFixture();
    const { stdin } = render(
      <TuiApp
        state={state}
        onAction={(action, previousState) => {
          actions.push(action);
          previousStates.push(previousState);
        }}
        onStateChange={(nextState) => changes.push(nextState)}
      />
    );

    stdin.write("x");

    expect(actions).toEqual([{ type: "input_changed", value: "x" }]);
    expect(previousStates).toEqual([state]);
    expect(changes).toEqual([]);
  });

  it("routes Backspace to delete the final prompt character", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={{
          ...createIdleWelcomeFixture(),
          inputValue: "abc"
        }}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("\u007F");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.inputValue).toBe("ab");
  });

  it("routes Delete to delete the final prompt character", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={{
          ...createIdleWelcomeFixture(),
          inputValue: "abc"
        }}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("\u001B[3~");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.inputValue).toBe("ab");
  });

  it("preserves consecutive controlled input before parent rerender settles", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <ControlledTuiApp
        initialState={createIdleWelcomeFixture()}
        onChange={(state) => changes.push(state)}
      />
    );

    stdin.write("x");
    stdin.write("y");

    expect(changes.at(-1)?.inputValue).toBe("xy");
  });

  it("routes Enter through submit input", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={{
          ...createIdleWelcomeFixture(),
          inputValue: "hello"
        }}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("\r");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.inputValue).toBe("");
    expect(changes[0]?.transcript.at(-1)).toEqual({
      kind: "user",
      text: "hello"
    });
  });

  it("notifies the runtime layer when a normal prompt is submitted", () => {
    const submittedPrompts: string[] = [];
    const submittedStates: TuiState[] = [];
    const changes: TuiState[] = [];
    const { stdin } = render(
      <ControlledTuiApp
        initialState={createIdleWelcomeFixture()}
        onChange={(state) => changes.push(state)}
        appProps={{
          onSubmitPrompt(prompt, nextState) {
            submittedPrompts.push(prompt);
            submittedStates.push(nextState);
          }
        }}
      />
    );

    stdin.write("hello");
    stdin.write("\r");

    expect(submittedPrompts).toEqual(["hello"]);
    expect(submittedStates[0]).toBe(changes.at(-1));
    expect(changes.at(-1)?.transcript).toContainEqual({
      kind: "user",
      text: "hello"
    });
  });

  it("does not notify runtime when a local slash command is submitted", () => {
    const submittedPrompts: string[] = [];
    const { stdin } = render(
      <ControlledTuiApp
        initialState={createIdleWelcomeFixture()}
        appProps={{
          onSubmitPrompt(prompt) {
            submittedPrompts.push(prompt);
          }
        }}
      />
    );

    stdin.write("/status");
    stdin.write("\r");

    expect(submittedPrompts).toEqual([]);
  });

  it("keeps TuiApp usable without runtime callbacks", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={createIdleWelcomeFixture()}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("display only");
    stdin.write("\r");

    expect(changes.at(-1)?.transcript).toContainEqual({
      kind: "user",
      text: "display only"
    });
  });

  it("notifies the runtime layer when a busy turn is interrupted", () => {
    const interruptedStates: TuiState[] = [];
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={createBusyFixture()}
        onStateChange={(state) => changes.push(state)}
        onInterruptTurn={(state) => interruptedStates.push(state)}
      />
    );

    stdin.write("\u001B[27u");

    expect(interruptedStates).toEqual([changes[0]]);
    expect(interruptedStates[0]?.interruptRequested).toBe(true);
  });

  it("routes Enter to permission panel confirmation", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={createPermissionPanelFixture()}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("\r");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.activePanel).toBeNull();
    expect(changes[0]?.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Permission allowed once for Bash."
    });
  });

  it("routes Escape to permission denial even while busy", () => {
    const changes: TuiState[] = [];
    const state: TuiState = {
      ...createPermissionPanelFixture(),
      busy: true,
      status: {
        ...createPermissionPanelFixture().status,
        busyLabel: "Running Bash..."
      }
    };
    const { stdin } = render(
      <TuiApp state={state} onStateChange={(nextState) => changes.push(nextState)} />
    );

    stdin.write("\u001B[27u");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.activePanel).toBeNull();
    expect(changes[0]?.interruptRequested).toBeUndefined();
    expect(changes[0]?.transcript.at(-1)).toEqual({
      kind: "status",
      text: "Permission denied for Bash."
    });
  });

  it("routes Tab and Right through permission selection movement", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <ControlledTuiApp
        initialState={createPermissionPanelFixture()}
        onChange={(state) => changes.push(state)}
      />
    );

    stdin.write("\t");
    stdin.write("\u001B[C");

    expect(changes.at(-1)?.panelSelectionIndex).toBe(2);
  });

  it("routes Left through permission selection movement", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={{
          ...createPermissionPanelFixture(),
          panelSelectionIndex: 2
        }}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("\u001B[D");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.panelSelectionIndex).toBe(1);
  });

  it("routes Ctrl+C to interrupt while busy with a permission panel open", () => {
    const changes: TuiState[] = [];
    const state: TuiState = {
      ...createPermissionPanelFixture(),
      busy: true,
      status: {
        ...createPermissionPanelFixture().status,
        busyLabel: "Running Bash..."
      }
    };
    const { stdin } = render(
      <TuiApp state={state} onStateChange={(nextState) => changes.push(nextState)} />
    );

    stdin.write("\u0003");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.interruptRequested).toBe(true);
    expect(changes[0]?.activePanel).toEqual(state.activePanel);
    expect(changes[0]?.transcript).toEqual(state.transcript);
  });

  it("routes Escape to interrupt while busy", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={createBusyFixture()}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("\u001B[27u");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.interruptRequested).toBe(true);
    expect(changes[0]?.status.busyLabel).toBe("Stopping current operation...");
  });

  it("routes command picker arrows through selection movement", () => {
    const changes: TuiState[] = [];
    const { stdin } = render(
      <TuiApp
        state={{
          ...createCommandPickerFixture(),
          inputValue: "/",
          commandPicker: {
            query: "",
            selectedIndex: 0
          }
        }}
        onStateChange={(state) => changes.push(state)}
      />
    );

    stdin.write("\u001B[B");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.commandPicker).toEqual({
      query: "",
      selectedIndex: 1
    });
  });

  it("clamps command picker selection to the visible commands", () => {
    const state = {
      ...createCommandPickerFixture(),
      inputValue: "/",
      commandPicker: {
        query: "",
        selectedIndex: 99
      }
    };
    const { lastFrame } = render(<TuiApp state={state} />);

    const output = lastFrame() ?? "";

    expect(output).toContain("> /exit");
  });

  it("renders no transcript items when maxVisibleItems is zero", () => {
    const { lastFrame } = render(
      <ConversationView
        items={[
          {
            kind: "user",
            text: "first hidden prompt"
          },
          {
            kind: "assistant",
            text: "second hidden response"
          }
        ]}
        assistantBuffer=""
        showWelcome={false}
        maxVisibleItems={0}
        scrollOffset={0}
        colorMode="none"
      />
    );

    const output = lastFrame() ?? "";

    expect(output).not.toContain("first hidden prompt");
    expect(output).not.toContain("second hidden response");
  });

  it("exports a runtime container that renders the display shell", () => {
    const { lastFrame } = render(
      <TuiRuntimeApp
        apiClient={
          {
            async *streamMessage() {
              yield createApiMessageCompleteEvent({
                message: createAssistantMessage([createTextBlock("unused")])
              });
            }
          } satisfies ApiClient
        }
        model="fake-model"
        cwd="."
      />
    );

    expect(lastFrame()).toContain("OpenHarness");
    expect(lastFrame()).toContain("alpha tui - interactive session");
  });

  it("renders streamed runtime output and saved session feedback", async () => {
    const root = await mkdtemp(join(tmpdir(), "openharness-tui-runtime-app-"));
    const client = new ScriptedApiClient([
      [
        createApiTextDeltaEvent("Live "),
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("Live response.")])
        })
      ]
    ]);

    try {
      const { stdin, lastFrame } = render(
        <TuiRuntimeApp
          apiClient={client}
          model="fake-model"
          cwd={join(root, "project")}
          homeDir={join(root, "home")}
          env={{}}
          sessionId="sess_runtime_app"
        />
      );

      stdin.write("hello runtime");
      stdin.write("\r");

      await waitUntil(() => {
        expect(lastFrame()).toContain("Live response.");
        expect(lastFrame()).toContain("Session saved: sess_runtime_app");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps runtime conversation history and session id across prompts", async () => {
    const root = await mkdtemp(join(tmpdir(), "openharness-tui-runtime-session-"));
    const saveArgs: SaveSessionSnapshotArgs[] = [];
    const client = new ScriptedApiClient([
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("First answer.")])
        })
      ],
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("Second answer.")])
        })
      ]
    ]);

    try {
      const { stdin, lastFrame } = render(
        <TuiRuntimeApp
          apiClient={client}
          model="fake-model"
          cwd={join(root, "project")}
          homeDir={join(root, "home")}
          env={{}}
          sessionBackend={createRecordingSessionBackend(saveArgs)}
        />
      );

      stdin.write("first prompt");
      stdin.write("\r");

      await waitUntil(() => {
        expect(client.requests).toHaveLength(1);
        expect(lastFrame()).toContain("First answer.");
      });

      stdin.write("second prompt");
      stdin.write("\r");

      await waitUntil(() => {
        expect(client.requests).toHaveLength(2);
        expect(lastFrame()).toContain("Second answer.");
      });

      expect(saveArgs).toHaveLength(2);
      expect(saveArgs[0]?.sessionId).toBe(saveArgs[1]?.sessionId);
      expect(client.requests[1]?.messages.map(getMessageText)).toEqual([
        "first prompt",
        "First answer.",
        "second prompt"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("aborts the active runtime request through the provider signal on Escape", async () => {
    const root = await mkdtemp(join(tmpdir(), "openharness-tui-runtime-abort-"));
    const client = new AbortAwareApiClient();

    try {
      const { stdin, lastFrame } = render(
        <TuiRuntimeApp
          apiClient={client}
          model="fake-model"
          cwd={join(root, "project")}
          homeDir={join(root, "home")}
          env={{}}
          sessionId="sess_runtime_abort"
        />
      );

      stdin.write("cancel me");
      stdin.write("\r");
      const signal = await client.requestReceived;

      stdin.write("\u001B[27u");

      await waitUntil(() => {
        expect(signal?.aborted).toBe(true);
        const output = lastFrame() ?? "";
        expect(output).toContain("API error: provider aborted");
        expect(output).not.toContain("Permission denied");
        expect(output).not.toContain("Stopping current operation...");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("aborts the active runtime request when the runtime container unmounts", async () => {
    const root = await mkdtemp(join(tmpdir(), "openharness-tui-runtime-unmount-"));
    const client = new AbortAwareApiClient();

    try {
      const { stdin, unmount } = render(
        <TuiRuntimeApp
          apiClient={client}
          model="fake-model"
          cwd={join(root, "project")}
          homeDir={join(root, "home")}
          env={{}}
          sessionId="sess_runtime_unmount"
        />
      );

      stdin.write("unmount me");
      stdin.write("\r");
      const signal = await client.requestReceived;

      unmount();

      await waitUntil(() => {
        expect(signal?.aborted).toBe(true);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("notifies when the runtime shell requests exit from the slash command picker", async () => {
    const exitRequests: string[] = [];
    const { stdin } = render(
      <TuiRuntimeApp
        apiClient={new ScriptedApiClient([])}
        model="fake-model"
        cwd="."
        onExitRequested={() => exitRequests.push("exit")}
      />
    );

    stdin.write("/exit");
    stdin.write("\r");

    await waitUntil(() => {
      expect(exitRequests).toEqual(["exit"]);
    });
  });

  it("does not notify exit while the runtime shell is busy", async () => {
    const exitRequests: string[] = [];
    const client = new AbortAwareApiClient();
    const { stdin, lastFrame, unmount } = render(
      <TuiRuntimeApp
        apiClient={client}
        model="fake-model"
        cwd="."
        onExitRequested={() => exitRequests.push("exit")}
      />
    );

    try {
      stdin.write("keep running");
      stdin.write("\r");
      await client.requestReceived;

      await waitUntil(() => {
        expect(lastFrame()).toContain("Thinking...");
      });

      stdin.write("/exit");
      stdin.write("\r");

      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(exitRequests).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("forwards maxTurns into the runtime loop", async () => {
    const root = await mkdtemp(join(tmpdir(), "openharness-tui-runtime-max-turns-"));
    const client = new ScriptedApiClient([
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([
            createToolUseBlock({
              id: "toolu_read",
              name: "read_file",
              input: { path: "missing.txt" }
            })
          ])
        })
      ]
    ]);

    try {
      const { stdin, lastFrame } = render(
        <TuiRuntimeApp
          apiClient={client}
          model="fake-model"
          cwd={join(root, "project")}
          homeDir={join(root, "home")}
          env={{}}
          sessionId="sess_runtime_max_turns"
          maxTurns={1}
        />
      );

      stdin.write("read once");
      stdin.write("\r");

      await waitUntil(() => {
        expect(client.requests).toHaveLength(1);
        expect(lastFrame()).toContain("Max turns exceeded: 1");
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function ControlledTuiApp({
  initialState,
  onChange,
  appProps
}: {
  initialState: TuiState;
  onChange?: (state: TuiState) => void;
  appProps?: Omit<TuiAppProps, "state" | "onStateChange">;
}): ReactElement {
  const [state, setState] = useState(initialState);

  return (
    <TuiApp
      state={state}
      onStateChange={(nextState) => {
        setState(nextState);
        onChange?.(nextState);
      }}
      {...appProps}
    />
  );
}

class ScriptedApiClient implements ApiClient {
  public readonly requests: ApiMessageRequest[] = [];

  public constructor(
    private readonly turns: readonly (readonly ApiStreamEvent[])[]
  ) {}

  public async *streamMessage(
    request: ApiMessageRequest
  ): AsyncIterable<ApiStreamEvent> {
    this.requests.push({
      ...request,
      messages: [...request.messages],
      ...(request.tools === undefined ? {} : { tools: [...request.tools] })
    });

    const turn = this.turns[this.requests.length - 1];
    if (turn === undefined) {
      throw new Error(`No scripted turn ${this.requests.length}.`);
    }

    for (const event of turn) {
      yield event;
    }
  }
}

class AbortAwareApiClient implements ApiClient {
  public readonly requests: ApiMessageRequest[] = [];
  public readonly requestReceived: Promise<AbortSignal | undefined>;

  private resolveRequest: (signal: AbortSignal | undefined) => void = () => {};

  public constructor() {
    this.requestReceived = new Promise((resolve) => {
      this.resolveRequest = resolve;
    });
  }

  public async *streamMessage(
    request: ApiMessageRequest
  ): AsyncIterable<ApiStreamEvent> {
    this.requests.push(request);
    this.resolveRequest(request.signal);

    if (request.signal === undefined) {
      throw new Error("missing request signal");
    }

    await new Promise<void>((resolve, reject) => {
      if (request.signal?.aborted === true) {
        reject(new Error("provider aborted"));
        return;
      }

      const timeout = setTimeout(resolve, 5_000);
      request.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(new Error("provider aborted"));
        },
        { once: true }
      );
    });

    yield createApiMessageCompleteEvent({
      message: createAssistantMessage([createTextBlock("not aborted")])
    });
  }
}

function createRecordingSessionBackend(
  saveArgs: SaveSessionSnapshotArgs[]
): SessionBackend {
  return {
    async saveSnapshot(args: SaveSessionSnapshotArgs): Promise<SessionSnapshot> {
      saveArgs.push(args);

      return {
        sessionId: args.sessionId ?? "sess_generated",
        cwd: String(args.cwd),
        model: args.model,
        systemPrompt: args.systemPrompt,
        messages: [...args.messages],
        ...(args.usage === undefined ? {} : { usage: args.usage }),
        toolMetadata: args.toolMetadata ?? {},
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:01.000Z",
        summary: "summary",
        messageCount: args.messages.length,
        path: join(String(args.cwd), `session-${args.sessionId ?? "sess_generated"}.jsonl`)
      };
    },
    async loadLatest(): Promise<SessionSnapshot | undefined> {
      return undefined;
    },
    async loadById(): Promise<SessionSnapshot | undefined> {
      return undefined;
    },
    async listRecent(
      _cwd: string | URL,
      _options?: ListSessionsOptions
    ): Promise<readonly SessionSummary[]> {
      return [];
    },
    async exportTranscript(args: ExportSessionTranscriptArgs): Promise<string> {
      return join(String(args.cwd), `transcript-${args.sessionId}.md`);
    }
  };
}

async function waitUntil(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}
