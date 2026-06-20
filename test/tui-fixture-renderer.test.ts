import { describe, expect, it } from "vitest";
import {
  applyTuiEvent,
  createAssistantTextFixture,
  createBusyFixture,
  createCommandPickerFixture,
  createChineseTranscriptFixture,
  createErrorFixture,
  createIdleWelcomeFixture,
  createInitialTuiState,
  createInitializationErrorFixture,
  createNarrowToolTraceFixture,
  createNarrowIdleFixture,
  createNoColorToolTraceFixture,
  createNoColorIdleFixture,
  createPermissionPanelFixture,
  createToolTraceFixture,
  renderTuiFixture
} from "../src/tui/model/index.js";

describe("TUI fixture renderer", () => {
  it("renders the idle welcome shell", () => {
    const output = renderTuiFixture(createIdleWelcomeFixture());

    expect(output).toContain("OpenHarness");
    expect(output).toContain("alpha tui - interactive session");
    expect(output).toContain("Welcome to OpenHarness");
    expect(output).toContain("> ");
    expect(output).toContain("/ for commands");
  });

  it("keeps fixed shell rows while cropping older fixture body lines", () => {
    const transcript = Array.from({ length: 18 }, (_, index) => ({
      kind: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index}`
    })) as ReturnType<typeof createIdleWelcomeFixture>["transcript"];
    const output = renderTuiFixture({
      ...createIdleWelcomeFixture(),
      height: 14,
      transcript
    });

    expect(output).toContain("OpenHarness");
    expect(output).toContain("alpha tui - interactive session");
    expect(output).toContain("message 17");
    expect(output).not.toContain("message 0");
    expect(output).toContain("> ");
    expect(output).toContain("/ for commands");
  });

  it("hides low-priority metadata in narrow layouts", () => {
    const output = renderTuiFixture(createNarrowIdleFixture());

    expect(output).not.toContain("deepseek-reasoner");
    expect(output).not.toContain("0 tokens");
  });

  it("keeps long working directories out of the status header", () => {
    const output = renderTuiFixture(
      applyTuiEvent(
        createInitialTuiState({
          cwdLabel: "C:\\WorkSpace\\ResearchProjects\\OpenHarnessTS",
          modelLabel: "deepseek-v4-flash",
          permissionMode: "default",
          width: 160
        }),
        { type: "ready" }
      )
    );

    expect(output).toContain("alpha tui - interactive session");
    expect(output).not.toContain("C:\\WorkSpace\\ResearchProjects\\OpenHarnessTS");
  });

  it("does not render pseudo color markers in no-color mode", () => {
    const output = renderTuiFixture(createNoColorIdleFixture());

    expect(output).not.toContain("[brand]");
    expect(output).not.toContain("[accent]");
  });

  it("renders busy state and interrupt footer", () => {
    const output = renderTuiFixture(createBusyFixture());

    expect(output).toContain("ReadFile(path: src/tui/model/fixtures.ts)");
    expect(output).toContain("running");
    expect(output).toContain("Running read_file...");
    expect(output).toContain("Esc to interrupt");
    expect(output).toContain("...");
  });

  it("renders assistant paragraphs, lists, and fenced code", () => {
    const output = renderTuiFixture(createAssistantTextFixture());

    expect(output).toContain("Here is the fixture transcript:");
    expect(output).toContain("- Preserve paragraphs");
    expect(output).toContain("- Preserve lists");
    expect(output).toContain("```ts");
    expect(output).toContain("const status = \"ready\";");
    expect(output).toContain("```");
  });

  it("normalizes lightweight markdown emphasis in assistant text", () => {
    const output = renderTuiFixture({
      ...createIdleWelcomeFixture(),
      transcript: [
        {
          kind: "assistant",
          text: "This is **important** output."
        }
      ]
    });

    expect(output).toContain("This is important output.");
    expect(output).not.toContain("**important**");
  });

  it("renders running, completed, and failed tool traces", () => {
    const output = renderTuiFixture(createToolTraceFixture());

    expect(output).toContain("ReadFile(path: src/tui/model/fixtures.ts)");
    expect(output).toContain("Grep(pattern: tool_trace)");
    expect(output).toContain("completed - 3 matches - 42ms");
    expect(output).toContain("Shell(command: npm test)");
    expect(output).toContain("failed - exit code 1 - 1.2s");
  });

  it("renders completed tool traces in the transcript", () => {
    const state = createInitialTuiState({
      width: 120
    });

    const output = renderTuiFixture({
      ...state,
      transcript: [
        {
          kind: "tool_trace",
          toolName: "grep",
          inputSummary: "pattern: tool_trace",
          status: "completed",
          resultSummary: "3 matches"
        }
      ]
    });

    expect(output).toContain("Grep(pattern: tool_trace)");
    expect(output).toContain("completed - 3 matches");
  });

  it("renders error fixtures with details", () => {
    const output = renderTuiFixture(createErrorFixture());

    expect(output).toContain("* Error");
    expect(output).toContain("Runtime initialization failed");
    expect(output).toContain("Missing model");
  });

  it("renders tool traces in narrow layouts", () => {
    const output = renderTuiFixture(createNarrowToolTraceFixture());

    expect(output).toContain("Grep(pattern: tool_trace)");
    expect(output).toContain("completed - 3 matches - 42ms");
    expect(output).not.toContain("deepseek-reasoner");
    expect(output).not.toContain("0 tokens");
  });

  it("renders tool traces in no-color mode without pseudo markers", () => {
    const output = renderTuiFixture(createNoColorToolTraceFixture());

    expect(output).toContain("Grep(pattern: tool_trace)");
    expect(output).toContain("completed - 3 matches - 42ms");
    expect(output).toContain("Shell(command: npm test)");
    expect(output).toContain("failed - exit code 1 - 1.2s");
    expect(output).not.toContain("[brand]");
    expect(output).not.toContain("[accent]");
  });

  it("renders Chinese and full-width transcript text", () => {
    const output = renderTuiFixture(createChineseTranscriptFixture());

    expect(output).toContain("> 请读取配置文件");
    expect(output).toContain("已完成：配置项校验通过。");
    expect(output).toContain("ReadFile(path: 配置/默认设置.json)");
    expect(output).toContain("completed - 读取 １２ 行");
  });

  it("keeps Chinese transcript and tool rows readable at width 72 without color", () => {
    const output = renderTuiFixture({
      ...createChineseTranscriptFixture(),
      colorMode: "none",
      width: 72
    });

    expect(output).toContain("> 请读取配置文件");
    expect(output).toContain("已完成：配置项校验通过。");
    expect(output).toContain("ReadFile(path: 配置/默认设置.json)");
    expect(output).toContain("completed - 读取 １２ 行");
    expect(output).not.toContain("deepseek-chat");
    expect(output).not.toContain("[accent]");
  });

  it("renders command picker with the current slash query", () => {
    const output = renderTuiFixture(createCommandPickerFixture());

    expect(output).toContain("/status");
    expect(output).toContain("Show current session status");
    expect(output).toContain("> /sta");
  });

  it("renders narrow command picker without descriptions", () => {
    const output = renderTuiFixture({
      ...createCommandPickerFixture(),
      width: 72
    });

    expect(output).toContain("Commands  type to filter");
    expect(output).toContain("> /status");
    expect(output).not.toContain("Show current session status");
  });

  it("renders no-color command picker with textual selection state", () => {
    const output = renderTuiFixture({
      ...createCommandPickerFixture(),
      colorMode: "none"
    });

    expect(output).toContain("Commands  type to filter");
    expect(output).toContain("> /status");
    expect(output).toContain("Up/Down move - Enter select - Esc close");
    expect(output).not.toContain("[accent]");
  });

  it("keeps no-color permission panels meaningful without ANSI-only semantics", () => {
    const output = renderTuiFixture({
      ...createPermissionPanelFixture(),
      colorMode: "none",
      width: 72,
      panelSelectionIndex: 2
    });

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).toContain("> Deny");
    expect(output).toContain("Allow once");
    expect(output).toContain("Enter confirm - Tab move - Esc deny");
    expect(output).not.toContain("[brand]");
    expect(output).not.toContain("[accent]");
    expect(output).not.toContain("[danger]");
  });

  it("renders busy interrupt intent as text only", () => {
    const output = renderTuiFixture({
      ...createBusyFixture(),
      interruptRequested: true,
      status: {
        ...createBusyFixture().status,
        busyLabel: "Stopping current operation..."
      }
    });

    expect(output).toContain("Stopping current operation...");
    expect(output).toContain("Esc to interrupt");
  });

  it("does not render command picker when an active panel exists", () => {
    const output = renderTuiFixture({
      ...createPermissionPanelFixture(),
      inputValue: "/help",
      commandPicker: {
        query: "help",
        selectedIndex: 0
      }
    });

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).not.toContain("Commands  type to filter");
  });

  it("suppresses command mode picker while an active panel exists", () => {
    const output = renderTuiFixture({
      ...createPermissionPanelFixture(),
      mode: "command",
      inputValue: "/help",
      commandPicker: {
        query: "help",
        selectedIndex: 0
      }
    });

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).not.toContain("Commands  type to filter");
  });

  it("renders permission panels inline", () => {
    const output = renderTuiFixture(createPermissionPanelFixture());

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).toContain("Bash");
    expect(output).toContain("$ npm run test");
    expect(output).toContain(
      "Reason: Validate runtime behavior after TUI protocol changes."
    );
    expect(output).toContain("Allow once");
    expect(output).toContain("Deny");
    expect(output).not.toContain("popup");
  });

  it("does not duplicate the shell prompt marker in permission command previews", () => {
    const output = renderTuiFixture({
      ...createPermissionPanelFixture(),
      activePanel: {
        kind: "permission",
        requestId: "permission-shell-command",
        toolName: "Bash",
        commandPreview: "$ npm run test"
      }
    });

    expect(output).toContain("$ npm run test");
    expect(output).not.toContain("$ $ npm run test");
  });

  it("keeps permission panel inline instead of popup language", () => {
    const output = renderTuiFixture(createPermissionPanelFixture());

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).not.toContain("popup");
    expect(output).not.toContain("overlay");
    expect(output).not.toContain("window");
  });

  it("renders permission panel selection and keyboard hints", () => {
    const output = renderTuiFixture({
      ...createPermissionPanelFixture(),
      panelSelectionIndex: 1
    });

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).toContain("Bash");
    expect(output).toContain("> Always allow in this project");
    expect(output).toContain("Enter confirm - Tab move - Esc deny");
  });

  it("renders non-Bash permission panels without fixture-specific wording", () => {
    const output = renderTuiFixture({
      ...createIdleWelcomeFixture(),
      mode: "permission",
      activePanel: {
        kind: "permission",
        requestId: "permission-read-file",
        toolName: "Read"
      },
      panelSelectionIndex: 0
    });

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).toContain("Read");
    expect(output).toContain("> Allow once");
    expect(output).toContain("Deny");
    expect(output).not.toContain("project validation");
  });

  it("renders narrow permission panel without losing Deny", () => {
    const output = renderTuiFixture({
      ...createPermissionPanelFixture(),
      width: 72,
      panelSelectionIndex: 2
    });

    expect(output).toContain("* OpenHarness wants to run a command");
    expect(output).toContain("> Deny");
    expect(output).toContain("Allow once");
    expect(output).not.toContain("Show current session status");
  });

  it("renders permission panel close feedback with the tool name", () => {
    const withPanel = createPermissionPanelFixture();
    const closed = applyTuiEvent(withPanel, {
      type: "panel_closed",
      result: {
        kind: "permission",
        requestId: "fixture-permission-write-file",
        decision: "denied"
      }
    });

    const output = renderTuiFixture(closed);

    expect(output).toContain("* Status - Permission denied for Bash.");
    expect(output).not.toContain("request fixture-permission-write-file");
  });

  it("renders initialization errors with recovery hint", () => {
    const output = renderTuiFixture(createInitializationErrorFixture());

    expect(output).toContain("Runtime initialization failed");
    expect(output).toContain("Missing model");
    expect(output).toContain("/exit");
  });
});
