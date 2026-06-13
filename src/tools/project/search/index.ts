export {
  createFallbackAbortSignal,
  throwIfAbortedOrTimedOut,
  waitForFallbackOperation
} from "./fallback.js";
export type { FallbackAbortSignal } from "./fallback.js";
export {
  getGitInternalIgnoreGlobs,
  gitInternalGlobExcludes,
  isInsideGitRepository
} from "./git.js";
export {
  isGitInternalPath,
  isSafeRelativeMatch,
  normalizeMatchedPath,
  normalizeMatchedPathList,
  normalizeMatchedPaths,
  toTinyglobbyPattern
} from "./matches.js";
export { isRipgrepBackendCannotRun } from "./ripgrep.js";
export type { NormalizeMatchedPathsOptions } from "./matches.js";
