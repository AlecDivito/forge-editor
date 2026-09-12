import type { EditorView } from "@codemirror/view";

const editorInstances = new Map<string, EditorView>();
const waiters = new Map<string, Set<(view: EditorView) => void>>();

export function registerEditorInstance(panelId: string, view: EditorView): () => void {
  editorInstances.set(panelId, view);
  waiters.get(panelId)?.forEach((resolve) => resolve(view));
  waiters.delete(panelId);
  return () => {
    if (editorInstances.get(panelId) === view) editorInstances.delete(panelId);
  };
}

export function waitForEditorInstance(
  panelId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<EditorView> {
  const existing = editorInstances.get(panelId);
  if (existing) return Promise.resolve(existing);
  const { signal, timeoutMs = 5_000 } = options;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const entries = waiters.get(panelId);
      entries?.delete(ready);
      if (entries?.size === 0) waiters.delete(panelId);
    };
    const ready = (view: EditorView) => { cleanup(); resolve(view); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException("Navigation aborted", "AbortError")); };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error(`Editor '${panelId}' did not mount in time`)); }, timeoutMs);
    const entries = waiters.get(panelId) ?? new Set();
    entries.add(ready);
    waiters.set(panelId, entries);
  });
}

export function getEditorInstance(panelId: string): EditorView | undefined {
  return editorInstances.get(panelId);
}
