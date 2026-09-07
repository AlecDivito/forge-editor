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
import { EditorState, EditorView, Extension } from "@uiw/react-codemirror";
import { basicSetup } from "codemirror";
import { IDockviewPanelProps } from "dockview";
import { FC, useEffect, useRef } from "react";
import { yCollab } from "y-codemirror.next";

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

    useEffect(() => {
        if (!document || !editorRef.current) return;
        const ytext = document.ydoc.getText('content');
        const view = new EditorView({
            parent: editorRef.current,
            state: EditorState.create({
                doc: ytext.toString(),
                extensions: [
                    basicSetup,
                    yCollab(ytext, document.awareness),
                    ...languageForFile(fileId),
                ],
            }),
        });
        return () => view.destroy();
    }, [document]);


    return <div ref={editorRef} className="h-full" />;
}

export default CodeView