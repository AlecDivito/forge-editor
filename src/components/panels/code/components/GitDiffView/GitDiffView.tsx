"use client";

import CodeMirror from "@uiw/react-codemirror";
import { EditorView, Decoration, DecorationSet, lineNumbers } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { diffLines } from "diff";
import { IDockviewPanelProps } from "dockview";
import { useRef } from "react";
import { GitDiffPanelDescriptor } from "../../state/editor-session.store";
import { languageForFile } from "../CodeView/extensions/language.extension";
import useGitDiff from "@/components/panels/filesystem/components/git/hooks/use-git-diff.hook";

export default function GitDiffView({ params }: IDockviewPanelProps<GitDiffPanelDescriptor>) {
  const leftView = useRef<EditorView | null>(null);
  const rightView = useRef<EditorView | null>(null);
  const syncing = useRef(false);
  const query = useGitDiff(params.workspace, params.fileId, params.view);
  if (query.isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading diff…</div>;
  if (query.error) return <div className="p-4 text-sm text-red-400">{query.error.message}</div>;
  if (!query.data) return null;
  const aligned = buildAlignedDiff(query.data.before, query.data.after);
  const synchronize = (source: EditorView, target: EditorView | null) => {
    if (!target || syncing.current) return;
    syncing.current = true;
    const maxSource = source.scrollDOM.scrollHeight - source.scrollDOM.clientHeight;
    const maxTarget = target.scrollDOM.scrollHeight - target.scrollDOM.clientHeight;
    target.scrollDOM.scrollTop = maxSource > 0 ? (source.scrollDOM.scrollTop / maxSource) * Math.max(0, maxTarget) : 0;
    target.scrollDOM.scrollLeft = source.scrollDOM.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };
  return (
    <div className="grid h-full min-h-0 grid-cols-2 divide-x overflow-hidden">
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="border-b px-3 py-1 text-xs text-muted-foreground">Before</header>
        <CodeMirror
          value={aligned.before.text}
          extensions={[...languageForFile(params.fileId), ...extensionsForSide(aligned.before, "before")]}
          onCreateEditor={(view) => {
            leftView.current = view;
            view.scrollDOM.addEventListener("scroll", () => synchronize(view, rightView.current));
          }}
          editable={false}
          readOnly
          height="100%"
          className="min-h-0 flex-1 overflow-auto"
          basicSetup={{ highlightActiveLine: false, lineNumbers: false }}
        />
      </section>
      <section className="flex min-h-0 min-w-0 flex-col">
        <header className="border-b px-3 py-1 text-xs text-muted-foreground">After</header>
        <CodeMirror
          value={aligned.after.text}
          extensions={[...languageForFile(params.fileId), ...extensionsForSide(aligned.after, "after")]}
          onCreateEditor={(view) => {
            rightView.current = view;
            view.scrollDOM.addEventListener("scroll", () => synchronize(view, leftView.current));
          }}
          editable={false}
          readOnly
          height="100%"
          className="min-h-0 flex-1 overflow-auto"
          basicSetup={{ highlightActiveLine: false, lineNumbers: false }}
        />
      </section>
    </div>
  );
}

function lineDecorations(lines: Set<number>, className: string): Extension {
  return EditorView.decorations.compute(["doc"], (state) => {
    const ranges = [...lines]
      .filter((line) => line > 0 && line <= state.doc.lines)
      .map((line) => Decoration.line({ class: className }).range(state.doc.line(line).from));
    return Decoration.set(ranges, true) as DecorationSet;
  });
}

interface AlignedSide {
  text: string;
  lineNumbers: Array<number | null>;
  changed: Set<number>;
  spacers: Set<number>;
}

function lines(value: string): string[] {
  const result = value.split("\n");
  if (result.at(-1) === "") result.pop();
  return result;
}

export function buildAlignedDiff(before: string, after: string): { before: AlignedSide; after: AlignedSide } {
  const left: string[] = [];
  const right: string[] = [];
  const leftNumbers: Array<number | null> = [];
  const rightNumbers: Array<number | null> = [];
  const leftChanged = new Set<number>();
  const rightChanged = new Set<number>();
  const leftSpacers = new Set<number>();
  const rightSpacers = new Set<number>();
  let leftNumber = 1;
  let rightNumber = 1;
  const parts = diffLines(before, after);

  const append = (leftLine: string | null, rightLine: string | null, changed: boolean) => {
    left.push(leftLine ?? "");
    right.push(rightLine ?? "");
    leftNumbers.push(leftLine === null ? null : leftNumber++);
    rightNumbers.push(rightLine === null ? null : rightNumber++);
    const displayLine = left.length;
    if (leftLine === null) leftSpacers.add(displayLine);
    else if (changed) leftChanged.add(displayLine);
    if (rightLine === null) rightSpacers.add(displayLine);
    else if (changed) rightChanged.add(displayLine);
  };

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.removed && parts[index + 1]?.added) {
      const removed = lines(part.value);
      const added = lines(parts[++index].value);
      const count = Math.max(removed.length, added.length);
      for (let row = 0; row < count; row++) append(removed[row] ?? null, added[row] ?? null, true);
    } else if (part.removed) {
      for (const value of lines(part.value)) append(value, null, true);
    } else if (part.added) {
      for (const value of lines(part.value)) append(null, value, true);
    } else {
      for (const value of lines(part.value)) append(value, value, false);
    }
  }

  // CodeMirror always renders one line for an empty document. Keep both sides
  // structurally identical so their gutters and scroll heights still match.
  if (!left.length) append("", "", false);
  return {
    before: { text: left.join("\n"), lineNumbers: leftNumbers, changed: leftChanged, spacers: leftSpacers },
    after: { text: right.join("\n"), lineNumbers: rightNumbers, changed: rightChanged, spacers: rightSpacers },
  };
}

function extensionsForSide(side: AlignedSide, kind: "before" | "after"): Extension[] {
  const theme = EditorView.baseTheme({
    ".git-diff-removed": { backgroundColor: "rgba(248,81,73,.20)" },
    ".git-diff-added": { backgroundColor: "rgba(46,160,67,.20)" },
    ".git-diff-spacer": {
      backgroundColor: "rgba(110,118,129,.10)",
      backgroundImage:
        "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(110,118,129,.12) 3px, rgba(110,118,129,.12) 4px)",
    },
    ".cm-gutters": { minWidth: "3.5rem" },
  });
  return [
    lineNumbers({ formatNumber: (displayLine) => side.lineNumbers[displayLine - 1]?.toString() ?? "" }),
    lineDecorations(side.changed, kind === "before" ? "git-diff-removed" : "git-diff-added"),
    lineDecorations(side.spacers, "git-diff-spacer"),
    theme,
  ];
}
