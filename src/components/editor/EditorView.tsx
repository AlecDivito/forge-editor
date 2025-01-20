import { IDockviewPanelProps } from "dockview";
import { FC, useEffect, useState } from "react";
import { EditorParams } from "./EditorParams";
import { Extension } from "@uiw/react-codemirror/cjs/index.js";
import dynamic from "next/dynamic";
import { useSendLspMessage } from "@/hooks/use-send-message";
import { lspExtensions } from "./lsp";
import { useFileStore } from "@/store/filetree";
import { FileExtension } from "@/service/lsp/proxy";

const ReactCodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
});

const languageExtensions: Record<FileExtension, () => Promise<Extension>> = {
  js: () =>
    import("@codemirror/lang-javascript").then((mod) => mod.javascript()),
  ts: () =>
    import("@codemirror/lang-javascript").then((mod) =>
      mod.javascript({ typescript: true })
    ),
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

const getFileExtension = (filename: string): FileExtension | undefined => {
  const parts = filename.split(".");
  const exts: FileExtension[] = ["go", "rs", "json", "js", "ts", "md"];
  const extension = parts.length > 1 ? parts.pop() : undefined;
  if (!extension || !(exts as string[]).includes(extension)) {
    return undefined;
  }
  return extension as FileExtension;
};

const EditorView: FC<IDockviewPanelProps<EditorParams>> = ({ params }) => {
  const { file, theme } = params;
  const language = getFileExtension(file);
  const client = useSendLspMessage(language);
  const { capabilities, activeFiles } = useFileStore();

  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loadedTheme, setLoadedTheme] = useState<Extension | undefined>();

  useEffect(() => {
    const loadExtensions = async () => {
      if (!language || !activeFiles?.[file]) {
        return;
      }

      const loadedExtensions = [];
      if (capabilities[language]) {
        loadedExtensions.push(await languageExtensions[language]());
        // loadedExtensions.push(collabExtension(version, client));
        loadedExtensions.push(
          lspExtensions(
            client,
            `file:///${file}`,
            language,
            activeFiles[file].version,
            capabilities[language]
          )
        );
      }
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

    if (activeFiles?.[file] && file && capabilities) {
      loadExtensions();
      loadTheme();
    }
  }, [client, language, activeFiles, file, capabilities, theme]);

  // !(!!activeFiles?.[file] makes sure that it's a type) and this is the boolean operation on it
  if (!!!activeFiles?.[file] || extensions.length === 0) {
    return <div>Loading {file}...</div>;
  }

  return (
    <ReactCodeMirror
      value={activeFiles[file].text || ""}
      extensions={extensions}
      theme={loadedTheme}
      height="100%"
    />
  );
};

export default EditorView;
