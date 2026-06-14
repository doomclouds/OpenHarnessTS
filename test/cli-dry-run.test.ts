import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCliDryRunPreview,
  renderCliDryRunPreview
} from "../src/cli/index.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function isolatedEnv(root: string): NodeJS.ProcessEnv {
  return {
    OPENHARNESS_CONFIG_DIR: join(root, "config")
  };
}

describe("buildCliDryRunPreview", () => {
  it("builds an interactive-session preview for bare dry-run", () => {
    const root = createTempDir("openharness-dry-run-bare-");

    try {
      const preview = buildCliDryRunPreview({
        cwd: root,
        outputFormat: "text",
        env: isolatedEnv(root)
      });

      expect(preview).toMatchObject({
        type: "dry_run_preview",
        mode: "dry-run",
        cwd: resolve(root),
        promptPreview: "",
        entrypoint: {
          kind: "interactive_session"
        },
        settings: {
          provider: "deepseek",
          apiFormat: "openai-compatible",
          apiKeySource: "missing",
          outputFormat: "text"
        },
        validation: {
          authStatus: "missing"
        },
        readiness: {
          level: "ready"
        }
      });
      expect(preview.paths.projectConfigDir).toBe(
        join(resolve(root), ".openharness")
      );
      expect(preview.paths.sessionDir).toContain("openharness-dry-run-bare-");
      expect(preview.discovery.tools.map((tool) => tool.name)).toEqual([
        "read_file",
        "glob",
        "grep"
      ]);
      expect(JSON.stringify(preview)).not.toContain("flag-key");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds a ready model-prompt preview when a key is configured", () => {
    const root = createTempDir("openharness-dry-run-ready-");

    try {
      const preview = buildCliDryRunPreview({
        prompt: "  explain this project  ",
        cwd: root,
        outputFormat: "json",
        apiKey: "flag-key",
        model: "flag-model",
        baseURL: "https://flag.example.com///",
        maxTurns: 3,
        permissionMode: "plan",
        env: isolatedEnv(root)
      });

      expect(preview).toMatchObject({
        prompt: "explain this project",
        promptPreview: "explain this project",
        entrypoint: {
          kind: "model_prompt"
        },
        settings: {
          model: "flag-model",
          modelSource: "flag",
          baseURL: "https://flag.example.com",
          baseURLSource: "flag",
          apiKeySource: "flag",
          permissionMode: "plan",
          maxTurns: 3,
          outputFormat: "json"
        },
        validation: {
          authStatus: "configured",
          apiClient: { status: "ok", detail: "" }
        },
        readiness: {
          level: "ready"
        }
      });
      expect(preview.systemPromptPreview).toContain("# OpenHarness");
      expect(preview.validation.systemPromptChars).toBeGreaterThan(0);
      expect(JSON.stringify(preview)).not.toContain("flag-key");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks model-prompt readiness when the key is missing", () => {
    const root = createTempDir("openharness-dry-run-blocked-");

    try {
      const preview = buildCliDryRunPreview({
        prompt: "hello",
        cwd: root,
        outputFormat: "text",
        env: isolatedEnv(root)
      });

      expect(preview.entrypoint.kind).toBe("model_prompt");
      expect(preview.readiness.level).toBe("blocked");
      expect(preview.readiness.reasons.join(" ")).toContain("DEEPSEEK_API_KEY");
      expect(preview.readiness.nextActions.join(" ")).toContain("--api-key");
      expect(preview.validation.apiClient.status).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("summarizes discovered project instruction sources", () => {
    const root = createTempDir("openharness-dry-run-instructions-");

    try {
      writeFileSync(
        join(root, "AGENTS.md"),
        "# Fixture Agent Instructions\n\nAlways mention DRY_RUN_TARGET.\n",
        "utf8"
      );

      const preview = buildCliDryRunPreview({
        prompt: "hello",
        cwd: root,
        outputFormat: "text",
        apiKey: "flag-key",
        env: isolatedEnv(root)
      });

      expect(preview.discovery.instructionSources).toEqual([
        expect.objectContaining({
          kind: "agents",
          path: join(resolve(root), "AGENTS.md"),
          truncated: false
        })
      ]);
      expect(preview.systemPromptPreview).toContain("DRY_RUN_TARGET");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("renderCliDryRunPreview", () => {
  it("renders text, json, and stream-json without leaking API keys", () => {
    const root = createTempDir("openharness-dry-run-render-");

    try {
      const preview = buildCliDryRunPreview({
        prompt: "hello",
        cwd: root,
        outputFormat: "text",
        apiKey: "flag-key",
        env: isolatedEnv(root)
      });

      const text = renderCliDryRunPreview({ preview, format: "text" });
      expect(text).toContain("OpenHarness Dry Run");
      expect(text).toContain("Readiness");
      expect(text).toContain("Resolved Settings");
      expect(text).toContain("Available Tools");
      expect(text).not.toContain("flag-key");

      const json = renderCliDryRunPreview({ preview, format: "json" });
      expect(JSON.parse(json)).toMatchObject({
        type: "dry_run_preview",
        mode: "dry-run"
      });
      expect(json).not.toContain("flag-key");

      const jsonLines = renderCliDryRunPreview({
        preview,
        format: "stream-json"
      })
        .trimEnd()
        .split("\n");
      expect(jsonLines).toHaveLength(1);
      expect(JSON.parse(jsonLines[0] ?? "{}")).toMatchObject({
        type: "dry_run_preview",
        mode: "dry-run"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
