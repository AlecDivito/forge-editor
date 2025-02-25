import { GenericGitProject, getRepoPrefix, RepositoryConfig } from ".";
import { getFile, saveFile } from "../s3";

export class GitConfig extends GenericGitProject {
  constructor(userName: string, projectName: string) {
    super(userName, projectName);
  }

  async getRepositryConfig(): Promise<RepositoryConfig | undefined> {
    const configContent = await getFile(this.getPath());
    if (!configContent) {
      return undefined;
    }
    const config = JSON.parse(configContent) as RepositoryConfig;
    return config;
  }

  async createDefaultRepositoryConfig(): Promise<RepositoryConfig> {
    const defaultSettings: RepositoryConfig = {
      core: {
        repositoryformatversion: 0,
        filemode: true,
        bare: false,
        logallrefupdates: true,
        ignorecase: true,
        precomposeunicode: true,
      },
    };

    const content = JSON.stringify(defaultSettings);
    const path = this.getPath();
    await saveFile(path, content);

    return defaultSettings;
  }

  private getPath(): string {
    const prefix = getRepoPrefix(this.userName, this.projectName);
    const configPath = `${prefix}/config`;
    return configPath;
  }
}
