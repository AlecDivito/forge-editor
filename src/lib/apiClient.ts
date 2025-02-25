export type FileItem = {
  path: string;
  name: string;
  type: "file" | "directory";
};

export type File = {
  path: string;
  content: string;
};

export type Save = {
  path: string;
  status: string;
};

export type MergeConflict = {
  path: string;
  differences: string[];
};

const API_BASE = "http://localhost:3000/api/fs";

export class FileSystemClient {
  static async listFiles(directory: string, version?: string): Promise<FileItem[]> {
    const query = new URLSearchParams({ directory });
    if (version) query.append("version", version);
    const response = await fetch(`${API_BASE}?${query.toString()}`);
    if (!response.ok) throw new Error("Failed to fetch file list");
    return response.json();
  }

  static async getFile(path: string, version?: string): Promise<File> {
    const query = new URLSearchParams({ path });
    if (version) query.append("version", version);
    const response = await fetch(`${API_BASE}?${query.toString()}`);
    if (!response.ok) throw new Error("Failed to fetch file");
    return response.json();
  }

  static async saveFiles(version: string, files: File[]): Promise<Save[]> {
    const response = await fetch(`${API_BASE}?version=${version}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(files),
    });
    if (!response.ok) throw new Error("Failed to save files");
    return response.json();
  }

  static async deleteFile(path: string, version: string): Promise<void> {
    const query = new URLSearchParams({ path, version });
    const response = await fetch(`${API_BASE}?${query.toString()}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Failed to delete file");
  }

  static async getFileVersions(path: string): Promise<string[]> {
    const query = new URLSearchParams({ path });
    const response = await fetch(`${API_BASE}/versions?${query.toString()}`);
    if (!response.ok) throw new Error("Failed to fetch versions");
    return response.json();
  }

  static async mergeFiles(baseVersion: string, targetVersion: string, dryRun: boolean): Promise<MergeConflict[]> {
    const response = await fetch(`${API_BASE}/merge?dryrun=${dryRun}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseVersion, targetVersion }),
    });
    if (!response.ok) {
      if (response.status === 409) {
        return response.json();
      }
      throw new Error("Failed to merge files");
    }
    return response.json();
  }
}
