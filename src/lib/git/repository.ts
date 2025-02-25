import { DEFAULT_BRANCH, GenericGitProject, getRepoPrefix, Repository } from ".";
import { GitRepositoryBranch } from "./branch";
import { GitConfig } from "./config";
import { GitRepositoryHead } from "./head";
import { GitRepositoryStaging } from "./staging";

export class GitRepository extends GenericGitProject {
  constructor(userName: string, projectName: string) {
    super(userName, projectName);
  }

  async getRepository(branch: string = DEFAULT_BRANCH): Promise<Repository | undefined> {
    const configService = new GitConfig(this.userName, this.projectName);
    const headService = new GitRepositoryHead(this.userName, this.projectName);
    const branchService = new GitRepositoryBranch(this.userName, this.projectName);
    const fileService = new GitRepositoryStaging(this.userName, this.projectName);

    const [config, head] = [configService.getRepositryConfig(), headService.getRepositryConfig()];
    if (!config || !head) {
      return undefined;
    }

    const branch = branchService.getBranch(branch);

    const branches = branchService.listBranches();

    const stagingFiles = fileService.listStagedFiles(branch);
  }
}

export const getRepository = async (userName: string, projectName: string): Promise<Repository | undefined> => {
  // 3. Get commit history
  const commitHistory = await getCommitHistory(userName, projectName);

  // 4. Get file list
  const files = await listRepositoryFiles(userName, projectName);

  // 5. Get repository stats
  const stats = {
    totalCommits: commitHistory.length,
    totalBranches: branches.length,
    totalFiles: files.length,
  };

  return {
    userName,
    projectName,
    defaultBranch: config.defaultBranch || DEFAULT_BRANCH,
    branches,
    commitHistory,
    files,
    stats,
  };
};
