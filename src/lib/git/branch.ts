import { GenericGitProject, getRepoPrefix } from ".";
import { getFile, listFiles, saveFile } from "../s3";

export interface Branch {
  head: string;
  name: string;
}

export type BranchList = string[];

export class GitRepositoryBranch extends GenericGitProject {
  constructor(userName: string, projectName: string) {
    super(userName, projectName);
  }

  async listBranches(): Promise<BranchList> {
    const path = this.getPath();
    const branches = await listFiles(path);
    const shortenBranches = branches.map((branch) => branch.replace(`${path}/`, ""));
    return shortenBranches;
  }

  async getBranch(branch: string): Promise<Branch | undefined> {
    const branchSha = await getFile(this.getLocalBranchPath(branch));
    if (!branchSha) {
      return undefined;
    }
    return {
      head: branchSha,
      name: branch,
    };
  }

  /// Return the SHA of the new branch
  async createBranch(fromBranch: string, intoBranch: string): Promise<Branch> {
    const fromBranchSha = await getFile(this.getLocalBranchPath(fromBranch));
    if (!fromBranchSha) {
      throw new Error(`${fromBranch} does not exist in the system`);
    }
    await saveFile(this.getLocalBranchPath(intoBranch), fromBranchSha);

    return {
      head: fromBranchSha,
      name: intoBranch,
    };
  }

  private getPath(): string {
    const prefix = getRepoPrefix(this.userName, this.projectName);
    return `${prefix}/refs`;
  }

  private getLocalBranchPath(branch: string): string {
    // Currently only heads are supported. In the future we'll work
    // toward support remote and such.
    const configPath = `${this.getPath()}/heads/${branch}`;
    return configPath;
  }
}
