import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverProjectInstructions,
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
