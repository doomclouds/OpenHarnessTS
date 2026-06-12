import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  discoverProjectInstructions,
  formatProjectInstructionsSection,
  loadProjectInstructions,
  type LoadedProjectInstruction,
  type ProjectInstructionFile
} from "../src/prompts/index.js";

function makeTempProject(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeText(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
}

function paths(files: readonly ProjectInstructionFile[]): readonly string[] {
  return files.map((file) => file.path);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

describe("discoverProjectInstructions", () => {
  it("discovers project instructions from cwd upward in stable order", () => {
    const root = makeTempProject("openharness-instructions-");

    try {
      const repo = join(root, "repo");
      const nested = join(repo, "packages", "app");
      const rules = join(repo, ".claude", "rules");
      mkdirSync(nested, { recursive: true });
      mkdirSync(rules, { recursive: true });

      writeText(join(nested, "AGENTS.md"), "nested agents");
      writeText(join(repo, "AGENTS.md"), "root agents");
      writeText(join(repo, "CLAUDE.md"), "root claude");
      writeText(join(repo, ".claude", "CLAUDE.md"), "project claude");
      writeText(join(rules, "b.md"), "rule b");
      writeText(join(rules, "a.md"), "rule a");
      writeText(join(rules, "notes.txt"), "not a markdown rule");

      const files = discoverProjectInstructions(nested, { stopAt: repo });

      expect(paths(files)).toEqual([
        resolve(nested, "AGENTS.md"),
        resolve(repo, "AGENTS.md"),
        resolve(repo, "CLAUDE.md"),
        resolve(repo, ".claude", "CLAUDE.md"),
        resolve(repo, ".claude", "rules", "a.md"),
        resolve(repo, ".claude", "rules", "b.md")
      ]);
      expect(files.map((file) => file.kind)).toEqual([
        "agents",
        "agents",
        "claude",
        "claude_project",
        "claude_rule",
        "claude_rule"
      ]);
      expect(files.map((file) => file.order)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(files[0]?.directory).toBe(resolve(nested));
      expect(files[4]?.directory).toBe(resolve(repo, ".claude", "rules"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports file URL cwd and returns an empty array when no files exist", () => {
    const root = makeTempProject("openharness-instructions-empty-");

    try {
      const repo = join(root, "repo");
      mkdirSync(repo, { recursive: true });

      expect(discoverProjectInstructions(pathToFileURL(repo), { stopAt: repo })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips claude rules when the rules directory cannot be listed", async () => {
    const root = makeTempProject("openharness-instructions-rules-probe-");

    try {
      const repo = join(root, "repo");
      const rules = join(repo, ".claude", "rules");
      mkdirSync(rules, { recursive: true });
      writeText(join(repo, "AGENTS.md"), "repo agents");
      writeText(join(rules, "hidden.md"), "unreadable rule");

      vi.resetModules();
      vi.doMock("node:fs", async (importOriginal) => {
        const actual = await importOriginal<typeof import("node:fs")>();
        const actualReaddirSync = actual.readdirSync as (
          path: Parameters<typeof actual.readdirSync>[0],
          options?: unknown
        ) => unknown;
        const readdirSync = ((path, options?: unknown) => {
          if (resolve(String(path)) === resolve(rules)) {
            throw Object.assign(new Error("EACCES: permission denied"), {
              code: "EACCES"
            });
          }

          return actualReaddirSync(path, options);
        }) as typeof actual.readdirSync;

        return {
          ...actual,
          readdirSync
        };
      });

      const { discoverProjectInstructions: discoverWithFailingReaddir } =
        await import("../src/prompts/project-instructions.js");

      expect(paths(discoverWithFailingReaddir(repo, { stopAt: repo }))).toEqual([
        resolve(repo, "AGENTS.md")
      ]);
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes stopAt and rejects cwd outside stopAt", () => {
    const root = makeTempProject("openharness-instructions-stop-");

    try {
      const repo = join(root, "repo");
      const nested = join(repo, "src");
      const outside = join(root, "outside");
      mkdirSync(nested, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeText(join(repo, "AGENTS.md"), "repo agents");

      expect(paths(discoverProjectInstructions(nested, { stopAt: repo }))).toEqual([
        resolve(repo, "AGENTS.md")
      ]);
      expect(() =>
        discoverProjectInstructions(outside, { stopAt: repo })
      ).toThrow("cwd must be inside stopAt.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid cwd inputs", () => {
    expect(() => discoverProjectInstructions("")).toThrow("cwd must be a non-empty path.");
    expect(() => discoverProjectInstructions(new URL("https://example.com/repo"))).toThrow(
      "cwd URL must use the file: protocol."
    );
  });
});

describe("loadProjectInstructions", () => {
  it("loads instructions with provenance and formats section", () => {
    const root = makeTempProject("openharness-instructions-load-");

    try {
      const repo = join(root, "repo");
      mkdirSync(repo, { recursive: true });
      writeText(join(repo, "AGENTS.md"), "  use repo rules  ");

      const loaded = loadProjectInstructions(repo, { stopAt: repo });

      expect(loaded).not.toBeUndefined();
      expect(loaded?.cwd).toBe(resolve(repo));
      expect(loaded?.files).toHaveLength(1);
      expect(loaded?.files[0]).toMatchObject({
        path: resolve(repo, "AGENTS.md"),
        kind: "agents",
        directory: resolve(repo),
        order: 0,
        content: "  use repo rules  ",
        originalCharCount: 18,
        loadedCharCount: 18,
        truncated: false
      });
      expect(loaded?.section).toBe(`# Project Instructions

## ${resolve(repo, "AGENTS.md")}
\`\`\`md
use repo rules
\`\`\``);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns undefined when no instruction files exist", () => {
    const root = makeTempProject("openharness-instructions-load-empty-");

    try {
      const repo = join(root, "repo");
      mkdirSync(repo, { recursive: true });

      expect(loadProjectInstructions(repo, { stopAt: repo })).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("truncates each file independently and records counts", () => {
    const root = makeTempProject("openharness-instructions-truncate-");

    try {
      const repo = join(root, "repo");
      mkdirSync(repo, { recursive: true });
      writeText(join(repo, "AGENTS.md"), "abcdef");
      writeText(join(repo, "CLAUDE.md"), "xy");

      const loaded = loadProjectInstructions(repo, {
        stopAt: repo,
        maxCharsPerFile: 3
      });
      const truncatedContent = "abc\n...[truncated]...";

      expect(loaded?.files.map((file) => ({
        content: file.content,
        originalCharCount: file.originalCharCount,
        loadedCharCount: file.loadedCharCount,
        truncated: file.truncated
      }))).toEqual([
        {
          content: truncatedContent,
          originalCharCount: 6,
          loadedCharCount: codePointLength(truncatedContent),
          truncated: true
        },
        {
          content: "xy",
          originalCharCount: 2,
          loadedCharCount: 2,
          truncated: false
        }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("truncates astral unicode by code point without replacement chars", () => {
    const root = makeTempProject("openharness-instructions-unicode-truncate-");

    try {
      const repo = join(root, "repo");
      mkdirSync(repo, { recursive: true });
      writeText(join(repo, "AGENTS.md"), "😀abc");

      const loaded = loadProjectInstructions(repo, {
        stopAt: repo,
        maxCharsPerFile: 2
      });
      const expectedContent = "😀a\n...[truncated]...";

      expect(loaded?.files[0]).toMatchObject({
        content: expectedContent,
        originalCharCount: 4,
        loadedCharCount: codePointLength(expectedContent),
        truncated: true
      });
      expect(loaded?.files[0]?.content).not.toContain("\uFFFD");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replaces invalid UTF-8 byte sequences while loading", () => {
    const root = makeTempProject("openharness-instructions-utf8-");

    try {
      const repo = join(root, "repo");
      mkdirSync(repo, { recursive: true });
      writeFileSync(join(repo, "AGENTS.md"), Buffer.from([0x61, 0xff, 0x62]));

      const loaded = loadProjectInstructions(repo, { stopAt: repo });

      expect(loaded?.files[0]?.content).toBe("a�b");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid maxCharsPerFile values", () => {
    const root = makeTempProject("openharness-instructions-invalid-limit-");

    try {
      const repo = join(root, "repo");
      mkdirSync(repo, { recursive: true });
      writeText(join(repo, "AGENTS.md"), "hello");

      expect(() =>
        loadProjectInstructions(repo, { stopAt: repo, maxCharsPerFile: 0 })
      ).toThrow("maxCharsPerFile must be a positive integer.");
      expect(() =>
        loadProjectInstructions(repo, { stopAt: repo, maxCharsPerFile: 1.5 })
      ).toThrow("maxCharsPerFile must be a positive integer.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("formatProjectInstructionsSection", () => {
  it("returns undefined for empty list", () => {
    expect(formatProjectInstructionsSection([])).toBeUndefined();
  });

  it("formats loaded files without filesystem access", () => {
    const files: readonly LoadedProjectInstruction[] = [
      {
        path: "C:/repo/AGENTS.md",
        kind: "agents",
        directory: "C:/repo",
        order: 0,
        content: "alpha",
        originalCharCount: 5,
        loadedCharCount: 5,
        truncated: false
      }
    ];

    expect(formatProjectInstructionsSection(files)).toBe(`# Project Instructions

## C:/repo/AGENTS.md
\`\`\`md
alpha
\`\`\``);
  });
});
