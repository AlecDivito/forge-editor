import { join, isAbsolute, normalize } from "node:path";
import { stat, readdir } from "fs/promises";
import { mkdir } from "node:fs/promises";

export interface DirectoryEntry {
  ty: "f" | "d";
  name: string;
  path: string;
}

// TODO(Alec): Consider implementing the file system provider for different systems
// such as S3.
export class FileSystemProvider {
  root: string;
  defaultPath: string;
  absoluteRoot: string;

  constructor(userName: string, projectName: string) {
    if (!process.env.ROOT_PROJECT_DIRECTORY) {
      throw new Error("Root project directory not provided");
    }
    this.root = process.env.ROOT_PROJECT_DIRECTORY;
    this.defaultPath = `${userName}/${projectName}`;
    this.absoluteRoot = join(this.root, this.defaultPath);
  }

  async listOrCreate(directoryPath: string = "/"): Promise<DirectoryEntry[]> {
    // If no path is provided, use a default or throw an error
    const resolvedPath = !!directoryPath ? join(this.absoluteRoot, directoryPath) : this.absoluteRoot;

    if (!this.directoryExists(resolvedPath)) {
      await mkdir(resolvedPath, { recursive: true });
      console.log("created directories for " + resolvedPath);
    } else {
      await mkdir(resolvedPath, { recursive: true });
    }

    const directories = await this.list(directoryPath);
    return directories;
  }

  async list(directoryPath: string = "/"): Promise<DirectoryEntry[]> {
    // If no path is provided, use a default or throw an error
    const resolvedPath = !!directoryPath ? join(this.absoluteRoot, directoryPath) : this.absoluteRoot;

    // Check if path is absolute
    if (!isAbsolute(resolvedPath)) {
      throw new Error(`Path must be absolute. Received: ${resolvedPath}`);
    }

    // Normalize to remove redundant slashes, etc.
    const normalizedPath = normalize(resolvedPath);

    // Check for backward references
    // (this is a simple check; for more robust security, additional validation may be needed)
    if (normalizedPath.includes("..")) {
      throw new Error(`Path cannot contain '..'. Received: ${normalizedPath}`);
    }

    // Read the directory asynchronously
    const dirEntries = await readdir(normalizedPath, { withFileTypes: true });

    // Gather file stats for each entry
    const result: DirectoryEntry[] = (
      await Promise.all(
        dirEntries.map(async (entry) => {
          const entryPath = join(normalizedPath, entry.name);
          const stats = await stat(entryPath);
          let ty;
          if (stats.isFile()) {
            ty = "f";
          } else if (stats.isSymbolicLink()) {
            ty = "d";
            // } else if (stats.isSymbolicLink()) {
            //   ty = "s";
          } else {
            return undefined;
          }

          return {
            ty,
            name: entry.name,
            path: entryPath.replace(this.absoluteRoot, "/"),
          } as DirectoryEntry;
        }),
      )
    ).filter((o) => o !== undefined);

    return result;
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await stat(dirPath);
      return stats.isDirectory();
    } catch {
      // If fs.stat throws, the path doesn't exist or can't be accessed.
      return false;
    }
  }
}
