export type QuickPickMode = "commands" | "symbols" | "properties" | "files";

export function quickPickMode(value: string): QuickPickMode {
  if (value.startsWith(">")) return "commands";
  if (value.startsWith("#")) return "symbols";
  if (value.startsWith("@") || value.startsWith(":")) return "properties";
  if (value.startsWith("%")) return "files";
  return "files";
}

export function quickPickQuery(value: string): string {
  return value.replace(/^[>#@:%]/, "");
}
