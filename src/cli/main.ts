#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./parser.js";
import {
  PrintModeError,
  runPrintMode,
  type PrintModeProviderOptions
} from "./print-mode.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface RunCliOptions {
  readonly cwd?: string;
  readonly version?: string;
  readonly printMode?: PrintModeProviderOptions;
}

const defaultIo: CliIo = {
  stdout(text) {
    process.stdout.write(text);
  },
  stderr(text) {
    process.stderr.write(text);
  }
};

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as {
    readonly version?: unknown;
  };

  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}

export function renderHelp(): string {
  return [
    "OpenHarness",
    "",
    "Usage:",
    "  openharness --print <prompt>",
    "",
    "Options:",
    "  --cwd <dir>    Run from an existing working directory.",
    "  --help         Show help.",
    "  --version      Show version.",
    "",
    "This alpha CLI can run print mode only when a provider is configured.",
    ""
  ].join("\n");
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
  options: RunCliOptions = {}
): Promise<number> {
  const version = options.version ?? readPackageVersion();
  const parseOptions =
    options.cwd === undefined ? { version } : { cwd: options.cwd, version };
  const result = parseCliArgs(argv, parseOptions);

  if (result.type === "help") {
    io.stdout(renderHelp());
    return 0;
  }

  if (result.type === "version") {
    io.stdout(`OpenHarness ${result.version}\n`);
    return 0;
  }

  if (result.type === "error") {
    io.stderr(`${result.error.message}\n`);
    return 1;
  }

  if (options.printMode === undefined) {
    io.stderr(
      "--print requires provider configuration. Provider CLI setup is not available in this build.\n"
    );
    return 1;
  }

  try {
    const printResult = await runPrintMode({
      prompt: result.prompt,
      cwd: result.cwd,
      ...options.printMode
    });
    io.stdout(`${printResult.assistantText}\n`);
    return 0;
  } catch (error) {
    io.stderr(`${getPrintModeErrorMessage(error)}\n`);
    return 1;
  }
}

function getPrintModeErrorMessage(error: unknown): string {
  if (error instanceof PrintModeError || error instanceof Error) {
    return error.message;
  }

  return String(error);
}

const entrypoint = process.argv[1];

if (
  entrypoint !== undefined &&
  resolve(entrypoint) === fileURLToPath(import.meta.url)
) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${getPrintModeErrorMessage(error)}\n`);
      process.exitCode = 1;
    });
}
