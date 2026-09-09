import useDocument from "@/hooks/use-document.hook";
import { DocumentKeyParts } from "@/lib/documents/registry";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { EditorState, EditorView, Extension, hoverTooltip } from "@uiw/react-codemirror";
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

function languageForFile(fileId?: string): Extension[] {
    const ext = fileId?.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'js': case 'jsx': case 'mjs': case 'cjs':
            return [javascript({ jsx: ext === 'jsx' })];
        case 'ts':
            return [javascript({ typescript: true })];
        case 'tsx':
            return [javascript({ typescript: true, jsx: true })];
        case 'py': return [python()];
        case 'rs': return [rust()];
        case 'css': return [css()];
        case 'html': return [html()];
        case 'json': return [json()];
        case 'md': case 'markdown': return [markdown()];
        case 'sql': return [sql()];
        case 'yaml': case 'yml': return [yaml()];
        case 'go': return [go()];
        default: return [];
    }
}

const CodeView: FC<IDockviewPanelProps<DocumentKeyParts>> = (props) => {
    const { workspace, fileId } = props.params
    const document = useDocument(workspace, fileId)
    const editorRef = useRef<HTMLDivElement>(null)
    const [view, setView] = useState<EditorView | null>(null)

    useDocumentDiagnosticsSync(view, workspace, fileId);

    useEffect(() => {
        if (!document || !editorRef.current) return;
        const ytext = document.ydoc.getText('content');
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
                    DocumentWorkspaceId.of(workspace),
                    DocumentFileId.of(fileId),
                    yCollab(ytext, document.awareness),
                    ...languageForFile(fileId),
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
                    infoPanelExtension()
                ],
            }),
        });
        setView(view);
        return () => {
            view.destroy();
            setView(null)
        }
    }, [document]);


    return <div ref={editorRef} className="h-full" />;
}

export default CodeView