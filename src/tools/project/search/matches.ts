import { realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeProjectPath } from "../paths.js";

export interface NormalizeMatchedPathsOptions {
  readonly dropIncompleteFinalLine?: boolean;
}

export async function normalizeMatchedPaths(
  root: string,
  output: string,
  options: NormalizeMatchedPathsOptions = {}
): Promise<string[]> {
  const lines = output.split(/\r?\n/u).filter((line) => line.length > 0);

  if (
    options.dropIncompleteFinalLine === true &&
    output.length > 0 &&
    !output.endsWith("\n") &&
    !output.endsWith("\r\n")
  ) {
    lines.pop();
  }

  return await normalizeMatchedPathList(root, lines);
}

export async function normalizeMatchedPathList(
  root: string,
  paths: readonly string[]
): Promise<string[]> {
  const normalizedPaths = await Promise.all(
    paths.map((line) => normalizeMatchedPath(root, line))
  );

  return normalizedPaths
    .filter((line): line is string => line !== undefined)
    .sort();
}

export async function normalizeMatchedPath(
  root: string,
  projectPath: string
): Promise<string | undefined> {
  const normalized = normalizeProjectPath(projectPath);
  const relativePath = normalized.startsWith("./")
    ? normalized.slice(2)
    : normalized;

  if (isGitInternalPath(relativePath)) {
    return undefined;
  }

  if (!isSafeRelativeMatch(root, relativePath)) {
    return undefined;
  }

  const realMatchedPath = await realpathMatchedPath(
    path.resolve(root, relativePath)
  );
  if (realMatchedPath === undefined) {
    return undefined;
  }

  if (!isInsideRoot(root, realMatchedPath)) {
    return undefined;
  }

  return relativePath;
}

export function toTinyglobbyPattern(pattern: string): string {
  return hasPathSeparator(pattern) ? pattern : `**/${pattern}`;
}

export function isGitInternalPath(projectPath: string): boolean {
  return splitPathSegments(projectPath).some((segment) => segment === ".git");
}

export function isSafeRelativeMatch(root: string, projectPath: string): boolean {
  if (
    path.isAbsolute(projectPath) ||
    path.posix.isAbsolute(projectPath) ||
    path.win32.isAbsolute(projectPath)
  ) {
    return false;
  }

  if (splitPathSegments(projectPath).some((segment) => segment === "..")) {
    return false;
  }

  const resolvedPath = path.resolve(root, projectPath);

  return isInsideRoot(root, resolvedPath);
}

function hasPathSeparator(pattern: string): boolean {
  return /[\\/]/u.test(pattern);
}

function isInsideRoot(root: string, projectPath: string): boolean {
  const relativeToRoot = path.relative(root, projectPath);

  return (
    relativeToRoot.length === 0 ||
    (!relativeToRoot.startsWith(`..${path.sep}`) &&
      relativeToRoot !== ".." &&
      !path.isAbsolute(relativeToRoot))
  );
}

function splitPathSegments(projectPath: string): string[] {
  return projectPath.split(/[\\/]+/u).filter((segment) => segment.length > 0);
}

async function realpathMatchedPath(
  matchedPath: string
): Promise<string | undefined> {
  try {
    return await realpath(matchedPath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return undefined;
    }

    throw error;
  }
}
