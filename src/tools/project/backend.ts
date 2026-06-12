import { spawn } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";

const defaultMaxOutputBytes = 10 * 1024 * 1024;

export interface RipgrepBackendRunOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
}

export interface RipgrepBackendResult {
  readonly backend: "ripgrep";
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
}

export interface RipgrepBackend {
  run(
    args: readonly string[],
    options: RipgrepBackendRunOptions
  ): Promise<RipgrepBackendResult>;
}

export function createRipgrepBackend(): RipgrepBackend {
  return {
    run(args, options) {
      const startedAt = Date.now();
      let timedOut = false;
      let aborted = false;
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      const maxStdoutBytes = normalizeMaxBytes(options.maxStdoutBytes);
      const maxStderrBytes = normalizeMaxBytes(options.maxStderrBytes);

      const child = spawn(rgPath, [...args], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });

      const killChild = (): void => {
        if (!child.killed) {
          child.kill();
        }
      };

      const stdout = createOutputCollector(maxStdoutBytes, () => {
        killChild();
      });
      const stderr = createOutputCollector(maxStderrBytes, () => {
        killChild();
      });

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout.append(chunk);
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr.append(chunk);
      });

      const onAbort = (): void => {
        aborted = true;
        killChild();
      };

      if (options.signal?.aborted === true) {
        onAbort();
      } else {
        options.signal?.addEventListener("abort", onAbort, { once: true });
      }

      timeout = setTimeout(() => {
        timedOut = true;
        killChild();
      }, options.timeoutMs);

      return new Promise<RipgrepBackendResult>((resolve) => {
        const finish = (
          exitCode: number | null,
          signal: NodeJS.Signals | null
        ): void => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", onAbort);

          resolve({
            backend: "ripgrep",
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode,
            signal,
            timedOut,
            aborted,
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
            durationMs: Date.now() - startedAt
          });
        };

        child.on("error", (error) => {
          stderr.append(Buffer.from(error.message));
          finish(null, null);
        });

        child.on("close", finish);
      });
    }
  };
}

function normalizeMaxBytes(maxBytes: number | undefined): number {
  return Math.max(0, maxBytes ?? defaultMaxOutputBytes);
}

function createOutputCollector(
  maxBytes: number,
  onTruncated: () => void
): {
  readonly truncated: boolean;
  append(chunk: Buffer | string): void;
  toString(): string;
} {
  const chunks: Buffer[] = [];
  let collectedBytes = 0;
  let truncated = false;

  return {
    get truncated() {
      return truncated;
    },

    append(chunk) {
      if (truncated) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remainingBytes = maxBytes - collectedBytes;

      if (buffer.byteLength <= remainingBytes) {
        chunks.push(buffer);
        collectedBytes += buffer.byteLength;
        return;
      }

      if (remainingBytes > 0) {
        chunks.push(buffer.subarray(0, remainingBytes));
        collectedBytes += remainingBytes;
      }

      truncated = true;
      onTruncated();
    },

    toString() {
      return Buffer.concat(chunks).toString("utf8");
    }
  };
}
