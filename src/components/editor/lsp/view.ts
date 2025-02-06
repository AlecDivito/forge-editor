import { EditorView, Extension, PluginValue, ViewPlugin, ViewUpdate } from "@uiw/react-codemirror";
import { ForgePlugin } from "./plugin";
import { textChangeExtension, TextChangePlugin } from "./plugin/textChange";
import { signatureHelpExtension, SignatureHelpTooltipPlugin } from "./plugin/signatureHelp";

export const ForgeLspExtension = (): Extension[] => {
  return [
    ViewPlugin.define(
      (view: EditorView) => new ForgeLspPlugin(view, new TextChangePlugin(view), new SignatureHelpTooltipPlugin(view)),
    ),
    textChangeExtension(),
    signatureHelpExtension(),
  ];
};

class ForgeLspPlugin implements PluginValue {
  view: EditorView;
  plugins: ForgePlugin[];
  processing: boolean = false;
  transactionId: number = 0;
  commandCounter: number = 0;

  constructor(view: EditorView, ...plugins: ForgePlugin[]) {
    this.view = view;
    this.plugins = plugins;
  }

  update(update: ViewUpdate): void {
    const plugins = this.plugins.filter((f) => f.isEnabled());

    // Collect all updates as callbacks that will be processed eventually
    for (const plugin of plugins) {
      plugin.update(update);
    }
  }

  destroy() {}
}
