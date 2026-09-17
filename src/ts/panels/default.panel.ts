import { GroupPanelPartInitParameters, IContentRenderer } from "dockview";

export default class DefaultPanel implements IContentRenderer {
  private readonly _element: HTMLElement;

  get element(): HTMLElement {
    return this._element;
  }

  constructor() {
    this._element = document.createElement("div");
  }

  init(parameters: GroupPanelPartInitParameters): void {
    //
  }
}
