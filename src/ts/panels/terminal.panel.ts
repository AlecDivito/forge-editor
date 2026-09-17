import { GroupPanelPartInitParameters, IContentRenderer } from "dockview";

export default class TerminalPanel implements IContentRenderer {
  private readonly _element: HTMLElement;

  get element(): HTMLElement {
    return this._element;
  }

  constructor() {
    this._element = document.createElement("div");
    this._element.textContent = "terminal";
    this._element.style.color = "red";
  }

  init(parameters: GroupPanelPartInitParameters): void {
    parameters.title = "Terminal";
  }
}
