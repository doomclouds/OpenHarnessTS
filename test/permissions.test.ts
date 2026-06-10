import { describe, expect, it } from "vitest";
import { PermissionChecker } from "../src/permissions/index.js";

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
