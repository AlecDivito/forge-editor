export function apiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_HOST;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:8080";
}

export function apiUrl(path: string): string {
  return `${apiOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function workspaceApiPath(workspaceId: string, path: string): string {
  if (!workspaceId) throw new Error("A workspace ID is required");
  return `/api/workspaces/${encodeURIComponent(workspaceId)}${path}`;
}
