"use client";

import { useLspRuntimeStore } from "@/store/lsp-runtime";

export function LspNotifications() {
  const notices = useLspRuntimeStore((state) => state.notices);
  const latest = notices.at(-1);
  if (!latest) return null;
  return <div
    className="fixed bottom-4 right-4 z-50 max-w-md rounded border bg-background px-4 py-3 shadow-lg"
    role={latest.severity === 1 ? "alert" : "status"}
    aria-live={latest.severity === 1 ? "assertive" : "polite"}
  >{latest.message}</div>;
}
