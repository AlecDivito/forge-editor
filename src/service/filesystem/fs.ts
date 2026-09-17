"use server";

import { readdir, stat, readFile } from "fs/promises";
import * as path from "path";

// A basic MIME type map (extend as needed)
const extensionToMimeType: Record<string, string> = {
  ".txt": "text/plain",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".js": "application/javascript",
  ".ts": "application/typescript",
  ".html": "text/html",
  ".css": "text/css",
  ".md": "text/markdown",
  // add more as needed
};

export interface FileSystemEntry {
  name: string;
  isDirectory: boolean;
  fullPath: string;
  mimeType?: string; // Only for files
}

export class FileSystemService {
  /**
   * Lists the files and folders in a directory with basic metadata.
   */
  async listDirectory(dirPath: string): Promise<FileSystemEntry[]> {
    const entries = await readdir(dirPath);
    const detailedEntries: FileSystemEntry[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      const entryStat = await stat(fullPath);
      const ext = path.extname(entry);
      const mimeType = entryStat.isDirectory()
        ? undefined
        : extensionToMimeType[ext.toLowerCase()] || "application/octet-stream";

      detailedEntries.push({
        name: entry,
        isDirectory: entryStat.isDirectory(),
        fullPath,
        mimeType,
      });
    }

    return detailedEntries;
  }

  /**
   * Returns the raw content of a file as bytes (Buffer) and MIME type.
   */
  async getFileContent(filePath: string): Promise<{ content: Buffer; mimeType: string }> {
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    const mimeType = extensionToMimeType[ext.toLowerCase()] || "application/octet-stream";

    return {
      content,
      mimeType,
    };
  }
}
