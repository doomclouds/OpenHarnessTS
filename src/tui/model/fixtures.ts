import { applyTuiEvent, createInitialTuiState } from "./reducer.js";
import type { TuiState, TuiToolTraceItem, TuiTranscriptItem } from "./types.js";

export function createIdleWelcomeFixture(): TuiState {
  return applyTuiEvent(
    createInitialTuiState({
      cwdLabel: "OpenHarnessTS",
      modelLabel: "deepseek-chat",
      permissionMode: "default",
      tokenLabel: "0 tokens",
      width: 120
    }),
    {
      type: "ready"
    }
  );
}

export function createNarrowIdleFixture(): TuiState {
  return applyTuiEvent(
    createInitialTuiState({
      cwdLabel: "OpenHarnessTS",
      modelLabel: "deepseek-reasoner",
      permissionMode: "default",
      tokenLabel: "0 tokens",
      width: 72
    }),
    {
      type: "ready"
    }
  );
}

export function createNoColorIdleFixture(): TuiState {
  return applyTuiEvent(
    createInitialTuiState({
      cwdLabel: "OpenHarnessTS",
      modelLabel: "deepseek-chat",
      permissionMode: "default",
      tokenLabel: "0 tokens",
      colorMode: "none",
      width: 120
    }),
    {
      type: "ready"
    }
  );
}

export function createBusyFixture(): TuiState {
  return applyTuiEvent(createIdleWelcomeFixture(), {
    type: "tool_started",
    item: {
      kind: "tool_trace",
      toolName: "read_file",
      inputSummary: "path: src/tui/model/fixtures.ts",
      status: "running"
    }
  });
}

export function createAssistantTextFixture(): TuiState {
  return {
    ...createIdleWelcomeFixture(),
    transcript: [
      {
        kind: "assistant",
        text: [
          "Here is the fixture transcript:",
          "",
          "- Preserve paragraphs",
          "- Preserve lists",
          "",
          "```ts",
          'const status = "ready";',
          "```"
        ].join("\n")
      }
    ]
  };
}

export function createToolTraceFixture(): TuiState {
  return {
    ...createIdleWelcomeFixture(),
    transcript: createToolTraceItems()
  };
}

export function createErrorFixture(): TuiState {
  const ready = applyTuiEvent(createInitialTuiState(), {
    type: "ready",
    state: {
      footerHints: ["/ for commands", "/exit"]
    }
  });

  return applyTuiEvent(ready, {
    type: "error",
    message: "Runtime initialization failed",
    detail: "Missing model"
  });
}

export function createNarrowToolTraceFixture(): TuiState {
  return {
    ...createNarrowIdleFixture(),
    transcript: createToolTraceItems()
  };
}

export function createNoColorToolTraceFixture(): TuiState {
  return {
    ...createNoColorIdleFixture(),
    transcript: createToolTraceItems()
  };
}

export function createChineseTranscriptFixture(): TuiState {
  return {
    ...createIdleWelcomeFixture(),
    transcript: [
      {
        kind: "user",
        text: "请读取配置文件"
      },
      {
        kind: "assistant",
        text: "已完成：配置项校验通过。"
      },
      {
        kind: "tool_trace",
        toolName: "read_file",
        inputSummary: "path: 配置/默认设置.json",
        status: "completed",
        resultSummary: "读取 １２ 行"
      }
    ]
  };
}

export function createCommandPickerFixture(): TuiState {
  return {
    ...createIdleWelcomeFixture(),
    mode: "command",
    inputValue: "/sta",
    commandPicker: {
      query: "sta",
      selectedIndex: 0
    }
  };
}

export function createPermissionPanelFixture(): TuiState {
  return applyTuiEvent(createIdleWelcomeFixture(), {
    type: "panel_opened",
    panel: {
      kind: "permission",
      requestId: "fixture-permission-write-file",
      toolName: "Bash",
      reason: "Validate runtime behavior after TUI protocol changes.",
      commandPreview: "npm run test",
      workingDirectory: "C:\\WorkSpace\\ResearchProjects\\OpenHarnessTS"
    }
  });
}

export function createInitializationErrorFixture(): TuiState {
  return createErrorFixture();
}

function createToolTraceItems(): readonly TuiToolTraceItem[] {
  return [
    {
      kind: "tool_trace",
      toolName: "read_file",
      inputSummary: "path: src/tui/model/fixtures.ts",
      status: "running",
      toolUseId: "fixture-read"
    },
    {
      kind: "tool_trace",
      toolName: "grep",
      inputSummary: "pattern: tool_trace",
      status: "completed",
      resultSummary: "3 matches",
      durationLabel: "42ms",
      toolUseId: "fixture-grep"
    },
    {
      kind: "tool_trace",
      toolName: "shell",
      inputSummary: "command: npm test",
      status: "failed",
      errorSummary: "exit code 1",
      durationLabel: "1.2s",
      toolUseId: "fixture-shell"
    }
  ] satisfies readonly TuiTranscriptItem[];
}
