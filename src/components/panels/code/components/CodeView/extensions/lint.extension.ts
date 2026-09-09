import { Diagnostic as CMDiagnostic, linter, lintGutter } from "@codemirror/lint";
import { EditorView, StateEffect, StateField, Transaction } from "@uiw/react-codemirror";
import { LspDiagnostic } from "@/lib/ws/messages";
import { convertDiagnostics } from "@/lib/documents/diagnostics";

export const lintDiagnosticEffect = StateEffect.define<LspDiagnostic[]>();

const lintDiagnosticsState = StateField.define<readonly CMDiagnostic[]>({
  create: () => [],

  update(diagnostics, tr: Transaction) {
    for (const effect of tr.effects) {
      if (effect.is(lintDiagnosticEffect)) {
        // convert against tr.state.doc — the doc as of *this* transaction,
        // which is the only doc state guaranteed current at this point
        diagnostics = convertDiagnostics(effect.value, tr.state.doc);
      }
    }
    return diagnostics;
  },

  provide: (f) => linter((view) => view.state.field(f)),
});

export function linterExtension() {
  return [lintDiagnosticsState, lintGutter()];
}