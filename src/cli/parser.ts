import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export interface ParseCliArgsOptions {
  readonly cwd?: string;
  readonly version?: string;
}

export type CliParseErrorCode =
  | "missing_mode"
  | "missing_print_prompt"
  | "invalid_cwd"
  | "unknown_option";

export interface CliParseError {
  readonly code: CliParseErrorCode;
  readonly message: string;
  readonly option?: string;
  readonly value?: string;
}

export type CliParseResult =
  | { readonly type: "help" }
  | { readonly type: "version"; readonly version: string }
  | { readonly type: "print"; readonly prompt: string; readonly cwd: string }
  | { readonly type: "error"; readonly error: CliParseError };

function missingPrintPrompt(): CliParseResult {
  return {
    type: "error",
    error: {
      code: "missing_print_prompt",
      option: "--print",
      message: "--print requires a non-empty prompt value."
    }
  };
}

function invalidCwd(value: string): CliParseResult {
  if (value.length === 0) {
    return {
      type: "error",
      error: {
        code: "invalid_cwd",
        option: "--cwd",
        value,
        message: "--cwd requires an existing directory path."
      }
    };
  }

  return {
    type: "error",
    error: {
      code: "invalid_cwd",
      option: "--cwd",
      value,
      message: `Invalid cwd: ${value}. It must be an existing directory.`
    }
  };
}

function unknownOption(option: string): CliParseResult {
  return {
    type: "error",
    error: {
      code: "unknown_option",
      option,
      message: `Unknown option: ${option}`
    }
  };
}

function isExistingDirectory(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function parseCliArgs(
  args: readonly string[],
  options: ParseCliArgsOptions = {}
): CliParseResult {
  let cwd = resolve(options.cwd ?? process.cwd());
  let printPrompt: string | undefined;

  if (args.length === 0) {
    return {
      type: "error",
      error: {
        code: "missing_mode",
        message:
          "No command mode selected. Use --help, --version, or --print <prompt>."
      }
    };
  }

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === undefined) {
      continue;
    }

    if (token === "--help") {
      return { type: "help" };
    }

    if (token === "--version") {
      return { type: "version", version: options.version ?? "0.0.0" };
    }

    if (token === "--cwd") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return invalidCwd("");
      }

      if (!isExistingDirectory(value)) {
        return invalidCwd(value);
      }

      cwd = resolve(value);
      index += 1;
      continue;
    }

    if (token === "--print") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return missingPrintPrompt();
      }

      const prompt = value.trim();

      if (prompt.length === 0) {
        return missingPrintPrompt();
      }

      printPrompt = prompt;
      index += 1;
      continue;
    }

    return unknownOption(token);
  }

  if (printPrompt !== undefined) {
    return { type: "print", prompt: printPrompt, cwd };
  }

  return {
    type: "error",
    error: {
      code: "missing_mode",
      message:
        "No command mode selected. Use --help, --version, or --print <prompt>."
    }
  };
}
