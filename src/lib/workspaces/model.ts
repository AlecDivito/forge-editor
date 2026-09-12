import { WorkspaceId } from "@/lib/ws/messages";

export type PublicWorkspace = { id: WorkspaceId; name: string };

export type EnvironmentSnapshot = {
  schema_version: number;
  environment: { id: string; name: string };
  workspaces: PublicWorkspace[];
  default_workspace_id: WorkspaceId;
};

export function validateEnvironmentSnapshot(value: unknown): EnvironmentSnapshot {
  const snapshot = value as Partial<EnvironmentSnapshot>;
  if (snapshot.schema_version !== 1 || !snapshot.environment || !Array.isArray(snapshot.workspaces)) {
    throw new Error("Unsupported environment response");
  }
  if (!snapshot.workspaces.length) throw new Error("This environment has no configured workspaces");

  const ids = new Set<string>();
  for (const workspace of snapshot.workspaces) {
    if (!workspace || typeof workspace.id !== "string" || !workspace.id || typeof workspace.name !== "string" || ids.has(workspace.id)) {
      throw new Error("Invalid workspace configuration received from server");
    }
    ids.add(workspace.id);
  }
  if (typeof snapshot.default_workspace_id !== "string" || !ids.has(snapshot.default_workspace_id)) {
    throw new Error("The server default workspace is unavailable");
  }
  return snapshot as EnvironmentSnapshot;
}
