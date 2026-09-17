import { GridviewApi, Parameters } from "dockview";
import { GridPanelElement } from "./panel";

export default class FileSystemPanel implements GridPanelElement {
  props?: Parameters;
  api?: GridviewApi;

  create(props: Parameters, api: GridviewApi): HTMLElement {
    this.props = props;
    this.api = api;

    const element = document.createElement("div");
    element.textContent = "filesystem";
    element.style.border = "1px solid green";

    return element;
  }
}
