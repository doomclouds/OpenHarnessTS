import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
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
