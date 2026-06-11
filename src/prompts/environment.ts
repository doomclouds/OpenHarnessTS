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
  _options: CollectEnvironmentInfoOptions = {}
): EnvironmentInfo {
  return {
    osName: "unknown",
    osVersion: "unknown",
    platformMachine: "unknown",
    shell: "unknown",
    cwd: "",
    homeDir: "",
    date: "1970-01-01",
    nodeVersion: "unknown",
    nodeExecutable: "node",
    isGitRepo: false
  };
}
