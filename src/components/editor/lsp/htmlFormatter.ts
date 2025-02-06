import { javascript } from "@codemirror/lang-javascript";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { gruvboxDarkStyle } from "@uiw/codemirror-theme-gruvbox-dark";
import { CreateThemeOptions } from "@uiw/codemirror-themes";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import { MarkedString, MarkupContent } from "vscode-languageserver-protocol";

const emit = (elem: Element) => (text: string, classes: string) => {
  let node: Text | HTMLSpanElement = document.createTextNode(text);
  if (classes) {
    const span = document.createElement("span");
    span.appendChild(node);
    span.className = classes;
    // span.style.cssText = classes;
    node = span;
  }
  elem.appendChild(node);
};

const emitBreak = (elem: Element) => () => {
  elem.appendChild(document.createTextNode("\n"));
};

const createTokClasses = (theme: string, highlightStyles: CreateThemeOptions["styles"]) => {
  let styleSheet = [...document.head.getElementsByTagName("style")].find(
    (elem) => elem.getAttribute("id") === theme,
  ) as HTMLStyleElement;

  // If the styleSheet already exists, remove all previous styles
  if (styleSheet) {
    const sheet = styleSheet.sheet;
    if (sheet) {
      while (sheet.cssRules.length > 0) {
        sheet.deleteRule(0);
      }
    }
  } else {
    // Otherwise, create a new style element
    styleSheet = document.createElement("style");
    styleSheet.setAttribute("id", theme);
    document.head.appendChild(styleSheet);
  }

  // Ensure we have a valid stylesheet
  const sheet = styleSheet.sheet;
  if (!sheet) {
    console.warn("Stylesheet not found or not accessible.");
    return;
  }

  // Generate and insert new styles
  highlightStyles.forEach(({ tag, color, fontWeight, fontStyle, textDecoration }) => {
    const tagNames = Array.isArray(tag) ? tag.map((t) => t.name) : [tag.name]; // Handle arrays

    tagNames.forEach((tagName) => {
      const className = `tok-${tagName}`;

      // Generate CSS rule dynamically
      let rule = `.cm-syntax .${className} {`;
      if (color) rule += ` color: ${color};`;
      if (fontWeight) rule += ` font-weight: ${fontWeight};`;
      if (fontStyle) rule += ` font-style: ${fontStyle};`;
      if (textDecoration) rule += ` text-decoration: ${textDecoration};`;
      rule += ` }`;

      // Insert CSS rule into the stylesheet
      try {
        sheet.insertRule(rule, sheet.cssRules.length);
      } catch (error) {
        console.warn("Failed to insert rule:", rule, error);
      }
    });
  });

  console.log(`Stylesheet updated for theme: ${theme}`);
};

const javascriptParser = javascript();

// Setup marked with Lezer for highlighting
const markedWithLezer = new Marked(
  markedHighlight({
    langPrefix: "cm-syntax language-", // Prefix for CSS classes
    emptyLangClass: "cm-syntax",
    highlight: (code, lang) => {
      createTokClasses("gruvboxDark", gruvboxDarkStyle);
      const result = document.createElement("div");
      highlightCode(
        code,
        javascriptParser.language.parser.parse(code),
        classHighlighter,
        emit(result),
        emitBreak(result),
      );
      // console.log(result.innerHTML);
      return result.innerHTML;
      // return highlightCodeWithLezer(code, lang); // Use Lezer for highlighting
      // return highlightCodeWithCodeMirror(code, lang);
      // const tree = javascriptParser.language.parser.parse(code);
      // console.log(code);

      // const highlighter = {
      //   style: (tags: Tag[]): string | null => {
      //     console.log(tags);
      //     const styles = gruvboxDarkStyle
      //       .filter((style) => {
      //         return Array.isArray(style.tag) ? style.tag.some((t) => tags.map(tag => tag.name).includes(t)) : tags.includes(style.tag);
      //       })
      //       .map((style) => style.class || "");
      //     return styles.join(" ");
      //   },
      // }
      // const highlighter = {
      //   style: (tags: Tag[]): string | null => {
      //     const tagNames = tags.map((tag) => tag.name); // Extract tag names

      //     // Find the first matching style
      //     const styleObj = gruvboxDarkStyle.find((style) =>
      //       Array.isArray(style.tag)
      //         ? style.tag.some((t) => tagNames.includes(t.name)) // Handle arrays
      //         : tagNames.includes(style.tag.name),
      //     );

      //     if (!styleObj) return ""; // No matching styles

      //     // Convert style object to inline CSS string
      //     const inlineStyles = Object.entries(styleObj)
      //       .filter(([key]) => key !== "tag") // Ignore `tag` property
      //       .map(([key, value]) => `${key.replace(/([A-Z])/g, "-$1").toLowerCase()}:${value}`)
      //       .join(";");

      //     return inlineStyles; // Return style string
      //   },
      // };

      // const putStyle = (elem: Element) => (from: number, to: number, classes: string) => {
      //   const text = code.slice(from, to);
      //   emit(elem)(text, classes);
      // };
      // highlightTree(tree, highlighter, putStyle(result));
    },
  }),
);

export async function formatContentSections(
  contents: (string | MarkupContent | MarkedString | MarkedString[])[],
): Promise<string[]> {
  const sections = [];
  for (const content of contents) {
    sections.push(await formatContents(content));
  }
  return sections;
}

export async function formatContents(
  contents: string | MarkupContent | MarkedString | MarkedString[],
): Promise<string> {
  let content = "";
  if (Array.isArray(contents)) {
    const items = [];
    for (const item of contents) {
      items.push((await formatContents(item)) + "\n\n");
    }
    content = items.join("  ");
  } else if (typeof contents === "string") {
    content = contents;
  } else {
    content = contents.value;
  }

  // TODO: Sanitize the output of the markdown
  const htmlString = markedWithLezer.parse(content);

  // console.log(htmlString);
  return htmlString;
}

export async function format(contents: string | MarkupContent | MarkedString | MarkedString[]): Promise<string> {
  let content = "";
  if (Array.isArray(contents)) {
    const items = [];
    for (const item of contents) {
      items.push((await formatContents(item)) + "\n\n");
    }
    content = items.join("  ");
  } else if (typeof contents === "string") {
    content = contents;
  } else {
    content = contents.value;
  }

  // TODO: Sanitize the output of the markdown
  const htmlString = markedWithLezer.parse(content);

  // console.log(htmlString);
  return htmlString;
}
