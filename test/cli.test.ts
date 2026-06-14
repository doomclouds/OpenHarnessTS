import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "../src/cli/index.js";

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
        cwd: resolve(cwd)
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
        permissionMode: "full_auto"
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
          cwd: resolve(root)
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

  it("keeps future output format flags unknown", () => {
    expect(
      parseCliArgs(["--print", "hello", "--output-format", "json"], {
        version: "1.2.3"
      })
    ).toEqual({
      type: "error",
      error: {
        code: "unknown_option",
        option: "--output-format",
        message: "Unknown option: --output-format"
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

  it("writes unconfigured print provider errors to stderr only", async () => {
    const captured = createCapturedIo();

    await expect(runCli(["--print", "hello"], captured.io, { version: "1.2.3" })).resolves.toBe(1);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr).toEqual([
      "--print requires provider configuration. Provider CLI setup is not available in this build.\n"
    ]);
  });

  it("writes parser errors to stderr only", async () => {
    const captured = createCapturedIo();

    await expect(runCli(["--unknown-option"], captured.io, { version: "1.2.3" })).resolves.toBe(1);
    expect(captured.stdout).toEqual([]);
    expect(captured.stderr).toEqual(["Unknown option: --unknown-option\n"]);
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
