import { Diagnostic, linter, lintGutter } from "@codemirror/lint";
import { EditorView, StateEffect, StateField, Transaction } from "@uiw/react-codemirror";

export const lintDiagnosticEffect = StateEffect.define<Diagnostic[]>();

const lintDiagnosticsState = StateField.define<readonly Diagnostic[]>({
  create: () => [],

  update(diagnostics, tr: Transaction) {
    for (const effect of tr.effects) {
      if (effect && effect.is(lintDiagnosticEffect)) {
        diagnostics = effect.value;
      }
    }

    return diagnostics;
  },

  provide: (f) =>
    linter((view: EditorView) => {
      const state = view.state.field(f);
      return state;
    }),
});

export function linterExtension() {
  return [lintDiagnosticsState, lintGutter({})];
}
