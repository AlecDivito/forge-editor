import { Decoration, EditorView, gutter, GutterMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { RequestedBreakpoint, VerifiedBreakpoint } from "@/store/debug";

class BreakpointMarker extends GutterMarker {
  constructor(
    private enabled: boolean,
    private described: boolean,
    private verification?: VerifiedBreakpoint,
    private requestedLine?: number,
  ) {
    super();
  }
  toDOM() {
    const marker = document.createElement("span");
    const moved = this.verification?.resolvedLine != null && this.verification.resolvedLine !== this.requestedLine;
    const state = !this.enabled
      ? "disabled"
      : this.verification?.verified
        ? moved ? "moved" : "verified"
        : this.verification
          ? "rejected"
          : "unverified";
    marker.className = `cm-debug-breakpoint is-${state}`;
    marker.textContent = this.described ? "◆" : state === "rejected" ? "×" : "●";
    marker.setAttribute("aria-label", `${state} breakpoint${this.described ? ", conditional or logpoint" : ""}`);
    if (this.verification?.message) marker.title = this.verification.message;
    return marker;
  }
}
export function debugBreakpointGutter(
  breakpoints: RequestedBreakpoint[],
  toggle: (line: number) => void,
  currentLine?: number,
  selectedLine?: number,
  verification: VerifiedBreakpoint[] = [],
  edit?: (breakpoint: RequestedBreakpoint, field: "condition" | "hitCondition" | "logMessage") => void,
  move?: (breakpoint: RequestedBreakpoint, line: number, column?: number) => void,
): Extension {
  const byLine = new Map(breakpoints.map((b) => [b.line, b]));
  const byId = new Map(verification.map((item) => [item.requestedBreakpointId, item]));
  const execution = EditorView.decorations.compute([], (state) =>
    Decoration.set(
      [
        [currentLine, "cm-debug-current"],
        [selectedLine, "cm-debug-selected"],
      ].flatMap(([line, className]) =>
        typeof line === "number" && line >= 0 && line < state.doc.lines
          ? [Decoration.line({ class: className as string }).range(state.doc.line(line + 1).from)]
          : [],
      ),
      true,
    ),
  );
  const pendingMoves = new Map<string, ReturnType<typeof setTimeout>>();
  const livePositions = new Map(
    breakpoints.map((breakpoint) => [
      breakpoint.breakpointId,
      { line: breakpoint.line, column: breakpoint.column },
    ]),
  );
  const mapBreakpoints = EditorView.updateListener.of((update) => {
    if (!update.docChanged || !move) return;
    for (const breakpoint of breakpoints) {
      const live = livePositions.get(breakpoint.breakpointId) ?? breakpoint;
      if (live.line < 0 || live.line >= update.startState.doc.lines) continue;
      const oldLine = update.startState.doc.line(live.line + 1);
      const oldColumn = Math.min(live.column ?? 0, oldLine.length);
      const mapped = update.changes.mapPos(oldLine.from + oldColumn, 1);
      const newLine = update.state.doc.lineAt(mapped);
      const line = newLine.number - 1;
      const column = mapped - newLine.from;
      if (line === live.line && column === (live.column ?? 0)) continue;
      const nextColumn = live.column == null && column === 0 ? undefined : column;
      livePositions.set(breakpoint.breakpointId, { line, column: nextColumn });
      const existing = pendingMoves.get(breakpoint.breakpointId);
      if (existing) clearTimeout(existing);
      pendingMoves.set(
        breakpoint.breakpointId,
        setTimeout(() => {
          pendingMoves.delete(breakpoint.breakpointId);
          move(breakpoint, line, nextColumn);
        }, 300),
      );
    }
  });
  return [
    gutter({
      class: "cm-debug-gutter",
      lineMarker(view, line) {
        const number = view.state.doc.lineAt(line.from).number - 1;
        const b = byLine.get(number);
        return b ? new BreakpointMarker(b.enabled, !!(b.condition || b.hitCondition || b.logMessage), byId.get(b.breakpointId), b.line) : null;
      },
      initialSpacer: () => new BreakpointMarker(true, false),
      domEventHandlers: {
        mousedown(view, line, event) {
          event.preventDefault();
          toggle(view.state.doc.lineAt(line.from).number - 1);
          return true;
        },
        keydown(view, line, event) {
          const key = (event as KeyboardEvent).key;
          if (key !== "Enter" && key !== " ") return false;
          event.preventDefault();
          toggle(view.state.doc.lineAt(line.from).number - 1);
          return true;
        },
        contextmenu(view, line, event) {
          const number = view.state.doc.lineAt(line.from).number - 1;
          const breakpoint = byLine.get(number);
          if (!breakpoint || !edit) return false;
          event.preventDefault();
          const action = window.prompt("Edit breakpoint: condition, hit, or log", "condition");
          if (action === "condition") edit(breakpoint, "condition");
          if (action === "hit") edit(breakpoint, "hitCondition");
          if (action === "log") edit(breakpoint, "logMessage");
          return true;
        },
      },
    }),
    execution,
    mapBreakpoints,
  ];
}
