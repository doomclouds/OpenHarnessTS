import {
  DEFAULT_PERMISSION_MODE,
  type PermissionMode
} from "./modes.js";

export const SENSITIVE_PATH_PATTERNS = [
  "*/.ssh/*",
  "*/.aws/credentials",
  "*/.aws/config",
  "*/.config/gcloud/*",
  "*/.azure/*",
  "*/.gnupg/*",
  "*/.docker/config.json",
  "*/.kube/config",
  "*/.openharness/credentials.json",
  "*/.openharness/copilot_auth.json"
] as const;

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly requiresConfirmation: boolean;
  readonly reason: string;
}

export interface PermissionCheckerOptions {
  readonly mode?: PermissionMode;
}

export interface PermissionEvaluation {
  readonly toolName: string;
  readonly isReadOnly: boolean;
  readonly filePath?: string;
}

export class PermissionChecker {
  private readonly mode: PermissionMode;

  public constructor(options: PermissionCheckerOptions = {}) {
    this.mode = options.mode ?? DEFAULT_PERMISSION_MODE;
  }

  public evaluate(input: PermissionEvaluation): PermissionDecision {
    const sensitivePattern = findSensitivePathPattern(input.filePath);
    if (sensitivePattern !== undefined) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Blocked sensitive credential path matching ${sensitivePattern}`
      };
    }

    if (this.mode === "full_auto") {
      return allow("Auto mode allows all tools");
    }

    if (input.isReadOnly) {
      return allow("read-only tools are allowed");
    }

    if (this.mode === "plan") {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: "Plan mode blocks mutating tools until the user exits plan mode"
      };
    }

    return {
      allowed: false,
      requiresConfirmation: true,
      reason:
        "This mutating tool requires user confirmation in default mode. Approve the prompt when asked."
    };
  }
}

function allow(reason: string): PermissionDecision {
  return {
    allowed: true,
    requiresConfirmation: false,
    reason
  };
}

function findSensitivePathPattern(filePath: string | undefined): string | undefined {
  if (filePath === undefined || filePath === "") {
    return undefined;
  }

  const normalizedPath = filePath.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const candidates = [normalizedPath, `${normalizedPath}/`];

  return SENSITIVE_PATH_PATTERNS.find((pattern) => {
    const patternRegExp = globToRegExp(pattern);
    return candidates.some((candidate) => patternRegExp.test(candidate));
  });
}

function globToRegExp(pattern: string): RegExp {
  const escapedSegments = pattern.split("*").map(escapeRegExp);
  return new RegExp(`^${escapedSegments.join(".*")}$`, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&");
}
