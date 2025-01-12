"use client";

import { Extension, StateField } from "@uiw/react-codemirror/cjs/index.js";
import { FC, useEffect, useState } from "react";
import { javascript } from "@codemirror/lang-javascript";
import dynamic from "next/dynamic";
import { EditorView } from "codemirror";
import { OpenFile } from "@/interfaces/fs";

interface Props {
  file: OpenFile;
  theme?: "material" | "gruvbox";
  onThemeLoadError?: (error: Error) => void;
}

const extensions = [
  javascript({ jsx: true }),
  EditorView.theme({
    "&.cm-theme": { height: "100%" },
    // "&.cm-editor": { height: "100%" },
    // ".cm-scroller": { overflow: "auto" },
  }),
];

const stateFields = {}; // Define any custom state fields here if needed

const Editor: FC<Props> = ({ onThemeLoadError, theme = "gruvbox" }) => {
  const [loadedTheme, setLoadedTheme] = useState<Extension | undefined>();
  const [initialState, setInitialState] = useState<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Record<string, StateField<any>> | undefined
  >(undefined);

  useEffect(() => {
    const isDarkMode = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;

    const loadTheme = async () => {
      try {
        if (theme === "material") {
          const { materialDark, materialLight } = await import(
            "@uiw/codemirror-theme-material"
          );
          setLoadedTheme(isDarkMode ? materialDark : materialLight);
        } else if (theme === "gruvbox") {
          const { gruvboxDark, gruvboxLight } = await import(
            "@uiw/codemirror-theme-gruvbox-dark"
          );
          setLoadedTheme(isDarkMode ? gruvboxDark : gruvboxLight);
        } else {
          throw new Error(`Unsupported theme: ${theme}`);
        }
      } catch (error) {
        console.error("Failed to load theme:", error);
        onThemeLoadError?.(error as Error);
        setLoadedTheme(undefined);
      }
    };

    const loadInitialState = () => {
      if (typeof window !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serializedState: any =
          window.localStorage.getItem("myEditorState");
        const value = window.localStorage.getItem("myValue") || "";
        setInitialState(
          serializedState
            ? {
                json: JSON.parse(serializedState),
                fields: stateFields,
              }
            : { value }
        );
      }
    };

    loadTheme();
    loadInitialState();
  }, [theme, onThemeLoadError]);

  const ReactCodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
    ssr: false,
  });

  return (
    <ReactCodeMirror
      height="100%"
      initialState={initialState}
      onChange={(value, viewUpdate) => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("myValue", value);
          const state = viewUpdate.state.toJSON(stateFields);
          window.localStorage.setItem("myEditorState", JSON.stringify(state));
        }
      }}
      theme={loadedTheme}
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLineGutter: true,
        foldGutter: true,
        dropCursor: true,
        allowMultipleSelections: true,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        rectangularSelection: true,
        crosshairCursor: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        closeBracketsKeymap: true,
        searchKeymap: true,
        foldKeymap: true,
        completionKeymap: true,
        lintKeymap: true,
        tabSize: 2,
      }}
    />
  );
};

export default Editor;
