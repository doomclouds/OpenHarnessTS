import type { RipgrepBackendResult } from "../backend.js";

export function isRipgrepBackendCannotRun(
  result: RipgrepBackendResult
): boolean {
  const stderr = result.stderr.trim();

  return (
    result.exitCode === null &&
    result.signal === null &&
    !result.timedOut &&
    !result.aborted &&
    result.stdout.length === 0 &&
    !result.stdoutTruncated &&
    !result.stderrTruncated &&
    isSpawnLikeRipgrepFailure(stderr)
  );
}

function isSpawnLikeRipgrepFailure(stderr: string): boolean {
  return /^spawn\b/u.test(stderr);
}
