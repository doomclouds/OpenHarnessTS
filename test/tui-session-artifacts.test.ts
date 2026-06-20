import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../src/sessions/index.js";
import { createTuiSessionArtifacts } from "../src/tui/runtime/index.js";

function createSnapshot(path: string): SessionSnapshot {
  return {
    sessionId: "sess_tui_runtime",
    cwd: "C:\\work\\project",
    model: "fake-model",
    systemPrompt: "System",
    messages: [],
    toolMetadata: {
      permissionMode: "default"
    },
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:01.000Z",
    summary: "Prompt",
    messageCount: 2,
    path
  };
}

describe("TUI session artifacts", () => {
  it("creates display session artifacts from saved snapshot paths", () => {
    const snapshotPath =
      "C:\\work\\project\\.openharness\\sessions\\session-sess_tui_runtime.jsonl";
    const transcriptPath =
      "C:\\work\\project\\.openharness\\sessions\\transcript-sess_tui_runtime.md";

    expect(createTuiSessionArtifacts(createSnapshot(snapshotPath), transcriptPath)).toEqual({
      sessionId: "sess_tui_runtime",
      latestPath: win32.join(win32.dirname(snapshotPath), "latest.json"),
      transcriptPath
    });
  });

  it("creates display session artifacts from structured transcript and markdown exports", () => {
    const snapshotPath =
      "C:\\work\\project\\.openharness\\sessions\\session-sess_tui_runtime.jsonl";
    const transcriptPath =
      "C:\\work\\project\\.openharness\\sessions\\transcript-sess_tui_runtime.md";
    const markdownPath =
      "C:\\work\\project\\.openharness\\sessions\\session-sess_tui_runtime.md";

    expect(
      createTuiSessionArtifacts(createSnapshot(snapshotPath), {
        transcriptPath,
        markdownPath
      })
    ).toEqual({
      sessionId: "sess_tui_runtime",
      latestPath: win32.join(win32.dirname(snapshotPath), "latest.json"),
      transcriptPath,
      markdownPath
    });
  });

  it("degrades when transcript and markdown exports are missing", () => {
    const snapshotPath =
      "C:\\work\\project\\.openharness\\sessions\\session-sess_tui_runtime.jsonl";

    expect(createTuiSessionArtifacts(createSnapshot(snapshotPath))).toEqual({
      sessionId: "sess_tui_runtime",
      latestPath: win32.join(win32.dirname(snapshotPath), "latest.json")
    });
  });
});
