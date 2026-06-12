import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_DIR = ".openharness";
const CONFIG_FILE_NAME = "settings.json";

type Env = Readonly<Record<string, string | undefined>>;

export interface OpenHarnessPaths {
  readonly configDir: string;
  readonly configFile: string;
  readonly dataDir: string;
  readonly logsDir: string;
  readonly sessionsDir: string;
}

export interface ProjectPaths {
  readonly cwd: string;
  readonly projectConfigDir: string;
  readonly issueFile: string;
  readonly prCommentsFile: string;
  readonly activeRepoContextFile: string;
  readonly sessionDir: string;
}

export interface ResolveOpenHarnessPathsOptions {
  readonly env?: Env;
  readonly homeDir?: string;
}

export interface ResolveProjectPathsOptions
  extends ResolveOpenHarnessPathsOptions {}

export function resolveOpenHarnessPaths(
  options: ResolveOpenHarnessPathsOptions = {}
): OpenHarnessPaths {
  const configDir = resolvePath(
    getPathFromEnv(options.env, "OPENHARNESS_CONFIG_DIR") ??
      join(getHomeDir(options), DEFAULT_BASE_DIR),
    options
  );
  const dataDir = resolvePath(
    getPathFromEnv(options.env, "OPENHARNESS_DATA_DIR") ??
      join(configDir, "data"),
    options
  );
  const logsDir = resolvePath(
    getPathFromEnv(options.env, "OPENHARNESS_LOGS_DIR") ??
      join(configDir, "logs"),
    options
  );

  return {
    configDir,
    configFile: join(configDir, CONFIG_FILE_NAME),
    dataDir,
    logsDir,
    sessionsDir: join(dataDir, "sessions")
  };
}

export function ensureOpenHarnessPaths(
  options: ResolveOpenHarnessPathsOptions = {}
): OpenHarnessPaths {
  const paths = resolveOpenHarnessPaths(options);

  for (const directory of [
    paths.configDir,
    paths.dataDir,
    paths.logsDir,
    paths.sessionsDir
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  return paths;
}

export function resolveProjectPaths(
  cwd: string | URL,
  options: ResolveProjectPathsOptions = {}
): ProjectPaths {
  const resolvedCwd = resolveCwd(cwd, options);
  const projectConfigDir = join(resolvedCwd, DEFAULT_BASE_DIR);

  return {
    cwd: resolvedCwd,
    projectConfigDir,
    issueFile: join(projectConfigDir, "issue.md"),
    prCommentsFile: join(projectConfigDir, "pr_comments.md"),
    activeRepoContextFile: join(
      projectConfigDir,
      "autopilot",
      "active_repo_context.md"
    ),
    sessionDir: getProjectSessionDir(resolvedCwd, options)
  };
}

export function ensureProjectPaths(
  cwd: string | URL,
  options: ResolveProjectPathsOptions = {}
): ProjectPaths {
  ensureOpenHarnessPaths(options);
  const paths = resolveProjectPaths(cwd, options);

  mkdirSync(paths.projectConfigDir, { recursive: true });
  mkdirSync(paths.sessionDir, { recursive: true });

  return paths;
}

export function getProjectSessionDir(
  cwd: string | URL,
  options: ResolveOpenHarnessPathsOptions = {}
): string {
  const resolvedCwd = resolveCwd(cwd, options);
  const projectName = basename(resolvedCwd) || "project";
  const digest = createHash("sha1")
    .update(resolvedCwd)
    .digest("hex")
    .slice(0, 12);
  const { sessionsDir } = resolveOpenHarnessPaths(options);

  return join(sessionsDir, `${projectName}-${digest}`);
}

function resolveCwd(
  cwd: string | URL,
  options: ResolveOpenHarnessPathsOptions
): string {
  if (cwd instanceof URL) {
    if (cwd.protocol !== "file:") {
      throw new Error("cwd URL must use the file: protocol.");
    }

    return resolve(fileURLToPath(cwd));
  }

  assertNonEmptyPath(cwd, "cwd must be a non-empty path.");
  return resolvePath(cwd, options);
}

function resolvePath(
  value: string,
  options: ResolveOpenHarnessPathsOptions
): string {
  return resolve(expandHomePath(value, getHomeDir(options)));
}

function expandHomePath(value: string, homeDir: string): string {
  if (value === "~") {
    return homeDir;
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homeDir, value.slice(2));
  }

  return value;
}

function getHomeDir(options: ResolveOpenHarnessPathsOptions): string {
  const value = options.homeDir ?? homedir();

  assertNonEmptyPath(value, "homeDir must be a non-empty path.");
  return resolve(value);
}

function getPathFromEnv(env: Env | undefined, key: string): string | undefined {
  const source = env ?? process.env;
  const value = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty path when set.`);
  }

  return value;
}

function assertNonEmptyPath(value: string, message: string): void {
  if (value.trim().length === 0) {
    throw new Error(message);
  }
}
