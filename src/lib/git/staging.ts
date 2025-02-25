import { GenericGitProject, getRepoPrefix } from ".";
import { getFile, listFiles, saveFile } from "../s3";

export type StagedFileList = string[];

export class GitRepositoryStaging extends GenericGitProject {
  constructor(userName: string, projectName: string) {
    super(userName, projectName);
  }

  async listStagedFiles(branch: string): Promise<StagedFileList> {
    const path = this.getStagingPath(branch);
    const files = await listFiles(path);
    return files.map((file) => file.replace(`${path}/`, ""));
  }

  async getStagedFile(branch: string, filePath: string): Promise<string | undefined> {
    return await getFile(this.getStagedFilePath(branch, filePath));
  }

  async stageFile(branch: string, filePath: string, content: string): Promise<void> {
    await saveFile(this.getStagedFilePath(branch, filePath), content);
  }

  private getStagingPath(branch: string): string {
    const prefix = getRepoPrefix(this.userName, this.projectName);
    return `${prefix}/staging/${branch}`;
  }

  private getStagedFilePath(branch: string, filePath: string): string {
    return `${this.getStagingPath(branch)}/${filePath}`;
  }
}
