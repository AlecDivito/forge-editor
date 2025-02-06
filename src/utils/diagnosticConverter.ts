import { Text } from "@uiw/react-codemirror";
import { Diagnostic as CodeMirrorDiagnostic } from "@codemirror/lint";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver-protocol";

/**
 * Converts an LSP diagnostic array to a CodeMirror diagnostic array.
 * @param {Array} lspDiagnostics - The array of LSP diagnostics.
 * @param {Text} doc - The CodeMirror document to calculate positions.
 * @returns {Array<Diagnostic>} - The array of CodeMirror diagnostics.
 */
export function convertLspDiagnosticsToCodemirror(lspDiagnostics: Diagnostic[], doc: Text): CodeMirrorDiagnostic[] {
  return lspDiagnostics.map((diagnostic) => {
    const { range, message, severity, source, code } = diagnostic;

    // Convert LSP line/character positions to CodeMirror offsets
    const from = doc.line(range.start.line + 1).from + range.start.character;
    const to = doc.line(range.end.line + 1).from + range.end.character;

    return {
      from,
      to,
      message: `${message} (${source} ${code})`,
      severity: mapSeverity(severity),
    } as CodeMirrorDiagnostic;
  });
}

/**
 * Maps LSP severity levels to CodeMirror severity levels.
 * @param {DiagnosticSeverity} lspSeverity - The LSP diagnostic severity.
 * @returns {CodeMirrorDiagnostic['severity']}
 */
function mapSeverity(lspSeverity?: DiagnosticSeverity): CodeMirrorDiagnostic["severity"] {
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
