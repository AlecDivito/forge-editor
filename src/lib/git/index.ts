export const DEFAULT_BRANCH = "main";

export interface Repository {
  userName: string;
  projectName: string;
  defaultBranch: string;
  branches: string[];
}

export interface RepositoryConfig {
  core: {
    repositoryformatversion: 0;
    filemode: boolean;
    bare: boolean;
    logallrefupdates: boolean;
    ignorecase: boolean;
    precomposeunicode: boolean;
  };
}

export type RepositoryHead = string;

export class GenericGitProject {
  constructor(
    protected userName: string,
    protected projectName: string,
  ) {}
}

export const getProjectPrefix = (userName: string, projectName: string) => `users/${userName}/${projectName}`;
export const getRepoPrefix = (u: string, p: string) => `${getProjectPrefix(u, p)}/repo`;
