"use client";

import {
  CreateComponentOptions,
  createGridview,
  Parameters,
  GridviewPanel,
  GroupPanelPartInitParameters,
  IContentRenderer,
  Orientation,
  PanelUpdateEvent,
  ITabRenderer,
  createDockview,
  IHeaderActionsRenderer,
  DockviewGroupPanel,
  IGroupHeaderProps,
} from "dockview";
import FileSystemPanel from "./panels/filesystem.panel";
import TerminalPanel from "./panels/terminal.panel";
import DefaultPanel from "./panels/default.panel";
import EditorPanel from "./panels/editor.panel";
import { GridPanel } from "./panels/panel";

function createComponent(options: CreateComponentOptions): GridviewPanel {
  if (options.name === "editor") {
    return new GridPanel(options.id, options.name, new EditorPanel());
  } else {
    return new GridPanel(options.id, options.name, new FileSystemPanel());
  }
  // else if (options.name === "terminal") {
  //   return new TerminalPanel();
  // } else if (options.name === "filesystem") {
  //   return new FileSystemPanel();
  // } else {
  //   return new DefaultPanel();
  // }
}

class Panel implements IContentRenderer {
  private readonly _element: HTMLElement;

  private readonly e1: HTMLElement;
  private readonly e2: HTMLElement;
  private readonly e3: HTMLElement;

  private interval: any;

  get element(): HTMLElement {
    return this._element;
  }

  constructor() {
    this._element = document.createElement("div");
    this._element.style.color = "white";

    this.e1 = document.createElement("div");
    this.e2 = document.createElement("button");
    this.e3 = document.createElement("span");

    this.e2.textContent = "Start";

    this.element.append(this.e1, this.e2, this.e3);
  }

  init(parameters: GroupPanelPartInitParameters): void {
    parameters.api.onDidTitleChange((event) => {
      this.e1.textContent = event.title;
    });

    this.e1.textContent = parameters.api.title;
    this.e3.textContent = `value: ${parameters.params.myValue}`;

    this.e2.addEventListener("click", () => {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = undefined;
        this.e2.textContent = "Start";
      } else {
        this.interval = setInterval(() => {
          parameters.api.updateParameters({ myValue: Date.now() });
        }, 1000);
        parameters.api.updateParameters({ myValue: Date.now() });
        this.e2.textContent = "Stop";
      }
    });
  }

  update(event: PanelUpdateEvent<Parameters>): void {
    this.e3.textContent = `value: ${event.params.myValue}`;
  }
}

class CustomTab implements ITabRenderer {
  private readonly _element: HTMLElement;

  // private readonly e1: HTMLElement;
  // private readonly e2: HTMLElement;

  get element(): HTMLElement {
    return this._element;
  }

  constructor() {
    this._element = document.createElement("div");
    // this._element.style.color = "white";

    // this.e1 = document.createElement("div");
    // this.e2 = document.createElement("span");

    // this.element.append(this.e1, this.e2);
  }

  init(parameters: GroupPanelPartInitParameters): void {
    // parameters.api.onDidTitleChange((event) => {
    //   this.e1.textContent = parameters.api.title;
    // });
    // this.e1.textContent = parameters.api.title;
    // this.e2.textContent = `value: ${parameters.params.myValue}`;
  }

  update(event: PanelUpdateEvent<Parameters>): void {
    this.e2.textContent = `value: ${event.params.myValue}`;
  }
}

class PrefixHeader implements IHeaderActionsRenderer {
  private readonly _element: HTMLElement;

  get element(): HTMLElement {
    return this._element;
  }

  constructor(group: DockviewGroupPanel) {
    this._element = document.createElement("div");
    this._element.className = "dockview-groupcontrol-demo";
    this._element.innerText = "🌲";
  }

  init(parameters: IGroupHeaderProps): void {
    //
  }

  dispose(): void {
    //
  }
}

class RightHeaderActions implements IHeaderActionsRenderer {
  private readonly _element: HTMLElement;
  private readonly _disposables: (() => void)[] = [];

  get element(): HTMLElement {
    return this._element;
  }

  constructor(group: DockviewGroupPanel) {
    this._element = document.createElement("div");
    this._element.className = "dockview-groupcontrol-demo";
  }

  init(parameters: IGroupHeaderProps): void {
    const group = parameters.group;

    const span = document.createElement("span");
    span.className = "dockview-groupcontrol-demo-group-active";

    this._element.appendChild(span);

    const d1 = group.api.onDidActiveChange(() => {
      span.style.background = group.api.isActive ? "green" : "red";
      span.innerText = `${group.api.isActive ? "Group Active" : "Group Inactive"}`;
    });

    span.style.background = group.api.isActive ? "green" : "red";
    span.innerText = `${group.api.isActive ? "Group Active" : "Group Inactive"}`;

    this._disposables.push(() => d1.dispose());
  }

  dispose(): void {
    this._disposables.forEach((dispose) => dispose());
  }
}

class LeftHeaderActions implements IHeaderActionsRenderer {
  private readonly _element: HTMLElement;
  private readonly _disposables: (() => void)[] = [];

  get element(): HTMLElement {
    return this._element;
  }

  constructor(group: DockviewGroupPanel) {
    console.log("group", group);
    this._element = document.createElement("div");
    this._element.className = "dockview-groupcontrol-demo";
  }

  init(parameters: IGroupHeaderProps): void {
    const group = parameters.group;

    const span = document.createElement("span");
    span.className = "dockview-groupcontrol-demo-active-panel";

    this._element.appendChild(span);

    const d1 = group.api.onDidActivePanelChange((event) => {
      console.log("event", event);
      span.innerText = `activePanel: ${event.panel?.id || "null"}`;
    });

    console.log("group.activePanel", group.activePanel);

    span.innerText = `activePanel: ${group.activePanel?.id || "null"}`;

    this._disposables.push(() => d1.dispose());
  }

  dispose(): void {
    this._disposables.forEach((dispose) => dispose());
  }
}

export default function init() {
  console.log("init");
  const root = document.getElementById("editor")!;
  // const view = createGridview(root, {
  //   createComponent,
  //   orientation: Orientation.VERTICAL,
  //   hideBorders: false,
  // });
  const view = createDockview(root, {
    disableFloatingGroups: true,
    className: "dockview-theme-abyss",
    createComponent: (options) => {
      return new Panel();
    },
    createTabComponent: (options) => {
      // return undefined;
      //   return;
      //   // switch (options.name) {
      //   //   case "default":
      return new CustomTab();
      //   // }
    },
    // createPrefixHeaderActionComponent: (group): IHeaderActionsRenderer => {
    //   return new PrefixHeader(group);
    // },
    // createLeftHeaderActionComponent: (group): IHeaderActionsRenderer => {
    //   return new LeftHeaderActions(group);
    // },
    // createRightHeaderActionComponent: (group): IHeaderActionsRenderer => {
    //   return new RightHeaderActions(group);
    // },
  });

  view.addPanel({
    id: "panel_1",
    component: "default",
    tabComponent: "default",
    // title: "PPPP 1",
    params: {
      myValue: Date.now(),
    },
  });

  view.addPanel({
    id: "panel_2",
    component: "default",
    tabComponent: "default",
    position: { referencePanel: "panel_1", direction: "right" },
    // title: "Panel 2",
    params: {
      myValue: Date.now(),
    },
  });

  view.addPanel({
    id: "panel_3",
    component: "default",
    // title: "Panel 1",
  });

  view.addPanel({
    id: "panel_4",
    component: "default",
    // title: "Panel 2",
    position: {
      direction: "right",
    },
  });

  view.addPanel({
    id: "panel_5",
    component: "default",
    // title: "Panel 3",
    position: {
      direction: "below",
    },
  });

  // const editor = view.addPanel({ id: "editor", component: "editor", params: { test: 1 } });
  // const fs = view.addPanel({
  //   id: "filesystem",
  //   component: "filesystem",
  //   params: {},
  //   position: { referencePanel: "editor", direction: "left" },
  // });
  // view.addPanel({
  //   id: "terminal",
  //   component: "terminal",
  //   params: {},
  //   position: { referencePanel: "code", direction: "below" },
  // });
  // view.layout(document.body.clientWidth, document.body.clientHeight);
}
