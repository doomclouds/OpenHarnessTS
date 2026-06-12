import path from "node:path";

const pathEscapeMessage = "Path escapes project cwd";

function assertInsideProject(cwd: string, target: string): void {
  const relativePath = path.relative(cwd, target);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(pathEscapeMessage);
  }
}

export function resolveProjectPath(cwd: string, candidate = "."): string {
  const projectCwd = path.resolve(cwd);
  const resolvedPath = path.resolve(projectCwd, candidate);

  assertInsideProject(projectCwd, resolvedPath);

  return resolvedPath;
}

export function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/gu, "/");
}

export function relativeProjectPath(cwd: string, projectPath: string): string {
  const projectCwd = path.resolve(cwd);
  const resolvedPath = path.resolve(projectCwd, projectPath);

  assertInsideProject(projectCwd, resolvedPath);

  const relativePath = path.relative(projectCwd, resolvedPath);

  return relativePath.length === 0 ? "." : normalizeProjectPath(relativePath);
}
