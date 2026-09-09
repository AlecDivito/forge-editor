import { socket } from "@/lib/ws/connection";
import { WorkspaceId, FileId, LspMethodMap } from "@/lib/ws/messages";

interface Pending {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

const pending = new Map<string, Pending>();
let listening = false;

/** One subscription for the whole app — not one per request, not one per document. */
function ensureListening() {
  if (listening) return;
  listening = true;
  socket.subscribe((msg: any) => {
    const entry = pending.get(msg.request_id);
    if (!entry) return; // not an LSP response, or already timed out
    if (msg.kind === "LspResponse") {
      entry.resolve(msg.result);
      pending.delete(msg.request_id);
    } else if (msg.kind === "LspError") {
      entry.reject(new Error(msg.message));
      pending.delete(msg.request_id);
    }
  });
}

// Matches the backend's own 10s LSP request timeout — no point waiting
// longer here than the server already gave up.
const TIMEOUT_MS = 10_000;

export function sendLspRequest<K extends keyof LspMethodMap>(
  workspaceId: WorkspaceId,
  fileId: FileId,
  method: K,
  params: LspMethodMap[K]["params"],
): Promise<LspMethodMap[K]["result"]> {
  ensureListening();
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`LSP request '${method}' timed out on the frontend`));
    }, TIMEOUT_MS);

    pending.set(requestId, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });

    socket.send({
      kind: "LspRequest",
      workspace_id: workspaceId,
      file_id: fileId,
      request_id: requestId,
      method,
      params,
    } as any); // `as any`: TS can't narrow a generic M against the ClientMessage
               // union here — the real type safety is enforced at call sites,
               // since callers pick a literal method and get matching params/result.
  });
}

export function sendLspNotification(workspaceId: WorkspaceId, fileId: FileId, method: string, params: unknown) {
  socket.send({ kind: "LspNotification", workspace_id: workspaceId, file_id: fileId, method, params });
}