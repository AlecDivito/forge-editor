import { Text } from "@uiw/react-codemirror";
import type { Diagnostic as CMDiagnostic } from "@codemirror/lint";
import { LspDiagnostic } from "../ws/messages";
import { DiagnosticSeverity } from "vscode-languageserver-protocol";

/** Wire severity is the Rust enum's default PascalCase serialization. */
function mapSeverity(lspSeverity?: DiagnosticSeverity): CMDiagnostic["severity"] {
    switch (lspSeverity) {
      case 1:
        return "error"; // LSP Error
      case 2:
        return "warning"; // LSP Warning
      case 3:
        return "info"; // LSP Information
      case 4:
        return "hint"; // LSP Hint
      default:
        return "error";
    }
  }

/**
 * line/character -> doc offset, clamped to the current document. Diagnostics
 * can briefly reference positions from a slightly stale version of the text
 * (LSP computed them, then the doc kept changing) — clamping avoids
 * doc.line() throwing on a stale line number instead of just dropping or
 * visually squishing that one diagnostic.
 */
function toOffset(doc: Text, line: number, character: number): number | null {
  if (line < 0 || line >= doc.lines) return null;
  const docLine = doc.line(line + 1); // CodeMirror lines are 1-indexed, LSP lines are 0-indexed
  return docLine.from + Math.min(character, docLine.length);
}

export function convertDiagnostics(diagnostics: LspDiagnostic[], doc: Text): CMDiagnostic[] {
  const result: CMDiagnostic[] = [];
  for (const d of diagnostics) {
    const from = toOffset(doc, d.range.start.line, d.range.start.character);
    const to = toOffset(doc, d.range.end.line, d.range.end.character);
    if (from == null || to == null) continue;

    result.push({
      from,
      to: Math.max(to, from), // CodeMirror requires to >= from
      severity: mapSeverity(d.severity),
      message: d.source ? `${d.message} (${d.source}${d.code != null ? " " + d.code : ""})` : d.message,
    });
  }
  return result;
}