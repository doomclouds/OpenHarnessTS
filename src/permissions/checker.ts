import {
  DEFAULT_PERMISSION_MODE,
  type PermissionMode
} from "./modes.js";

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
