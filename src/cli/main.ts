#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./parser.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface RunCliOptions {
  readonly cwd?: string;
  readonly version?: string;
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
    "This alpha CLI only has a skeleton entry; print execution is not implemented yet.",
    ""
  ].join("\n");
}

export function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
  options: RunCliOptions = {}
): number {
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

  io.stderr("--print is parsed, but print-mode execution is not implemented yet.\n");
  return 1;
}

const entrypoint = process.argv[1];

if (
  entrypoint !== undefined &&
  resolve(entrypoint) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runCli(process.argv.slice(2));
}
