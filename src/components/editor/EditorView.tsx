import { useSendRequest } from "@/hooks/use-send-message";
import { useSendNotification } from "@/hooks/use-send-notification";
import { FileExtension } from "@/service/lsp/proxy";
import { IDockviewPanelProps } from "dockview";
import dynamic from "next/dynamic";
import { FC, useEffect, useState } from "react";
import { EditorParams } from "./EditorParams";
import { lspExtensions } from "./lsp";
import { useNotification } from "@/store/notification";
import { lintDiagnosticEffect } from "./lsp/linter";
import { convertLspDiagnosticsToCodemirror } from "@/utils/diagnosticConverter";
import { EditorView as CodeMirrorView, Extension } from "@uiw/react-codemirror";
import { useLspStore } from "@/store/lsp";
import { useEditorStore } from "@/store/editor";
import { useFileStore } from "@/store/filetree";

const ReactCodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
});

const languageExtensions: Record<string, () => Promise<Extension>> = {
  js: () => import("@codemirror/lang-javascript").then((mod) => mod.javascript()),
  ts: () => import("@codemirror/lang-javascript").then((mod) => mod.javascript({ typescript: true })),
  css: () => import("@codemirror/lang-css").then((mod) => mod.css()),
  html: () => import("@codemirror/lang-html").then((mod) => mod.html()),
  // py: () => import("@codemirror/lang-python").then((mod) => mod.python()),
  // yaml: () => import("@codemirror/lang-yaml").then((mod) => mod.yaml()),
  json: () => import("@codemirror/lang-json").then((mod) => mod.json()),
  rs: () => import("@codemirror/lang-rust").then((mod) => mod.rust()),
  md: () => import("@codemirror/lang-markdown").then((mod) => mod.markdown()),
  // wast: () => import("@codemirror/lang-wast").then((mod) => mod.wast()),
  // sql: () => import("@codemirror/lang-sql").then((mod) => mod.sql()),
  go: () => import("@codemirror/lang-go").then((mod) => mod.go()),
};

export const getFileExtension = (filename?: string): string => {
  const parts = filename?.split(".") || [];
  const exts: { [key: string]: string } = {
    go: "go",
    rs: "rust",
    json: "json",
    js: "javascript",
    ts: "typescript",
    md: "markdown",
  };
  const extension = parts.length > 1 ? parts.pop() : undefined;
  if (extension && extension in exts) {
    return exts[extension];
  } else {
    return "text";
  }
};

const EditorView: FC<IDockviewPanelProps<EditorParams>> = ({ params }) => {
  const { file, theme } = params;
  const { capabilities } = useLspStore();
  const { activeFiles } = useEditorStore();
  const { base } = useFileStore();
  const [view, setView] = useState<CodeMirrorView | undefined>();
  const language = getFileExtension(file);
  const sendRequest = useSendRequest(language);
  const sendNotification = useSendNotification(language);
  const diagnostics = useNotification((state) => state.diagnostics?.[file]);

  const [extensions, setExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    const loadExtensions = async () => {
      if (!language || !!!activeFiles?.[file]) {
        return;
      }

      const loadedExtensions = [];
      if (capabilities[language]) {
        if (language in languageExtensions) {
          loadedExtensions.push(await languageExtensions[language]());
        }
        // loadedExtensions.push(collabExtension(version, client));
        loadedExtensions.push(
          lspExtensions(
            sendRequest,
            sendNotification,
            file,
            language,
            activeFiles[file].version,
            capabilities[language],
            theme,
          ),
        );
      }
      setExtensions(loadedExtensions);
    };

    if (activeFiles?.[file] && file && capabilities) {
      loadExtensions();
    }
  }, [sendRequest, sendNotification, language, activeFiles, file, capabilities, theme, base]);

  useEffect(() => {
    if (view && diagnostics) {
      const codeDiagnostics = convertLspDiagnosticsToCodemirror(diagnostics, view.state.doc);
      view.dispatch({ effects: lintDiagnosticEffect.of(codeDiagnostics) });
    }
  }, [view, diagnostics]);

  // !(!!activeFiles?.[file] makes sure that it's a type) and this is the boolean operation on it
  if (!!!activeFiles?.[file] || extensions.length === 0) {
    return <div>Loading {file}...</div>;
  }

  return (
    <ReactCodeMirror
      onCreateEditor={(editor) => setView(editor)}
      value={activeFiles[file].text || ""}
      extensions={extensions}
      theme={"dark"}
      height="100%"
    />
  );
};

export default EditorView;
