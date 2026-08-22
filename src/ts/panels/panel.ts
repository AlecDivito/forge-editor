import {
  IFrameworkPart,
  Parameters,
  GridviewApi,
  GridviewPanel,
  GridviewInitParameters,
  GridviewComponent,
} from "dockview";

export interface GridPanelElement {
  create: (props: Parameters, api: GridviewApi) => HTMLElement;
  update?: (props: Parameters) => void;
}

export class GridPanel extends GridviewPanel {
  constructor(
    id: string,
    component: string,
    private gridElement: GridPanelElement,
  ) {
    super(id, component);
  }

  protected getComponent(): IFrameworkPart {
    return new DockviewGridPanel(
      this.gridElement,
      this.element,
      this._params?.params ?? {},
      new GridviewApi((this._params as GridviewInitParameters).accessor as GridviewComponent),
    );
  }
}

class DockviewGridPanel implements IFrameworkPart {
  private disposed = false;

  constructor(
    private readonly child: GridPanelElement,
    private readonly parent: HTMLElement,
    private readonly parameters: Parameters,
    private readonly api: GridviewApi,
  ) {
    parent.appendChild(child.create(parameters, api));
  }

  update(props: Parameters): void {
    if (this.disposed) {
      throw new Error("invalid operation: resource is already disposed");
    }
    if (this.child.update) {
      this.child?.update(props);
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
