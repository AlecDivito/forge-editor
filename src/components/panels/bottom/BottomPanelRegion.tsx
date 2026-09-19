"use client";

import { IGridviewPanelProps } from "dockview-react";
import { ChevronsDown, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { selectedWorkspace, useWorkspaceStore } from "@/lib/workspaces";
import { LspDiagnostic } from "@/lib/ws/messages";
import { useDiagnosticsStore } from "../code/state/diagnostics.store";
import { useLspRuntimeStore } from "@/store/lsp-runtime";
import TerminalRegion from "../terminal/TerminalRegion";

export const bottomPanelSelectEvent = "forge:select-bottom-panel";

type BottomTab = "problems" | "output" | "debug-console" | "terminal";

const tabs: { id: BottomTab; label: string }[] = [
  { id: "problems", label: "Problems" },
  { id: "output", label: "Output" },
  { id: "debug-console", label: "Debug Console" },
  { id: "terminal", label: "Terminal" },
];

export default function BottomPanelRegion({ api }: IGridviewPanelProps) {
  const [activeTab, setActiveTab] = useState<BottomTab>("problems");

  useEffect(() => {
    const select = (event: Event) => {
      const tab = (event as CustomEvent<BottomTab>).detail;
      if (tabs.some(({ id }) => id === tab)) setActiveTab(tab);
    };
    window.addEventListener(bottomPanelSelectEvent, select);
    return () => window.removeEventListener(bottomPanelSelectEvent, select);
  }, []);

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground" aria-label="Bottom panel">
      <header className="flex h-9 shrink-0 items-center border-b border-border bg-card">
        <div className="flex h-full min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Bottom panel views">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`bottom-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`bottom-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`border-r border-border px-3 text-xs transition-colors ${activeTab === tab.id ? "border-t-2 border-t-primary bg-background text-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}>
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          title="Hide panel"
          aria-label="Hide panel"
          onClick={() => api.setVisible(false)}
          className="mr-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
          <ChevronsDown size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {activeTab === "problems" && <ProblemsPanel />}
        {activeTab === "output" && <OutputPanel />}
        {activeTab === "debug-console" && <DebugConsolePanel />}
        {activeTab === "terminal" && <TerminalRegion onHide={() => api.setVisible(false)} />}
      </div>
    </section>
  );
}

function ProblemsPanel() {
  const workspace = useWorkspaceStore(selectedWorkspace);
  const byDocument = useDiagnosticsStore((state) => state.byDocument);
  const problems = useMemo(() => {
    if (!workspace) return [];
    return Object.entries(byDocument)
      .filter(([key]) => key.startsWith(`${workspace.id}:`))
      .flatMap(([key, diagnostics]) => {
        const file = key.slice(workspace.id.length + 1);
        return diagnostics.map((diagnostic) => ({ file, diagnostic }));
      });
  }, [byDocument, workspace]);

  return (
    <PanelBody id="problems">
      {problems.length === 0 ? (
        <EmptyState>No problems have been reported.</EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {problems.map(({ file, diagnostic }, index) => (
            <Problem key={`${file}:${index}`} file={file} diagnostic={diagnostic} />
          ))}
        </ul>
      )}
    </PanelBody>
  );
}

function Problem({ file, diagnostic }: { file: string; diagnostic: LspDiagnostic }) {
  const level = diagnostic.severity === 1 ? "Error" : diagnostic.severity === 2 ? "Warning" : "Info";
  return (
    <li className="flex gap-3 px-3 py-2 text-xs">
      <span className={diagnostic.severity === 1 ? "text-destructive" : diagnostic.severity === 2 ? "text-amber-500" : "text-muted-foreground"}>{level}</span>
      <div className="min-w-0">
        <p>{diagnostic.message}</p>
        <p className="mt-0.5 text-muted-foreground">{file}:{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}</p>
      </div>
    </li>
  );
}

function OutputPanel() {
  const notices = useLspRuntimeStore((state) => state.notices);
  const output = useLspRuntimeStore((state) => state.output);
  const clearOutput = useLspRuntimeStore((state) => state.clearOutput);
  const entries = useMemo(
    () => [
      ...notices.map((notice) => ({ ...notice, text: notice.message })),
      ...output.map((item) => ({ ...item, text: formatOutput(item.method, item.params) })),
    ].sort((a, b) => a.at - b.at),
    [notices, output],
  );
  return (
    <PanelBody id="output" toolbar={<PanelTool label="Clear output" onClick={clearOutput}><Trash2 size={14} /></PanelTool>}>
      {entries.length === 0 ? (
        <EmptyState>Language server and tool output will appear here.</EmptyState>
      ) : (
        <ol className="divide-y divide-border font-mono text-xs">
          {entries.map((entry, index) => (
            <li key={`${entry.at}:${index}`} className="px-3 py-2">
              <span className="mr-2 text-muted-foreground">{new Date(entry.at).toLocaleTimeString()}</span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </PanelBody>
  );
}

function DebugConsolePanel() {
  return <PanelBody id="debug-console"><EmptyState>Start a debug session to see debug output here.</EmptyState></PanelBody>;
}

function PanelBody({ id, toolbar, children }: { id: BottomTab; toolbar?: React.ReactNode; children: React.ReactNode }) {
  return <div id={`bottom-panel-${id}`} role="tabpanel" aria-labelledby={`bottom-tab-${id}`} className="h-full overflow-auto">{toolbar && <div className="flex h-8 items-center justify-end border-b border-border px-2">{toolbar}</div>}{children}</div>;
}

function PanelTool({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">{children}</button>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center px-4 text-center text-sm text-muted-foreground">{children}</div>;
}

function formatOutput(method: string, params: unknown) {
  if (params === undefined || params === null) return method;
  if (typeof params === "string") return `${method}: ${params}`;
  try {
    return `${method}: ${JSON.stringify(params)}`;
  } catch {
    return method;
  }
}
