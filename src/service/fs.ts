"use server";

import redis from "@/lib/redis";

export interface File {
  path: string;
  content: string;
}

/**
 * Create or update a file in Redis.
 * @param path - The path of the file.
 * @param content - The content of the file.
 */
export async function saveFile(path: string, content: string): Promise<void> {
  try {
    await redis.set(path, content);
  } catch (error) {
    console.error("Error saving file:", error);
    throw new Error("Failed to save file.");
  }
}

/**
 * Delete a file in Redis.
 * @param path - The path of the file.
 */
export async function deleteFile(path: string): Promise<void> {
  try {
    const result = await redis.del(path);
    if (!result) {
      throw new Error(`File '${path}' not found.`);
    }
  } catch (error) {
    console.error("Error deleting file:", error);
    throw new Error("Failed to delete file.");
  }
}

/**
 * Get a list of files that match the given path pattern.
 * @param path - The path pattern to search for.
 * @returns A list of files matching the pattern.
 */
export async function getFilePaths(path: string): Promise<string[]> {
  try {
    const keys = await redis.keys(`${path}*`); // Only return files that match the path pattern
    return keys;
  } catch (error) {
    console.error("Error fetching files:", error);
    throw new Error("Failed to fetch files.");
  }
}

/**
 * Get a single file by exact path.
 * @param path - The exact path of the file.
 * @returns The path and content of the file if found.
 */
export async function getFile(path: string): Promise<File> {
  try {
    const content = await redis.get(path);
    if (content === null) {
      throw new Error(`File '${path}' not found.`);
    }
    return { path, content };
  } catch (error) {
    console.error("Error fetching file:", error);
    throw new Error("Failed to fetch file.");
  }
}
