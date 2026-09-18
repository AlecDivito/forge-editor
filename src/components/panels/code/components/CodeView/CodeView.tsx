import useDocument from "@/hooks/use-document.hook";
import { useDocumentLifecycle } from "@/hooks/use-document-lifecycle.hook";
import { Compartment, EditorState, EditorView, hoverTooltip } from "@uiw/react-codemirror";
import { basicSetup } from "codemirror";
import { IDockviewPanelProps } from "dockview";
import { FC, useEffect, useRef, useState } from "react";
import { yCollab } from "y-codemirror.next";
import { useDocumentDiagnosticsSync } from "./hook/use-document-diagnostics.hook";
import { linterExtension } from "./extensions/lint.extension";
import { infoPanelExtension } from "./extensions/info-panel.extension";
import { requestHoverToolTip } from "./extensions/tooltip.extension";
import { DocumentFileId, DocumentWorkspaceId } from "./extensions/state.extension";
import { autocompletion } from "@codemirror/autocomplete";
import { autoCompletionOverride } from "./extensions/autocomplete.extension";
import { CodePanelDescriptor } from "../../state/editor-session.store";
import { registerEditorInstance } from "../../state/editor-instance.registry";
import { useDocumentAwareness } from "./hook/use-document-awareness.hook";
import { DocumentParticipants } from "./components/DocumentParticipants";
import { languageForFile } from "./extensions/language.extension";

const CodeView: FC<IDockviewPanelProps<CodePanelDescriptor>> = (props) => {
  const { id: panelId, workspace, fileId } = props.params;
  const document = useDocument(workspace, fileId);
  const lifecycle = useDocumentLifecycle(workspace, fileId);
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const identityCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());

  useDocumentDiagnosticsSync(view, workspace, fileId);

  const participants = useDocumentAwareness(document, containerRef);

  useEffect(() => {
    if (!document || !editorRef.current) return;
    const ytext = document.ydoc.getText("content");
    const tooltipExtension = hoverTooltip(requestHoverToolTip, {
      hideOn: (tr, tooltip) => {
        return false;
      },
      hideOnChange: false,
      hoverTime: 200,
    });

    const view = new EditorView({
      parent: editorRef.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          identityCompartment.current.of([DocumentWorkspaceId.of(workspace), DocumentFileId.of(fileId)]),
          yCollab(ytext, document.awareness),
          readOnlyCompartment.current.of([
            EditorState.readOnly.of(lifecycle.phase === "deleted"),
            EditorView.editable.of(lifecycle.phase !== "deleted"),
          ]),
          languageCompartment.current.of(languageForFile(fileId)),
          tooltipExtension,
          autocompletion({
            activateOnTyping: true,
            activateOnTypingDelay: 100,
            selectOnOpen: true,
            closeOnBlur: false,
            maxRenderedOptions: 200,
            // add to the completion dialog element.
            // This is the popup that appears on the page. It's the entire box
            tooltipClass: (state) => {
              // console.log(state);
              return "tooltipClass";
            },
            // Add CSS classes to completion options
            optionClass: (completion) => {
              // console.log(completion);
              return "completion";
            },
            filterStrict: true,
            icons: true,
            activateOnCompletion: (test) => {
              // console.log(test);
              return true;
            },
            override: [autoCompletionOverride],
          }),
          linterExtension(),
          // infoPanelExtension(),
        ],
      }),
    });
    const unregisterEditor = registerEditorInstance(panelId, view);
    setView(view);
    return () => {
      unregisterEditor();
      view.destroy();
      setView(null);
    };
  }, [document, panelId]);

  // A filesystem rename updates Dockview params while retaining this
  // EditorView. Reconfigure only path-sensitive facets/extensions so the
  // Yjs model, cursor, and undo history remain untouched.
  useEffect(() => {
    if (!view) return;
    view.dispatch({
      effects: [
        identityCompartment.current.reconfigure([DocumentWorkspaceId.of(workspace), DocumentFileId.of(fileId)]),
        languageCompartment.current.reconfigure(languageForFile(fileId)),
      ],
    });
  }, [fileId, view, workspace]);

  useEffect(() => {
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(lifecycle.phase === "deleted"),
        EditorView.editable.of(lifecycle.phase !== "deleted"),
      ]),
    });
  }, [lifecycle.phase, view]);

  return (
    <div ref={containerRef} className="relative h-full min-h-0 min-w-0 overflow-hidden">
      <DocumentParticipants participants={participants} />
      <div ref={editorRef} className="code-view h-full min-h-0 min-w-0 overflow-hidden" />
    </div>
  );
};

export default CodeView;
