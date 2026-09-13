export type GitViewMode = "tree" | "list";
export type GitChangeView = "working" | "staged";

export const gitStatusLabel = (value?: string | null) =>
  ({ M: "M", A: "A", D: "D", R: "R", C: "C", "?": "U", U: "!" })[value ?? ""] ?? value ?? "";
