import { spawn } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";

const defaultMaxOutputBytes = 10 * 1024 * 1024;

type TerminationReason = "abort" | "output-limit" | "timeout";

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
      let terminationReason: TerminationReason | undefined;
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

      const requestTermination = (reason: TerminationReason): void => {
        terminationReason ??= reason;
        killChild();
      };

      const stdout = createOutputCollector(maxStdoutBytes, () => {
        requestTermination("output-limit");
      });
      const stderr = createOutputCollector(maxStderrBytes, () => {
        requestTermination("output-limit");
      });

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout.append(chunk);
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr.append(chunk);
      });

      const onAbort = (): void => {
        requestTermination("abort");
      };

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
            timedOut: terminationReason === "timeout",
            aborted: terminationReason === "abort",
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

        if (options.signal?.aborted === true) {
          onAbort();
        } else {
          options.signal?.addEventListener("abort", onAbort, { once: true });
        }

        if (options.timeoutMs <= 0) {
          requestTermination("timeout");
        } else {
          timeout = setTimeout(() => {
            requestTermination("timeout");
          }, options.timeoutMs);
        }
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
      const output = Buffer.concat(chunks);
      const safeOutput = truncated
        ? output.subarray(0, findUtf8SafePrefixLength(output))
        : output;

      return safeOutput.toString("utf8");
    }
  };
}

function findUtf8SafePrefixLength(buffer: Buffer): number {
  if (buffer.byteLength === 0) {
    return 0;
  }

  let sequenceStart = buffer.byteLength - 1;
  while (
    sequenceStart >= 0 &&
    (buffer[sequenceStart]! & 0b1100_0000) === 0b1000_0000
  ) {
    sequenceStart -= 1;
  }

  if (sequenceStart < 0) {
    return 0;
  }

  const sequenceLength = getUtf8SequenceLength(buffer[sequenceStart]!);
  const availableBytes = buffer.byteLength - sequenceStart;

  return availableBytes >= sequenceLength ? buffer.byteLength : sequenceStart;
}

function getUtf8SequenceLength(byte: number): number {
  if (byte < 0x80) {
    return 1;
  }

  if (byte >= 0xc2 && byte <= 0xdf) {
    return 2;
  }

  if (byte >= 0xe0 && byte <= 0xef) {
    return 3;
  }

  if (byte >= 0xf0 && byte <= 0xf4) {
    return 4;
  }

  return 1;
}
