import type { IDockviewPanelProps } from "dockview-react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { GeneratedSourcePanelDescriptor } from "../../state/editor-session.store";
import { registerEditorInstance } from "../../state/editor-instance.registry";

export default function DebugSourceView({ params }: IDockviewPanelProps<GeneratedSourcePanelDescriptor>) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: params.content,
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { overflow: "auto" } }),
        ],
      }),
    });
    const unregister = registerEditorInstance(params.id, view);
    return () => {
      unregister();
      view.destroy();
    };
  }, [params.id, params.content]);
  return <div ref={host} aria-label={`Generated source ${params.name}, read only`} className="h-full min-h-0" />;
}
