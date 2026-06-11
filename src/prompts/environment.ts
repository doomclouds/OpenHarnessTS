import { execFileSync } from "node:child_process";
import {
  arch,
  homedir,
  hostname,
  platform,
  release,
  type
} from "node:os";
import { resolve } from "node:path";
import process, {
  env as processEnv,
  execPath,
  version
} from "node:process";

export interface EnvironmentInfo {
  readonly osName: string;
  readonly osVersion: string;
  readonly platformMachine: string;
  readonly shell: string;
  readonly cwd: string;
  readonly homeDir: string;
  readonly date: string;
  readonly nodeVersion: string;
  readonly nodeExecutable: string;
  readonly isGitRepo: boolean;
  readonly gitBranch?: string;
  readonly hostname?: string;
  readonly extra?: Readonly<Record<string, string>>;
}

export interface CollectEnvironmentInfoOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function formatEnvironmentSection(info: EnvironmentInfo): string {
  const lines = [
    "# Environment",
    `- OS: ${info.osName} ${info.osVersion}`,
    `- Architecture: ${info.platformMachine}`,
    `- Shell: ${info.shell}`,
    `- Working directory: ${info.cwd}`,
    `- Date: ${info.date}`,
    `- Node: ${info.nodeVersion}`,
    `- Node executable: ${info.nodeExecutable}`
  ];

  if (info.isGitRepo) {
    lines.push(
      info.gitBranch === undefined || info.gitBranch.length === 0
        ? "- Git: yes"
        : `- Git: yes (branch: ${info.gitBranch})`
    );
  }

  return lines.join("\n");
}

export function collectEnvironmentInfo(
  options: CollectEnvironmentInfoOptions = {}
): EnvironmentInfo {
  const cwd = resolve(options.cwd ?? process.cwd());
  const shell =
    options.env?.SHELL ??
    options.env?.ComSpec ??
    options.env?.COMSPEC ??
    processEnv.SHELL ??
    processEnv.ComSpec ??
    processEnv.COMSPEC ??
    "unknown";
  const gitInfo = detectGitInfo(cwd);

  return {
    osName: type(),
    osVersion: `${platform()} ${release()}`,
    platformMachine: arch(),
    shell,
    cwd,
    homeDir: homedir(),
    date: new Date().toISOString().slice(0, 10),
    nodeVersion: version,
    nodeExecutable: execPath,
    hostname: hostname(),
    extra: {
      platform: platform()
    },
    ...gitInfo
  };
}

function detectGitInfo(cwd: string): Pick<EnvironmentInfo, "isGitRepo" | "gitBranch"> {
  try {
    const isInsideWorkTree = execFileSync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }
    )
      .trim()
      .toLowerCase();

    if (isInsideWorkTree !== "true") {
      return { isGitRepo: false };
    }

    const gitBranch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();

    return {
      isGitRepo: true,
      ...(gitBranch.length > 0 ? { gitBranch } : {})
    };
  } catch {
    return { isGitRepo: false };
  }
}
