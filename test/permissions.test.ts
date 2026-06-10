import { describe, expect, it } from "vitest";
import {
  PermissionChecker,
  SENSITIVE_PATH_PATTERNS
} from "../src/permissions/index.js";

describe("permission modes", () => {
  it("allows read-only tools in default mode", () => {
    const checker = new PermissionChecker({ mode: "default" });

    const decision = checker.evaluate({
      toolName: "read_file",
      isReadOnly: true
    });

    expect(decision).toEqual({
      allowed: true,
      requiresConfirmation: false,
      reason: "read-only tools are allowed"
    });
  });

  it("requires confirmation for mutating tools in default mode", () => {
    const checker = new PermissionChecker({ mode: "default" });

    const decision = checker.evaluate({
      toolName: "write_file",
      isReadOnly: false
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain("requires user confirmation");
  });

  it("allows read-only tools in plan mode", () => {
    const checker = new PermissionChecker({ mode: "plan" });

    const decision = checker.evaluate({
      toolName: "read_file",
      isReadOnly: true
    });

    expect(decision).toEqual({
      allowed: true,
      requiresConfirmation: false,
      reason: "read-only tools are allowed"
    });
  });

  it("blocks mutating tools in plan mode", () => {
    const checker = new PermissionChecker({ mode: "plan" });

    const decision = checker.evaluate({
      toolName: "bash",
      isReadOnly: false
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain("Plan mode");
  });

  it("allows mutating tools in full-auto mode", () => {
    const checker = new PermissionChecker({ mode: "full_auto" });

    const decision = checker.evaluate({
      toolName: "bash",
      isReadOnly: false
    });

    expect(decision).toEqual({
      allowed: true,
      requiresConfirmation: false,
      reason: "Auto mode allows all tools"
    });
  });

  it("uses default mode when no mode is supplied", () => {
    const checker = new PermissionChecker();

    const decision = checker.evaluate({
      toolName: "write_file",
      isReadOnly: false
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain("default mode");
  });
});

describe("sensitive paths", () => {
  it("blocks SSH key file paths in default mode", () => {
    const checker = new PermissionChecker({ mode: "default" });

    const decision = checker.evaluate({
      toolName: "write_file",
      isReadOnly: false,
      filePath: "/home/user/.ssh/id_rsa"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain("sensitive credential path");
    expect(decision.reason).toContain("*/.ssh/*");
  });

  it("blocks SSH directory roots", () => {
    const checker = new PermissionChecker({ mode: "default" });

    const decision = checker.evaluate({
      toolName: "write_file",
      isReadOnly: false,
      filePath: "/home/user/.ssh"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain("*/.ssh/*");
  });

  it("blocks sensitive paths in full-auto mode", () => {
    const checker = new PermissionChecker({ mode: "full_auto" });

    const decision = checker.evaluate({
      toolName: "bash",
      isReadOnly: false,
      filePath: "/home/user/.aws/credentials"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain("*/.aws/credentials");
  });

  it("blocks read-only tools from sensitive paths", () => {
    const checker = new PermissionChecker({ mode: "default" });

    const decision = checker.evaluate({
      toolName: "read_file",
      isReadOnly: true,
      filePath: "/home/user/.kube/config"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain("*/.kube/config");
  });

  it("blocks Windows-style SSH key paths", () => {
    const checker = new PermissionChecker({ mode: "default" });

    const decision = checker.evaluate({
      toolName: "write_file",
      isReadOnly: false,
      filePath: "C:\\Users\\me\\.ssh\\id_rsa"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain("*/.ssh/*");
  });

  it("blocks Windows-style AWS credential paths", () => {
    const checker = new PermissionChecker({ mode: "default" });

    const decision = checker.evaluate({
      toolName: "write_file",
      isReadOnly: false,
      filePath: "C:\\Users\\me\\.aws\\credentials"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain("*/.aws/credentials");
  });

  it("leaves non-sensitive paths to normal mode behavior", () => {
    const checker = new PermissionChecker({ mode: "default" });

    const decision = checker.evaluate({
      toolName: "write_file",
      isReadOnly: false,
      filePath: "/home/user/project/src/index.ts"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain("requires user confirmation");
  });

  it("skips sensitive path checks when no file path is supplied", () => {
    const checker = new PermissionChecker({ mode: "full_auto" });

    const decision = checker.evaluate({
      toolName: "bash",
      isReadOnly: false
    });

    expect(decision).toEqual({
      allowed: true,
      requiresConfirmation: false,
      reason: "Auto mode allows all tools"
    });
  });

  it("treats an empty file path like omitted file path", () => {
    const checker = new PermissionChecker({ mode: "full_auto" });

    const decision = checker.evaluate({
      toolName: "bash",
      isReadOnly: false,
      filePath: ""
    });

    expect(decision).toEqual({
      allowed: true,
      requiresConfirmation: false,
      reason: "Auto mode allows all tools"
    });
  });

  it("blocks every built-in sensitive path pattern", () => {
    const checker = new PermissionChecker({ mode: "full_auto" });
    const cases = [
      ["*/.ssh/*", "/home/user/.ssh/id_ed25519"],
      ["*/.aws/credentials", "/home/user/.aws/credentials"],
      ["*/.aws/config", "/home/user/.aws/config"],
      ["*/.config/gcloud/*", "/home/user/.config/gcloud/application_default_credentials.json"],
      ["*/.azure/*", "/home/user/.azure/accessTokens.json"],
      ["*/.gnupg/*", "/home/user/.gnupg/private-keys-v1.d/key.key"],
      ["*/.docker/config.json", "/home/user/.docker/config.json"],
      ["*/.kube/config", "/home/user/.kube/config"],
      ["*/.openharness/credentials.json", "/home/user/.openharness/credentials.json"],
      ["*/.openharness/copilot_auth.json", "/home/user/.openharness/copilot_auth.json"]
    ] as const;

    expect(cases.map(([pattern]) => pattern)).toEqual([
      ...SENSITIVE_PATH_PATTERNS
    ]);

    for (const [pattern, filePath] of cases) {
      const decision = checker.evaluate({
        toolName: "read_file",
        isReadOnly: true,
        filePath
      });

      expect(decision.allowed).toBe(false);
      expect(decision.requiresConfirmation).toBe(false);
      expect(decision.reason).toContain(pattern);
    }
  });
});
