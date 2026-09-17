export type QuickPickMode = "commands" | "workspaceSymbols" | "documentSymbols" | "line" | "files";

export function quickPickMode(value: string): QuickPickMode {
  if (value.startsWith(">")) return "commands";
  if (value.startsWith("#")) return "workspaceSymbols";
  if (value.startsWith("@")) return "documentSymbols";
  if (value.startsWith(":")) return "line";
  if (value.startsWith("%")) return "files";
  return "files";
}

export interface FileQueryTarget { query: string; line?: number; column?: number }

export function parseFileQueryTarget(value: string): FileQueryTarget {
  const match = value.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (!match || match[1].length === 0) return { query: value };
  return { query: match[1], line: Number(match[2]), column: match[3] ? Number(match[3]) : 1 };
}

export function parseLineTarget(value: string): { line: number; column: number } | undefined {
  const match = value.trim().match(/^(\d+)(?::(\d+))?$/);
  if (!match) return undefined;
  return { line: Number(match[1]), column: match[2] ? Number(match[2]) : 1 };
}

export function quickPickQuery(value: string): string {
  return value.replace(/^[>#@:%]/, "");
}
