import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "../src/cli/index.js";
import type {
  DeepSeekSdkClient,
  DeepSeekSdkOptions
} from "../src/index.js";

interface CapturedIo {
  readonly stdout: string[];
  readonly stderr: string[];
}

function createCapturedIo(): CapturedIo & {
  readonly io: {
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      stdout(text) {
        stdout.push(text);
      },
      stderr(text) {
        stderr.push(text);
      }
    }
  };
}

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

interface FakeSdkClient {
  readonly client: DeepSeekSdkClient;
  readonly requests: unknown[];
}

function createFakeSdkClient(
  turns: readonly (readonly unknown[])[]
): FakeSdkClient {
  const requests: unknown[] = [];

  return {
    requests,
    client: {
      chat: {
        completions: {
          async create(...args: readonly unknown[]) {
            requests.push(args[0]);
            const turn = turns[requests.length - 1];

            if (turn === undefined) {
              throw new Error(`No scripted SDK turn ${requests.length}.`);
            }

            return (async function* () {
              for (const chunk of turn) {
                yield chunk;
              }
            })();
          }
        }
      }
    }
  };
}

function textDeltaChunk(text: string): unknown {
  return {
    choices: [
      {
        delta: {
          content: text
        }
      }
    ]
  };
}

function toolCallChunk(args: {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}): unknown {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: args.id,
              function: {
                name: args.name,
                arguments: JSON.stringify(args.input)
              }
            }
          ]
        }
      }
    ]
  };
}

function createIsolatedCliEnv(root: string): NodeJS.ProcessEnv {
  return {
    OPENHARNESS_CONFIG_DIR: join(root, "config")
  };
}

function getSdkRequest(
  fakeSdk: FakeSdkClient,
  index = 0
): Record<string, unknown> {
  const request = fakeSdk.requests[index];

  expect(isRecord(request)).toBe(true);
  return request as Record<string, unknown>;
}

function getSystemPrompt(request: Record<string, unknown>): string {
  const messages = request["messages"];
  expect(Array.isArray(messages)).toBe(true);

  const systemMessage = (messages as readonly unknown[]).find(
    (message): message is Record<string, unknown> =>
      isRecord(message) && message["role"] === "system"
  );

  expect(systemMessage).toBeDefined();
  const content = systemMessage?.["content"];
  expect(typeof content).toBe("string");
  return content as string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("CLI parser", () => {
  it("parses help", () => {
    expect(parseCliArgs(["--help"], { version: "1.2.3" })).toEqual({
      type: "help"
    });
  });

  it("parses version", () => {
    expect(parseCliArgs(["--version"], { version: "1.2.3" })).toEqual({
      type: "version",
      version: "1.2.3"
    });
  });

  it("returns missing mode for bare invocation", () => {
    expect(parseCliArgs([], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "missing_mode",
        message:
          "No command mode selected. Use --help, --version, or --print <prompt>."
      }
    });
  });

  it("parses print prompt with the resolved default cwd", () => {
    const cwd = process.cwd();

    expect(parseCliArgs(["--print", "hello"], { cwd, version: "1.2.3" })).toEqual({
      type: "print",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        outputFormat: "text"
      }
    });
  });

  it("parses bare dry-run with the resolved default cwd", () => {
    const cwd = process.cwd();

    expect(parseCliArgs(["--dry-run"], { cwd, version: "1.2.3" })).toEqual({
      type: "dry_run",
      options: {
        cwd: resolve(cwd),
        outputFormat: "text"
      }
    });
  });

  it("parses dry-run print prompts", () => {
    const cwd = process.cwd();

    expect(
      parseCliArgs(["--dry-run", "--print", "hello"], {
        cwd,
        version: "1.2.3"
      })
    ).toEqual({
      type: "dry_run",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        outputFormat: "text"
      }
    });
  });

  it("parses dry-run after the print prompt", () => {
    const cwd = process.cwd();

    expect(
      parseCliArgs(["--print", "hello", "--dry-run"], {
        cwd,
        version: "1.2.3"
      })
    ).toMatchObject({
      type: "dry_run",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        outputFormat: "text"
      }
    });
  });

  it("defaults print output format to text", () => {
    const cwd = process.cwd();

    expect(parseCliArgs(["--print", "hello"], { cwd, version: "1.2.3" })).toMatchObject({
      type: "print",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        outputFormat: "text"
      }
    });
  });

  it("parses every supported output format", () => {
    const cwd = process.cwd();

    expect(
      parseCliArgs(["--print", "hello", "--output-format", "text"], {
        cwd,
        version: "1.2.3"
      })
    ).toMatchObject({
      type: "print",
      options: { outputFormat: "text" }
    });
    expect(
      parseCliArgs(["--print", "hello", "--output-format", "json"], {
        cwd,
        version: "1.2.3"
      })
    ).toMatchObject({
      type: "print",
      options: { outputFormat: "json" }
    });
    expect(
      parseCliArgs(["--print", "hello", "--output-format", "stream-json"], {
        cwd,
        version: "1.2.3"
      })
    ).toMatchObject({
      type: "print",
      options: { outputFormat: "stream-json" }
    });
  });

  it("parses dry-run with provider, runtime, cwd, and output flags", () => {
    const cwd = process.cwd();

    expect(
      parseCliArgs(
        [
          "--cwd",
          cwd,
          "--dry-run",
          "--print",
          "hello",
          "--model",
          "deepseek-test",
          "--api-key",
          "flag-key",
          "--base-url",
          "https://deepseek.example.com///",
          "--max-turns",
          "3",
          "--permission-mode",
          "full_auto",
          "--output-format",
          "json"
        ],
        { version: "1.2.3" }
      )
    ).toEqual({
      type: "dry_run",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        model: "deepseek-test",
        apiKey: "flag-key",
        baseURL: "https://deepseek.example.com///",
        maxTurns: 3,
        permissionMode: "full_auto",
        outputFormat: "json"
      }
    });
  });

  it("parses dry-run stream-json output", () => {
    const cwd = process.cwd();

    expect(
      parseCliArgs(["--dry-run", "--output-format", "stream-json"], {
        cwd,
        version: "1.2.3"
      })
    ).toMatchObject({
      type: "dry_run",
      options: {
        cwd: resolve(cwd),
        outputFormat: "stream-json"
      }
    });
  });

  it("parses provider and runtime flags for print mode", () => {
    const cwd = process.cwd();

    expect(
      parseCliArgs(
        [
          "--cwd",
          cwd,
          "--print",
          "hello",
          "--model",
          "deepseek-test",
          "--api-key",
          "flag-key",
          "--base-url",
          "https://deepseek.example.com///",
          "--max-turns",
          "3",
          "--permission-mode",
          "full_auto"
        ],
        { version: "1.2.3" }
      )
    ).toEqual({
      type: "print",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        model: "deepseek-test",
        apiKey: "flag-key",
        baseURL: "https://deepseek.example.com///",
        maxTurns: 3,
        permissionMode: "full_auto",
        outputFormat: "text"
      }
    });
  });

  it("parses every supported permission mode", () => {
    const cwd = process.cwd();

    expect(
      parseCliArgs(["--print", "hello", "--permission-mode", "default"], {
        cwd,
        version: "1.2.3"
      })
    ).toMatchObject({
      type: "print",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        permissionMode: "default"
      }
    });
    expect(
      parseCliArgs(["--print", "hello", "--permission-mode", "plan"], {
        cwd,
        version: "1.2.3"
      })
    ).toMatchObject({
      type: "print",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        permissionMode: "plan"
      }
    });
    expect(
      parseCliArgs(["--print", "hello", "--permission-mode", "full_auto"], {
        cwd,
        version: "1.2.3"
      })
    ).toMatchObject({
      type: "print",
      options: {
        prompt: "hello",
        cwd: resolve(cwd),
        permissionMode: "full_auto"
      }
    });
  });

  it("rejects missing dry-run print prompt", () => {
    expect(parseCliArgs(["--dry-run", "--print"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "missing_print_prompt",
        option: "--print",
        message: "--print requires a non-empty prompt value."
      }
    });
  });

  it("rejects empty dry-run print prompt", () => {
    expect(
      parseCliArgs(["--dry-run", "--print", "   "], { version: "1.2.3" })
    ).toEqual({
      type: "error",
      error: {
        code: "missing_print_prompt",
        option: "--print",
        message: "--print requires a non-empty prompt value."
      }
    });
  });

  it("rejects missing print prompt", () => {
    expect(parseCliArgs(["--print"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "missing_print_prompt",
        option: "--print",
        message: "--print requires a non-empty prompt value."
      }
    });
  });

  it("rejects empty print prompt", () => {
    expect(parseCliArgs(["--print", "   "], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "missing_print_prompt",
        option: "--print",
        message: "--print requires a non-empty prompt value."
      }
    });
  });

  it("resolves cwd to an absolute directory path", () => {
    const root = createTempDir("openharness-cli-cwd-");

    try {
      expect(
        parseCliArgs(["--cwd", root, "--print", "hello"], {
          version: "1.2.3"
        })
      ).toEqual({
        type: "print",
        options: {
          prompt: "hello",
          cwd: resolve(root),
          outputFormat: "text"
        }
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing cwd value", () => {
    expect(parseCliArgs(["--cwd"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "invalid_cwd",
        option: "--cwd",
        value: "",
        message: "--cwd requires an existing directory path."
      }
    });
  });

  it("rejects cwd values that do not exist", () => {
    const missing = join(tmpdir(), `openharness-cli-missing-${Date.now()}`);

    expect(parseCliArgs(["--cwd", missing], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "invalid_cwd",
        option: "--cwd",
        value: missing,
        message: `Invalid cwd: ${missing}. It must be an existing directory.`
      }
    });
  });

  it("rejects cwd values that point to files", () => {
    const root = createTempDir("openharness-cli-file-cwd-");
    const file = join(root, "file.txt");
    writeFileSync(file, "not a directory", "utf8");

    try {
      expect(parseCliArgs(["--cwd", file], { version: "1.2.3" })).toEqual({
        type: "error",
        error: {
          code: "invalid_cwd",
          option: "--cwd",
          value: file,
          message: `Invalid cwd: ${file}. It must be an existing directory.`
        }
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing provider flag values", () => {
    expect(parseCliArgs(["--print", "hello", "--model"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "invalid_option_value",
        option: "--model",
        value: "",
        message: "--model requires a non-empty value."
      }
    });
    expect(parseCliArgs(["--print", "hello", "--api-key"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "invalid_option_value",
        option: "--api-key",
        value: "",
        message: "--api-key requires a non-empty value."
      }
    });
    expect(parseCliArgs(["--print", "hello", "--base-url"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "invalid_option_value",
        option: "--base-url",
        value: "",
        message: "--base-url requires a non-empty value."
      }
    });
    expect(parseCliArgs(["--print", "hello", "--max-turns"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "invalid_option_value",
        option: "--max-turns",
        value: "",
        message: "--max-turns requires a non-empty value."
      }
    });
    expect(parseCliArgs(["--print", "hello", "--permission-mode"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "invalid_option_value",
        option: "--permission-mode",
        value: "",
        message: "--permission-mode requires a non-empty value."
      }
    });
  });

  it("rejects missing output format values", () => {
    expect(
      parseCliArgs(["--print", "hello", "--output-format"], {
        version: "1.2.3"
      })
    ).toEqual({
      type: "error",
      error: {
        code: "invalid_option_value",
        option: "--output-format",
        value: "",
        message: "--output-format requires a non-empty value."
      }
    });
  });

  it("rejects invalid output format values", () => {
    expect(
      parseCliArgs(["--print", "hello", "--output-format", "xml"], {
        version: "1.2.3"
      })
    ).toEqual({
      type: "error",
      error: {
        code: "invalid_option_value",
        option: "--output-format",
        value: "xml",
        message: "--output-format must be one of: text, json, stream-json."
      }
    });
  });

  it("does not add output format aliases", () => {
    expect(parseCliArgs(["--print", "hello", "--json"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "unknown_option",
        option: "--json",
        message: "Unknown option: --json"
      }
    });
    expect(
      parseCliArgs(["--print", "hello", "--stream-json"], { version: "1.2.3" })
    ).toEqual({
      type: "error",
      error: {
        code: "unknown_option",
        option: "--stream-json",
        message: "Unknown option: --stream-json"
      }
    });
  });

  it("rejects invalid max turn values", () => {
    for (const value of ["0", "-1", "1.5", "many", "9".repeat(400)]) {
      expect(
        parseCliArgs(["--print", "hello", "--max-turns", value], {
          version: "1.2.3"
        })
      ).toEqual({
        type: "error",
        error: {
          code: "invalid_option_value",
          option: "--max-turns",
          value,
          message: "--max-turns requires a positive integer value."
        }
      });
    }
  });

  it("rejects invalid permission modes", () => {
    expect(
      parseCliArgs(["--print", "hello", "--permission-mode", "auto"], {
        version: "1.2.3"
      })
    ).toEqual({
      type: "error",
      error: {
        code: "invalid_option_value",
        option: "--permission-mode",
        value: "auto",
        message: "--permission-mode must be one of: default, plan, full_auto."
      }
    });
  });

  it("rejects unknown options after print prompt", () => {
    expect(
      parseCliArgs(["--print", "hello", "--unknown-option"], {
        version: "1.2.3"
      })
    ).toEqual({
      type: "error",
      error: {
        code: "unknown_option",
        option: "--unknown-option",
        message: "Unknown option: --unknown-option"
      }
    });
  });

  it("rejects positional arguments after print prompt", () => {
    expect(parseCliArgs(["--print", "hello", "extra"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "unknown_option",
        option: "extra",
        message: "Unknown option: extra"
      }
    });
  });

  it("rejects option-like tokens as missing cwd values", () => {
    expect(parseCliArgs(["--cwd", "--print", "hello"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "invalid_cwd",
        option: "--cwd",
        value: "",
        message: "--cwd requires an existing directory path."
      }
    });
  });

  it("rejects unknown options", () => {
    expect(parseCliArgs(["--unknown-option"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "unknown_option",
        option: "--unknown-option",
        message: "Unknown option: --unknown-option"
      }
    });
  });

  it("rejects positional arguments", () => {
    expect(parseCliArgs(["hello"], { version: "1.2.3" })).toEqual({
      type: "error",
      error: {
        code: "unknown_option",
        option: "hello",
        message: "Unknown option: hello"
      }
    });
  });
});

describe("CLI runner", () => {
  it("writes help to stdout and returns success", async () => {
    const captured = createCapturedIo();

    await expect(runCli(["--help"], captured.io, { version: "1.2.3" })).resolves.toBe(0);
    expect(captured.stdout.join("")).toContain("OpenHarness");
    expect(captured.stdout.join("")).toContain("openharness --print <prompt>");
    expect(captured.stdout.join("")).toContain("--output-format <format>");
    expect(captured.stdout.join("")).toContain(
      "print mode only when a provider is configured"
    );
    expect(captured.stderr).toEqual([]);
  });

  it("writes version to stdout and returns success", async () => {
    const captured = createCapturedIo();

    await expect(runCli(["--version"], captured.io, { version: "1.2.3" })).resolves.toBe(0);
    expect(captured.stdout).toEqual(["OpenHarness 1.2.3\n"]);
    expect(captured.stderr).toEqual([]);
  });

  it("writes bare invocation errors to stderr only", async () => {
    const captured = createCapturedIo();

    await expect(runCli([], captured.io, { version: "1.2.3" })).resolves.toBe(1);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr.join("")).toContain("No command mode selected");
  });

  it("creates a DeepSeek provider from direct flags and writes assistant text to stdout", async () => {
    const root = createTempDir("openharness-cli-direct-provider-");
    const captured = createCapturedIo();
    const sdkOptions: DeepSeekSdkOptions[] = [];
    const fakeSdk = createFakeSdkClient([[textDeltaChunk("Flag text.")]]);

    try {
      const exitCode = await runCli(
        [
          "--cwd",
          root,
          "--print",
          "hello",
          "--api-key",
          "flag-key",
          "--model",
          "deepseek-test"
        ],
        captured.io,
        {
          version: "1.2.3",
          env: createIsolatedCliEnv(root),
          createSdkClient(options) {
            sdkOptions.push(options);
            return fakeSdk.client;
          }
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stdout).toEqual(["Flag text.\n"]);
      expect(captured.stderr).toEqual([]);
      expect(sdkOptions).toEqual([
        {
          apiKey: "flag-key",
          baseURL: "https://api.deepseek.com"
        }
      ]);
      expect(fakeSdk.requests).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses DEEPSEEK_API_KEY from RunCliOptions.env when no direct key is passed", async () => {
    const root = createTempDir("openharness-cli-env-provider-");
    const captured = createCapturedIo();
    const sdkOptions: DeepSeekSdkOptions[] = [];
    const fakeSdk = createFakeSdkClient([[textDeltaChunk("Env text.")]]);

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "hello"],
        captured.io,
        {
          version: "1.2.3",
          env: {
            ...createIsolatedCliEnv(root),
            DEEPSEEK_API_KEY: "env-key"
          },
          createSdkClient(options) {
            sdkOptions.push(options);
            return fakeSdk.client;
          }
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stdout).toEqual(["Env text.\n"]);
      expect(captured.stderr).toEqual([]);
      expect(sdkOptions).toEqual([
        {
          apiKey: "env-key",
          baseURL: "https://api.deepseek.com"
        }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets direct provider flags override RunCliOptions.env", async () => {
    const root = createTempDir("openharness-cli-flag-env-provider-");
    const captured = createCapturedIo();
    const sdkOptions: DeepSeekSdkOptions[] = [];
    const fakeSdk = createFakeSdkClient([[textDeltaChunk("Override text.")]]);

    try {
      const exitCode = await runCli(
        [
          "--cwd",
          root,
          "--print",
          "hello",
          "--api-key",
          "flag-key",
          "--base-url",
          "https://flag.example.com///",
          "--model",
          "flag-model"
        ],
        captured.io,
        {
          version: "1.2.3",
          env: {
            ...createIsolatedCliEnv(root),
            DEEPSEEK_API_KEY: "env-key",
            DEEPSEEK_BASE_URL: "https://env.example.com",
            DEEPSEEK_MODEL: "env-model"
          },
          createSdkClient(options) {
            sdkOptions.push(options);
            return fakeSdk.client;
          }
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stdout).toEqual(["Override text.\n"]);
      expect(captured.stderr).toEqual([]);
      expect(sdkOptions).toEqual([
        {
          apiKey: "flag-key",
          baseURL: "https://flag.example.com"
        }
      ]);
      expect(getSdkRequest(fakeSdk)).toMatchObject({
        model: "flag-model"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forwards max turns and permission mode through the direct runCli path", async () => {
    const root = createTempDir("openharness-cli-direct-runtime-flags-");
    const cwd = join(root, "fixture-project");
    const captured = createCapturedIo();
    const fakeSdk = createFakeSdkClient([
      [
        toolCallChunk({
          id: "toolu_grep",
          name: "grep",
          input: {
            pattern: "PRINT_TARGET",
            glob: "src/**/*.ts",
            headLimit: 10
          }
        })
      ]
    ]);

    try {
      mkdirSync(join(cwd, "src"), { recursive: true });
      writeFileSync(
        join(cwd, "src", "target.ts"),
        "export const PRINT_TARGET = \"cli print mode\";\n",
        "utf8"
      );

      const exitCode = await runCli(
        [
          "--cwd",
          cwd,
          "--print",
          "Find PRINT_TARGET.",
          "--api-key",
          "flag-key",
          "--max-turns",
          "1",
          "--permission-mode",
          "plan"
        ],
        captured.io,
        {
          version: "1.2.3",
          env: createIsolatedCliEnv(root),
          createSdkClient() {
            return fakeSdk.client;
          }
        }
      );

      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      expect(captured.stderr).toEqual(["Max turns exceeded: 1\n"]);
      expect(fakeSdk.requests).toHaveLength(1);
      expect(getSystemPrompt(getSdkRequest(fakeSdk))).toContain(
        "- Current mode: plan"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the stable missing key error without creating an SDK client", async () => {
    const captured = createCapturedIo();
    const sdkOptions: DeepSeekSdkOptions[] = [];

    await expect(
      runCli(["--print", "hello"], captured.io, {
        version: "1.2.3",
        env: {},
        createSdkClient(options) {
          sdkOptions.push(options);
          return createFakeSdkClient([[textDeltaChunk("unused")]]).client;
        }
      })
    ).resolves.toBe(1);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr).toEqual([
      "DEEPSEEK_API_KEY is required. Set it in the environment or pass --api-key.\n"
    ]);
    expect(sdkOptions).toEqual([]);
  });

  it("writes parser errors to stderr only", async () => {
    const captured = createCapturedIo();

    await expect(runCli(["--unknown-option"], captured.io, { version: "1.2.3" })).resolves.toBe(1);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr).toEqual(["Unknown option: --unknown-option\n"]);
  });

  it("does not create a provider for help, version, or parser errors", async () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    for (const argv of [["--help"], ["--version"], ["--unknown-option"]]) {
      const captured = createCapturedIo();

      await runCli(argv, captured.io, {
        version: "1.2.3",
        env: {
          DEEPSEEK_API_KEY: "env-key"
        },
        createSdkClient(options) {
          sdkOptions.push(options);
          return createFakeSdkClient([[textDeltaChunk("unused")]]).client;
        }
      });
    }

    expect(sdkOptions).toEqual([]);
  });

  it("runs bare dry-run without creating a provider", async () => {
    const root = createTempDir("openharness-cli-dry-run-bare-");
    const captured = createCapturedIo();
    const sdkOptions: DeepSeekSdkOptions[] = [];

    try {
      const exitCode = await runCli(["--cwd", root, "--dry-run"], captured.io, {
        version: "1.2.3",
        env: createIsolatedCliEnv(root),
        createSdkClient(options) {
          sdkOptions.push(options);
          return createFakeSdkClient([[textDeltaChunk("unused")]]).client;
        }
      });

      expect(exitCode).toBe(0);
      expect(captured.stderr).toEqual([]);
      expect(captured.stdout.join("")).toContain("OpenHarness Dry Run");
      expect(captured.stdout.join("")).toContain("interactive_session");
      expect(sdkOptions).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns blocked dry-run readiness without failing the process", async () => {
    const root = createTempDir("openharness-cli-dry-run-blocked-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--dry-run", "--print", "hello"],
        captured.io,
        {
          version: "1.2.3",
          env: createIsolatedCliEnv(root)
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stderr).toEqual([]);
      expect(captured.stdout.join("")).toContain("- level: blocked");
      expect(captured.stdout.join("")).toContain("DEEPSEEK_API_KEY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes dry-run json output", async () => {
    const root = createTempDir("openharness-cli-dry-run-json-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        [
          "--cwd",
          root,
          "--dry-run",
          "--print",
          "hello",
          "--api-key",
          "flag-key",
          "--output-format",
          "json"
        ],
        captured.io,
        {
          version: "1.2.3",
          env: createIsolatedCliEnv(root)
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stderr).toEqual([]);
      const parsed = JSON.parse(captured.stdout.join("")) as {
        readonly type: string;
        readonly mode: string;
        readonly entrypoint: { readonly kind: string };
        readonly readiness: { readonly level: string };
      };
      expect(parsed).toMatchObject({
        type: "dry_run_preview",
        mode: "dry-run",
        entrypoint: { kind: "model_prompt" },
        readiness: { level: "ready" }
      });
      expect(captured.stdout.join("")).not.toContain("flag-key");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes dry-run stream-json output as one json line", async () => {
    const root = createTempDir("openharness-cli-dry-run-stream-json-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--dry-run", "--output-format", "stream-json"],
        captured.io,
        {
          version: "1.2.3",
          env: createIsolatedCliEnv(root)
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stderr).toEqual([]);
      const lines = captured.stdout.join("").trimEnd().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        type: "dry_run_preview",
        mode: "dry-run"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not call injected print-mode during dry-run", async () => {
    const root = createTempDir("openharness-cli-dry-run-no-print-mode-");
    const captured = createCapturedIo();
    let printModeCalled = false;

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--dry-run", "--print", "hello"],
        captured.io,
        {
          version: "1.2.3",
          env: createIsolatedCliEnv(root),
          printMode: {
            apiClient: {
              async *streamMessage() {
                printModeCalled = true;
                yield {
                  type: "message_complete",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "unused" }]
                  }
                };
              }
            },
            model: "mock-model"
          }
        }
      );

      expect(exitCode).toBe(0);
      expect(printModeCalled).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("redacts the resolved API key from direct print-mode runtime errors", async () => {
    const root = createTempDir("openharness-cli-direct-redaction-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "hello", "--api-key", "flag-secret"],
        captured.io,
        {
          version: "1.2.3",
          env: createIsolatedCliEnv(root),
          createSdkClient() {
            return {
              chat: {
                completions: {
                  async create() {
                    throw new Error("request failed with flag-secret");
                  }
                }
              }
            };
          }
        }
      );

      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      expect(captured.stderr.join("")).toContain("[REDACTED]");
      expect(captured.stderr.join("")).not.toContain("flag-secret");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("redacts the resolved API key from direct json runtime errors", async () => {
    const root = createTempDir("openharness-cli-direct-json-redaction-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        [
          "--cwd",
          root,
          "--print",
          "hello",
          "--api-key",
          "flag-secret",
          "--output-format",
          "json"
        ],
        captured.io,
        {
          version: "1.2.3",
          env: createIsolatedCliEnv(root),
          createSdkClient() {
            return {
              chat: {
                completions: {
                  async create() {
                    throw new Error("request failed with flag-secret");
                  }
                }
              }
            };
          }
        }
      );

      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      const error = JSON.parse(captured.stderr.join("")) as { readonly message: string };
      expect(error).toEqual({
        type: "error",
        outputFormat: "json",
        message: "API error: request failed with [REDACTED]"
      });
      expect(error.message).not.toContain("flag-secret");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps injected print-mode path working without a DeepSeek API key", async () => {
    const root = createTempDir("openharness-cli-injected-provider-");
    const captured = createCapturedIo();

    try {
      await expect(
        runCli(["--cwd", root, "--print", "hello"], captured.io, {
          version: "1.2.3",
          env: {},
          printMode: {
            apiClient: {
              async *streamMessage() {
                yield {
                  type: "message_complete",
                  message: {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: "Injected text."
                      }
                    ]
                  }
                };
              }
            },
            model: "mock-model",
            env: createIsolatedCliEnv(root)
          }
        })
      ).resolves.toBe(0);
      expect(captured.stdout).toEqual(["Injected text.\n"]);
      expect(captured.stderr).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("CLI package metadata", () => {
  it("exposes the openharness bin target", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      bin?: Record<string, string>;
    };

    expect(packageJson.bin?.openharness).toBe("./dist/cli/main.js");
  });

  it("does not expose the oh alias in this slice", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      bin?: Record<string, string>;
    };

    expect(packageJson.bin?.oh).toBeUndefined();
  });
});
