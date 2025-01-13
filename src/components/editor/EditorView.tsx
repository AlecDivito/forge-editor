import { useSendMessage } from "@/hooks/send-message";
import { FileUpdated } from "@/interfaces/socket";
import { useFileStore } from "@/store";
import { IDockviewPanelProps } from "dockview";
import { FC, useEffect, useState } from "react";
import { EditorParams } from "./EditorParams";
import { Extension } from "@uiw/react-codemirror/cjs/index.js";
import dynamic from "next/dynamic";
import { debounce } from "@/utils/debounce";
import { autocompletion } from "@codemirror/autocomplete";
// import { Diagnostic, linter } from "@codemirror/lint";
// import { EditorView as CodeMirrorEditorView } from "@codemirror/view";

const ReactCodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
});

const languageExtensions: Record<string, () => Promise<Extension>> = {
  js: () =>
    import("@codemirror/lang-javascript").then((mod) => mod.javascript()),
  ts: () =>
    import("@codemirror/lang-javascript").then((mod) =>
      mod.javascript({ typescript: true })
    ),
  css: () => import("@codemirror/lang-css").then((mod) => mod.css()),
  html: () => import("@codemirror/lang-html").then((mod) => mod.html()),
  py: () => import("@codemirror/lang-python").then((mod) => mod.python()),
  yaml: () => import("@codemirror/lang-yaml").then((mod) => mod.yaml()),
  json: () => import("@codemirror/lang-json").then((mod) => mod.json()),
  rust: () => import("@codemirror/lang-rust").then((mod) => mod.rust()),
  markdown: () =>
    import("@codemirror/lang-markdown").then((mod) => mod.markdown()),
  wast: () => import("@codemirror/lang-wast").then((mod) => mod.wast()),
  sql: () => import("@codemirror/lang-sql").then((mod) => mod.sql()),
  go: () => import("@codemirror/lang-go").then((mod) => mod.go()),
};

// const languageLinter: Record<
//   string,
//   () => Promise<(view: CodeMirrorEditorView) => Diagnostic[]>
// > = {
// js: () => import("@codemirror/lang-javascript").then((mod) => mod.esLint()),
// ts: () => import("@codemirror/lang-javascript").then((mod) => mod.esLint()),
// css: () => import("@codemirror/lang-css").then((mod) => mod.()),
// html: () => import("@codemirror/lang-html").then((mod) => mod.html()),
// py: () => import("@codemirror/lang-python").then((mod) => mod.python()),
// yaml: () => import("@codemirror/lang-yaml").then((mod) => mod.yaml()),
// json: () => import("@codemirror/lang-json").then((mod) => mod.json()),
// rust: () => import("@codemirror/lang-rust").then((mod) => mod.rust()),
// markdown: () =>
//   import("@codemirror/lang-markdown").then((mod) => mod.markdown()),
// wast: () => import("@codemirror/lang-wast").then((mod) => mod.wast()),
// sql: () => import("@codemirror/lang-sql").then((mod) => mod.sql()),
// go: () => import("@codemirror/lang-go").then((mod) => mod.go()),
// };

// const customLinter = (): Diagnostic[] => {
//   return [
//     {
//       from: 0,
//       to: 5,
//       message: "Example lint warning: Text should be properly formatted.",
//       severity: "warning",
//     },
//   ];
// };

const getFileExtension = (filename: string): string => {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()! : "";
};

const EditorView: FC<IDockviewPanelProps<EditorParams>> = ({ params }) => {
  // const api: DockviewPanelApi = props.api;
  // const groupApi: DockviewGroupPanelApi = props?.group?.api;
  // const containerApi: DockviewApi = props.containerApi;
  const { file, theme } = params;
  const content = useFileStore((state) => state.files[file]);
  const updateFile = useFileStore((state) => state.updateFile);
  const send = useSendMessage();

  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loadedTheme, setLoadedTheme] = useState<Extension | undefined>();

  const debouncedSave = debounce((value: string) => {
    updateFile(file, value);
    send(FileUpdated(file, value));
  }, 500);

  useEffect(() => {
    const loadExtensions = async () => {
      const ext = getFileExtension(file);
      const languageExtension = languageExtensions[ext];

      const loadedExtensions = [
        languageExtension ? await languageExtension() : [],
        autocompletion(),
        // linter(customLinter),
      ];

      setExtensions(loadedExtensions);
    };

    const loadTheme = async () => {
      try {
        if (theme === "material") {
          const { materialDark, materialLight } = await import(
            "@uiw/codemirror-theme-material"
          );
          setLoadedTheme(
            window.matchMedia("(prefers-color-scheme: dark)").matches
              ? materialDark
              : materialLight
          );
        } else if (theme === "gruvbox") {
          const { gruvboxDark, gruvboxLight } = await import(
            "@uiw/codemirror-theme-gruvbox-dark"
          );
          setLoadedTheme(
            window.matchMedia("(prefers-color-scheme: dark)").matches
              ? gruvboxDark
              : gruvboxLight
          );
        } else {
          throw new Error(`Unsupported theme: ${theme}`);
        }
      } catch (error) {
        console.error("Failed to load theme:", error);
        setLoadedTheme(undefined);
      }
    };

    loadExtensions();
    loadTheme();
  }, [file, theme]);

  return (
    <ReactCodeMirror
      value={content || ""}
      extensions={extensions}
      theme={loadedTheme}
      height="100%"
      onChange={(value) => debouncedSave(value)}
    />
  );
};

export default EditorView;
