import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  collectEnvironmentInfo,
  formatEnvironmentSection,
  type EnvironmentInfo
} from "../src/prompts/index.js";

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
