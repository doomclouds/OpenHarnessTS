import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { release as osRelease, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  collectEnvironmentInfo,
  formatEnvironmentSection,
  type EnvironmentInfo
} from "../src/prompts/index.js";
import {
  buildSystemPrompt as buildSystemPromptFromRoot,
  formatEnvironmentSection as formatEnvironmentSectionFromRoot
} from "../src/index.js";

const environment: EnvironmentInfo = {
  osName: "Windows",
  osVersion: "11.0.0",
  platformMachine: "x64",
  shell: "powershell",
  cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
  homeDir: "C:/Users/10062",
  date: "2026-06-12",
  nodeVersion: "v20.14.0",
  nodeExecutable: "C:/Program Files/nodejs/node.exe",
  isGitRepo: true,
  gitBranch: "master",
  hostname: "dev-box"
};

describe("buildSystemPrompt", () => {
  it("builds the default OpenHarness prompt with an environment section", () => {
    const prompt = buildSystemPrompt({ environment });

    expect(prompt).toContain("You are OpenHarness");
    expect(prompt).toContain("open-source AI coding assistant runtime");
    expect(prompt).toContain("# System");
    expect(prompt).toContain("# Doing tasks");
    expect(prompt).toContain("# Executing actions with care");
    expect(prompt).toContain("# Using your tools");
    expect(prompt).toContain("# Tone and style");
    expect(prompt).toContain("# Environment");
    expect(prompt).toContain("- Working directory: C:/WorkSpace/ResearchProjects/OpenHarnessTS");
    expect(prompt).toContain("- Node: v20.14.0");
    expect(prompt).toContain("- Git: yes (branch: master)");
    expect(prompt).not.toContain("You are OpenHarnessTS");
    expect(prompt).not.toContain("OpenHarness TS");
  });
});

describe("collectEnvironmentInfo", () => {
  it("collects Node runtime information for a non-git directory without throwing", () => {
    const directory = mkdtempSync(join(tmpdir(), "openharness-prompts-"));

    try {
      const info = collectEnvironmentInfo({
        cwd: directory,
        env: {
          SHELL: "pwsh"
        }
      });

      expect(info.cwd).toBe(directory);
      expect(info.nodeVersion).toBe(process.version);
      expect(info.nodeExecutable).toBe(process.execPath);
      expect(info.osVersion).toBe(osRelease());
      expect(info.osVersion).not.toContain(process.platform);
      expect(info.shell).toBe("pwsh");
      expect(info.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(info.isGitRepo).toBe(false);
      expect(info.gitBranch).toBeUndefined();
      expect(info.extra).toEqual({ platform: process.platform });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("detects a git repository branch when git is available", () => {
    const directory = mkdtempSync(join(tmpdir(), "openharness-prompts-git-"));

    try {
      execFileSync("git", ["init", "-b", "prompt-test"], {
        cwd: directory,
        stdio: "ignore"
      });

      const info = collectEnvironmentInfo({ cwd: directory });

      expect(info.isGitRepo).toBe(true);
      expect(info.gitBranch).toBe("prompt-test");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps git repository status when branch lookup fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "openharness-prompts-branchless-"));
    const gitBin = mkdtempSync(join(tmpdir(), "openharness-prompts-git-bin-"));
    const pathKey =
      Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";

    try {
      const gitEnv: NodeJS.ProcessEnv = {
        ...process.env,
        [pathKey]:
          process.env[pathKey] === undefined
            ? gitBin
            : `${gitBin}${delimiter}${process.env[pathKey]}`
      };
      gitEnv.PATH = gitEnv[pathKey];
      gitEnv.Path = gitEnv[pathKey];

      if (process.platform === "win32") {
        const gitHook = join(gitBin, "git-shim.cjs");

        writeFileSync(
          gitHook,
          `const path = require("node:path");
const args = process.argv.slice(1);
const command = args[0] === undefined ? "" : path.basename(args[0]);

if (command === "rev-parse" && args[1] === "--is-inside-work-tree") {
  process.stdout.write("true\\n");
  process.exit(0);
}

if (command === "branch" && args[1] === "--show-current") {
  process.exit(1);
}

process.exit(1);
`,
          "utf8"
        );
        copyFileSync(process.execPath, join(gitBin, "git.exe"));
        gitEnv.NODE_OPTIONS =
          process.env.NODE_OPTIONS === undefined
            ? `--require=${gitHook}`
            : `${process.env.NODE_OPTIONS} --require=${gitHook}`;
      } else {
        const gitShim = join(gitBin, "git");

        writeFileSync(
          gitShim,
          `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--is-inside-work-tree" ]; then
  printf 'true\\n'
  exit 0
fi

if [ "$1" = "branch" ] && [ "$2" = "--show-current" ]; then
  exit 1
fi

exit 1
`,
          "utf8"
        );
        chmodSync(gitShim, 0o755);
      }

      const info = collectEnvironmentInfo({ cwd: directory, env: gitEnv });

      expect(info.isGitRepo).toBe(true);
      expect(info.gitBranch).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(gitBin, { recursive: true, force: true });
    }
  });
});

describe("custom system prompts", () => {
  it("replaces the default base prompt while keeping the environment section", () => {
    const prompt = buildSystemPrompt({
      customPrompt: "Custom instructions only.",
      environment
    });

    expect(prompt).toContain("Custom instructions only.");
    expect(prompt).toContain("# Environment");
    expect(prompt).toContain("- Node executable: C:/Program Files/nodejs/node.exe");
    expect(prompt).not.toContain("open-source AI coding assistant runtime");
  });
});

describe("formatEnvironmentSection", () => {
  it("formats a git environment with an exact Node-focused section", () => {
    expect(formatEnvironmentSection(environment)).toBe(`# Environment
- OS: Windows 11.0.0
- Architecture: x64
- Shell: powershell
- Working directory: C:/WorkSpace/ResearchProjects/OpenHarnessTS
- Date: 2026-06-12
- Node: v20.14.0
- Node executable: C:/Program Files/nodejs/node.exe
- Git: yes (branch: master)`);
  });

  it("formats a branchless git environment without an undefined branch", () => {
    const { gitBranch: _gitBranch, ...branchless } = environment;

    expect(formatEnvironmentSection(branchless)).toBe(`# Environment
- OS: Windows 11.0.0
- Architecture: x64
- Shell: powershell
- Working directory: C:/WorkSpace/ResearchProjects/OpenHarnessTS
- Date: 2026-06-12
- Node: v20.14.0
- Node executable: C:/Program Files/nodejs/node.exe
- Git: yes`);
  });

  it("formats a non-git environment without git details", () => {
    const { gitBranch: _gitBranch, ...branchless } = environment;
    const nonGit = {
      ...branchless,
      isGitRepo: false
    };

    expect(formatEnvironmentSection(nonGit)).toBe(`# Environment
- OS: Windows 11.0.0
- Architecture: x64
- Shell: powershell
- Working directory: C:/WorkSpace/ResearchProjects/OpenHarnessTS
- Date: 2026-06-12
- Node: v20.14.0
- Node executable: C:/Program Files/nodejs/node.exe`);
  });
});

describe("prompt root exports", () => {
  it("exports prompt builders from the package root", () => {
    expect(buildSystemPromptFromRoot({ environment })).toBe(
      buildSystemPrompt({ environment })
    );
    expect(formatEnvironmentSectionFromRoot(environment)).toBe(
      formatEnvironmentSection(environment)
    );
  });
});

describe("prompt integration boundary", () => {
  it("keeps runQuery from implicitly importing the prompt builder", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/engine/query.ts", "utf8");

    expect(source).not.toContain("buildSystemPrompt");
    expect(source).not.toContain("../prompts");
    expect(source).not.toContain("project-instructions");
    expect(source).not.toContain("loadProjectInstructions");
  });

  it("keeps buildSystemPrompt from implicitly loading project instructions", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/prompts/system-prompt.ts", "utf8");

    expect(source).not.toContain("project-instructions");
    expect(source).not.toContain("loadProjectInstructions");
    expect(source).not.toContain("discoverProjectInstructions");
  });
});
