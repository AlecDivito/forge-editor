import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { Extension } from "@codemirror/state";

export function languageForFile(fileId?: string): Extension[] {
  const extension = fileId?.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return [javascript({ jsx: extension === "jsx" })];
    case "ts":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    case "py":
      return [python()];
    case "rs":
      return [rust()];
    case "css":
      return [css()];
    case "html":
      return [html()];
    case "json":
      return [json()];
    case "md":
    case "markdown":
      return [markdown()];
    case "sql":
      return [sql()];
    case "yaml":
    case "yml":
      return [yaml()];
    case "go":
      return [go()];
    default:
      return [];
  }
}
