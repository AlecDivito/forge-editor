"use client";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { TerminalSession, terminalRegistry } from "./terminal.registry";
import { createTerminalTheme } from "./terminal.theme";

export function TerminalView({ session, focusToken }: { session: TerminalSession; focusToken: number }) {
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  useEffect(() => {
    if (!host.current || !session.id) return;
    const terminal = new Terminal({
      theme: createTerminalTheme(),
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      fontSize: 13,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    terminalRef.current = terminal;
    const unregister = terminalRegistry.registerView(session, {
      write: (data) => terminal.write(data),
      clear: () => terminal.clear(),
      focus: () => terminal.focus(),
    });
    const input = terminal.onData((data) => terminalRegistry.write(session, new TextEncoder().encode(data)));
    const binary = terminal.onBinary((data) =>
      terminalRegistry.write(
        session,
        Uint8Array.from(data, (c) => c.charCodeAt(0)),
      ),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          fit.fit();
          const size = `${terminal.cols}x${terminal.rows}`;
          if (size !== last) {
            last = size;
            terminalRegistry.resize(session, terminal.cols, terminal.rows);
          }
        } catch {}
      }, 60);
    });
    resize.observe(host.current);
    fit.fit();
    terminal.focus();
    return () => {
      clearTimeout(timer);
      resize.disconnect();
      unregister();
      input.dispose();
      binary.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [session.id, session.key]);
  useEffect(() => {
    terminalRef.current?.focus();
  }, [focusToken]);
  const status =
    session.status === "running"
      ? ""
      : (session.error ??
        (session.status === "exited"
          ? `Process exited${session.exit?.code != null ? ` with code ${session.exit.code}` : ""}`
          : session.status));
  return (
    <div className="relative h-full min-h-0 bg-background" aria-label={`${session.title} terminal`}>
      <div ref={host} className="h-full p-1" />
      {status && (
        <div
          className="pointer-events-none absolute right-3 top-2 rounded-md border border-border bg-muted/95 px-2 py-1 text-xs text-muted-foreground shadow-sm"
          role="status">
          {status}
        </div>
      )}
    </div>
  );
}
