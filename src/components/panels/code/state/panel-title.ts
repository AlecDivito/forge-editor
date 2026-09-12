import { WorkspaceId } from "@/lib/ws/messages";
import { PanelDescriptor } from "./editor-session.store";

function baseName(panel: PanelDescriptor): string {
  return panel.kind === "code" ? panel.fileId.split("/").pop() ?? "untitled" : "terminal";
}

export function titleFor(
  panel: PanelDescriptor,
  allPanels: PanelDescriptor[],
  resolveWorkspaceName: (workspace: WorkspaceId) => string = (workspace) => String(workspace),
): string {
  if (panel.kind === "terminal") return `Terminal ${panel.terminalId ?? ""}`.trim();
  const name = baseName(panel);
  const collides = allPanels.some(
    (candidate) => candidate.id !== panel.id && candidate.kind === "code" && baseName(candidate) === name,
  );
  return collides ? `${name} — ${resolveWorkspaceName(panel.workspace)}` : name;
}
