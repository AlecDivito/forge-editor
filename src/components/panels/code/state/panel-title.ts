import { WorkspaceId } from "@/lib/ws/messages";
import { PanelDescriptor } from "./editor-session.store";

function baseName(panel: PanelDescriptor): string {
  if (panel.kind === "terminal") return "terminal";
  const name = panel.fileId.split("/").pop() ?? "untitled";
  return panel.kind === "git-diff" ? `${name} (${panel.view === "staged" ? "Index" : "Working Tree"})` : name;
}

export function titleFor(
  panel: PanelDescriptor,
  allPanels: PanelDescriptor[],
  resolveWorkspaceName: (workspace: WorkspaceId) => string = (workspace) => String(workspace),
): string {
  if (panel.kind === "terminal") return `Terminal ${panel.terminalId ?? ""}`.trim();
  const name = baseName(panel);
  const collides = allPanels.some(
    (candidate) => candidate.id !== panel.id && candidate.kind !== "terminal" && baseName(candidate) === name,
  );
  return collides ? `${name} — ${resolveWorkspaceName(panel.workspace)}` : name;
}
