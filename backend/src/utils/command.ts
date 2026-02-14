export interface ParsedCommand {
  file: string;
  args: string[];
}

export function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return defaultShellCommand();
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return defaultShellCommand();
  }

  // 在Windows上，如果指定了bash但不存在，使用默认shell
  if (process.platform === "win32" && tokens[0] === "bash") {
    return defaultShellCommand();
  }

  return {
    file: tokens[0],
    args: tokens.slice(1)
  };
}

function tokenize(value: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }

  return tokens;
}

function defaultShellCommand(): ParsedCommand {
  if (process.platform === "win32") {
    return { file: process.env.COMSPEC || "cmd.exe", args: [] };
  }

  return { file: process.env.SHELL || "/bin/bash", args: [] };
}
