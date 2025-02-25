import { deleteFile, getFile, listFiles, saveFile } from "./s3";
import { createHash } from "crypto";

export interface Repository {
  userName: string;
  projectName: string;
  defaultBranch: string;
  branches: string[];
  commitHistory;
}

/** Generates S3 path prefix for a repository */
const getRepoPrefix = (userName: string, projectName: string) => `users/${userName}/${projectName}/repo/`;

/** Generates S3 path for a given file inside a repo */
const getFilePath = (userName: string, projectName: string, filePath: string, version = DEFAULT_BRANCH) =>
  `${getRepoPrefix(userName, projectName)}files/${filePath}@${version}`;

/** Get's a repository */
export const getRepository = async (userName: string, projectName: string): Promise<Repository | undefined> => {
  const repoPrefix = getRepoPrefix(userName, projectName);
  const configPath = `${repoPrefix}config`;

  // 1. Check if repository exists
  const configContent = await getFile(configPath, "latest");
  if (!configContent) {
    return undefined;
  }

  // Parse repository config
  const config = JSON.parse(configContent);

  // 2. Get list of branches
  const branches = await getBranches(userName, projectName);

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

/** Creates a new repository */
export const createRepository = async (userName: string, projectName: string) => {
  const repoPath = getRepoPrefix(userName, projectName);
  await saveFile(
    `${repoPath}config`,
    "latest",
    JSON.stringify({ userName, projectName, defaultBranch: DEFAULT_BRANCH }),
  );
  await saveFile(`${repoPath}refs/HEAD`, "latest", DEFAULT_BRANCH);
  return { message: "Repository created", projectName };
};

/** Deletes a repository */
export const deleteRepository = async (userName: string, projectName: string) => {
  const repoPath = getRepoPrefix(userName, projectName);
  const files = await listFiles(repoPath);
  for (const file of files) {
    await deleteFile(file, "latest");
  }
  return { message: "Repository deleted", projectName };
};

/** Add a file */
export const addFile = async (
  userName: string,
  projectName: string,
  branchName: string,
  filePath: string,
  content: string,
) => {
  const stagingPath = `${getRepoPrefix(userName, projectName)}staging/${branchName}/${filePath}`;
  await saveFile(stagingPath, "staged", content);

  return { message: "File added to staging", filePath, branch: branchName };
};

export const getStagedFiles = async (userName: string, projectName: string, branchName: string): Promise<string[]> => {
  const stagingPath = `${getRepoPrefix(userName, projectName)}staging/${branchName}/`;
  const stagedFiles = await listFiles(stagingPath);
  return stagedFiles.map((fileKey) => fileKey.replace(stagingPath, ""));
};

export const clearStaging = async (userName: string, projectName: string, branchName: string) => {
  const stagingPath = `${getRepoPrefix(userName, projectName)}staging/${branchName}/`;
  const stagedFiles = await listFiles(stagingPath);

  for (const fileKey of stagedFiles) {
    await deleteFile(fileKey, "staged");
  }

  return { message: "Staging area cleared", branch: branchName };
};

/** Commits a file */
export const commitChanges = async (
  userName: string,
  projectName: string,
  branchName: string,
  commitMessage: string,
) => {
  const repoPrefix = getRepoPrefix(userName, projectName);
  const branchPrefix = `${repoPrefix}branches/${branchName}/`;
  const stagedFiles = await getStagedFiles(userName, projectName, branchName);

  if (stagedFiles.length === 0) {
    throw new Error("No files to commit.");
  }

  // Get previous commit ID
  const previousCommitID = (await getFile(`${repoPrefix}refs/${branchName}`, "latest")) || "";

  // Generate commit ID
  const commitData = `${stagedFiles.join(",")}-${branchName}-${commitMessage}-${new Date().toISOString()}-${previousCommitID}`;
  const commitID = createHash("sha1").update(commitData).digest("hex");

  // Move staged files to commit history
  for (const filePath of stagedFiles) {
    const stagedFilePath = `${repoPrefix}staging/${branchName}/${filePath}`;
    const fileContent = await getFile(stagedFilePath, "staged");

    if (fileContent) {
      const fileCommitPath = `${branchPrefix}files/${filePath}@${commitID}`;
      await saveFile(fileCommitPath, commitID, fileContent);
    }
  }

  // Update branch HEAD
  await saveFile(`${repoPrefix}refs/${branchName}`, "latest", commitID);

  // Store commit metadata
  const commit = {
    commitID,
    files: stagedFiles,
    commitMessage,
    timestamp: new Date().toISOString(),
    branch: branchName,
    previousCommit: previousCommitID,
  };
  await saveFile(`${branchPrefix}commits.json`, "latest", JSON.stringify(commit, null, 2));

  // Clear staging area
  await clearStaging(userName, projectName, branchName);

  return { message: "Commit successful", commit };
};

/** Retrieves commit history */
export const getCommitHistory = async (userName: string, projectName: string, branchName: string, limit = 10) => {
  const branchPrefix = `${getRepoPrefix(userName, projectName)}branches/${branchName}/`;
  const commitHistoryContent = await getFile(`${branchPrefix}commits.json`, "latest");

  if (!commitHistoryContent) {
    return [];
  }

  const allCommits = JSON.parse(commitHistoryContent);
  return allCommits.slice(-limit); // Return the latest `limit` commits
};

/** Creates a new branch from an existing branch */
export const createBranch = async (
  userName: string,
  projectName: string,
  branchName: string,
  baseBranch = DEFAULT_BRANCH,
) => {
  await saveFile(`${getRepoPrefix(userName, projectName)}refs/${branchName}`, "latest", baseBranch);
  return { message: `Branch ${branchName} created from ${baseBranch}` };
};

/** Lists branches */
export const getBranches = async (userName: string, projectName: string) => {
  const branches = await listFiles(`${getRepoPrefix(userName, projectName)}refs/`);
  return branches.map((branch) => branch.split("/").pop());
};

/** Uploads a file (without committing) */
export const uploadFile = async (userName: string, projectName: string, filePath: string, content: string) => {
  await saveFile(getFilePath(userName, projectName, filePath), DEFAULT_BRANCH, content);
  return { message: "File uploaded", filePath };
};

/** Retrieves file content */
export const getFileContent = async (
  userName: string,
  projectName: string,
  filePath: string,
): Promise<string | undefined> => {
  return await getFile(getFilePath(userName, projectName, filePath), DEFAULT_BRANCH);
};

/** Lists all repository files */
export const listRepositoryFiles = async (userName: string, projectName: string): Promise<(string | undefined)[]> => {
  const fileKeys = await listFiles(`${getRepoPrefix(userName, projectName)}files/`);
  return fileKeys.map((fileKey) => fileKey.split("/").pop());
};

/** Retrieves repository statistics */
export const getRepositoryStats = async (userName: string, projectName: string) => {
  const commits = await getCommitHistory(userName, projectName);
  const branches = await getBranches(userName, projectName);
  const files = await listRepositoryFiles(userName, projectName);
  return { totalCommits: commits.length, totalBranches: branches.length, totalFiles: files.length };
};
