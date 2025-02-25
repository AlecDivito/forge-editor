import { DEFAULT_BRANCH, GenericGitProject, getRepoPrefix, RepositoryHead } from ".";
import { getFile, saveFile } from "../s3";

export class GitRepositoryHead extends GenericGitProject {
  constructor(userName: string, projectName: string) {
    super(userName, projectName);
  }

  async getRepositryConfig(): Promise<RepositoryHead | undefined> {
    const configContent = await getFile(this.getPath());
    if (!configContent) {
      return undefined;
    }
    return configContent;
  }

  async createDefaultRepositoryConfig(): Promise<RepositoryHead> {
    const defaultHead: RepositoryHead = `refs/heads/${DEFAULT_BRANCH}`;

    const path = this.getPath();
    await saveFile(path, defaultHead);

    return defaultHead;
  }

  private getPath(): string {
    const prefix = getRepoPrefix(this.userName, this.projectName);
    const configPath = `${prefix}/HEAD`;
    return configPath;
  }
}
