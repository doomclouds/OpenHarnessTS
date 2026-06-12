import {
  existsSync,
  readdirSync,
  statSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ProjectInstructionKind =
  | "agents"
  | "claude"
  | "claude_project"
  | "claude_rule";

export interface ProjectInstructionFile {
  readonly path: string;
  readonly kind: ProjectInstructionKind;
  readonly directory: string;
  readonly order: number;
}

export interface LoadedProjectInstruction extends ProjectInstructionFile {
  readonly content: string;
  readonly originalCharCount: number;
  readonly loadedCharCount: number;
  readonly truncated: boolean;
}

export interface ProjectInstructions {
  readonly cwd: string;
  readonly files: readonly LoadedProjectInstruction[];
  readonly section: string;
}

export interface DiscoverProjectInstructionsOptions {
  readonly stopAt?: string | URL;
}

export interface LoadProjectInstructionsOptions
  extends DiscoverProjectInstructionsOptions {
  readonly maxCharsPerFile?: number;
}

export function discoverProjectInstructions(
  cwd: string | URL,
  options: DiscoverProjectInstructionsOptions = {}
): readonly ProjectInstructionFile[] {
  const resolvedCwd = resolvePathInput(cwd, "cwd");
  const stopAt =
    options.stopAt === undefined
      ? undefined
      : resolvePathInput(options.stopAt, "stopAt");

  if (stopAt !== undefined && !isInsideOrSamePath(resolvedCwd, stopAt)) {
    throw new Error("cwd must be inside stopAt.");
  }

  const files: ProjectInstructionFile[] = [];
  const seen = new Set<string>();
  let current = resolvedCwd;

  while (true) {
    appendCandidate(files, seen, {
      path: join(current, "AGENTS.md"),
      kind: "agents",
      directory: current
    });
    appendCandidate(files, seen, {
      path: join(current, "CLAUDE.md"),
      kind: "claude",
      directory: current
    });
    appendCandidate(files, seen, {
      path: join(current, ".claude", "CLAUDE.md"),
      kind: "claude_project",
      directory: join(current, ".claude")
    });

    const rulesDirectory = join(current, ".claude", "rules");
    for (const fileName of sortedMarkdownFiles(rulesDirectory)) {
      appendCandidate(files, seen, {
        path: join(rulesDirectory, fileName),
        kind: "claude_rule",
        directory: rulesDirectory
      });
    }

    if (stopAt !== undefined && samePath(current, stopAt)) {
      break;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return files.map((file, order) => ({ ...file, order }));
}

function appendCandidate(
  files: ProjectInstructionFile[],
  seen: Set<string>,
  candidate: Omit<ProjectInstructionFile, "order">
): void {
  const candidatePath = resolve(candidate.path);
  if (!isFile(candidatePath)) {
    return;
  }

  const key = pathKey(candidatePath);
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  files.push({
    ...candidate,
    path: candidatePath,
    directory: resolve(candidate.directory),
    order: files.length
  });
}

function sortedMarkdownFiles(directory: string): readonly string[] {
  if (!isDirectory(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort(comparePathNames);
}

function resolvePathInput(value: string | URL, label: "cwd" | "stopAt"): string {
  if (value instanceof URL) {
    if (value.protocol !== "file:") {
      throw new Error(`${label} URL must use the file: protocol.`);
    }

    return resolve(fileURLToPath(value));
  }

  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty path.`);
  }

  return resolve(value);
}

function isInsideOrSamePath(child: string, parent: string): boolean {
  if (samePath(child, parent)) {
    return true;
  }

  const relativePath = relative(parent, child);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function pathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function comparePathNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
