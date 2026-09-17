interface VirtualEditorConfiguration {
  windows: {
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
    floating: boolean;
  }[];
}

export class ConfigurationService {
  constructor(
    private readonly userName: string,
    private readonly workspace: string,
  ) {}

  // update()
}
