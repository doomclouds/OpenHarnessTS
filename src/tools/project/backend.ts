import { spawn } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";

export interface RipgrepBackendRunOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface RipgrepBackendResult {
  readonly backend: "ripgrep";
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
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
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;

      const child = spawn(rgPath, [...args], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      const killChild = (): void => {
        if (!child.killed) {
          child.kill();
        }
      };

      const onAbort = (): void => {
        timedOut = true;
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
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
            exitCode,
            signal,
            timedOut,
            durationMs: Date.now() - startedAt
          });
        };

        child.on("error", (error) => {
          stderrChunks.push(Buffer.from(error.message));
          finish(null, null);
        });

        child.on("close", finish);
      });
    }
  };
}
