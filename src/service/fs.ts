"use server";

import { applyChanges } from "@/interfaces/socket";
import redis from "@/lib/redis";

export interface Change {
  id: string;
  op: "insert" | "delete" | "noop";
  pos: number;
  text: string;
  timestamp: number;
  // user: user_id
}

export interface Metadata {
  version: number;
  lastModified: number;
  size: number;
}

export interface File {
  path: string;
  content: string;
  changes: Change[];
  metadata?: Metadata;
}

/**
 * Create or update a file in Redis.
 * @param path - The path of the file.
 * @param content - The content of the file.
 */
export async function saveFile(path: string, content: string): Promise<void> {
  try {
    await redis.set(`fs:file:${path}`, content);
  } catch (error) {
    console.error("Error saving file:", error);
    throw new Error("Failed to save file.");
  }
}

export async function saveFileEdit(path: string, changes: Change[]) {
  try {
    // Fetch existing changes from Redis
    const existingChanges = JSON.parse(
      (await redis.get(`fs:ops:${path}`)) || "[]"
    );

    // Merge new changes into the existing changes
    const updatedChanges = [...existingChanges, ...changes];
    await redis.set(`fs:ops:${path}`, JSON.stringify(updatedChanges));

    // Update metadata for tracking version and lastModified
    const metadata = JSON.parse((await redis.get(`fs:meta:${path}`)) || "{}");
    const updatedMetadata = {
      version: (metadata.version || 0) + 1, // Increment version
      lastModified: Date.now(), // Update last modified timestamp
    };
    await redis.set(`fs:meta:${path}`, JSON.stringify(updatedMetadata));

    console.log(
      `Saved edits for ${path}. Total edits: ${updatedChanges.length}`
    );
  } catch (error) {
    console.error(`Error saving file edits for ${path}:`, error);
  }
}

export async function consolidateFileEdits(path: string): Promise<{
  content: string;
  metadata: Metadata;
}> {
  // Get the current file and its edits
  const file = await getFile(path);
  const changes = JSON.parse((await redis.get(`fs:ops:${path}`)) || "[]");

  // Apply all changes to consolidate the content
  const consolidatedContent = applyChanges(file.content, changes);

  // Save the consolidated content and clear the change log
  await saveFile(path, consolidatedContent);
  await redis.del(`fs:ops:${path}`);

  // Update metadata
  const metadata = {
    version: (file.metadata?.version || 0) + 1,
    lastModified: Date.now(),
    size: consolidatedContent.length,
  };
  await redis.set(`fs:meta:${path}`, JSON.stringify(metadata));

  // Broadcast the updated file content
  return { content: consolidatedContent, metadata };
}

/**
 * Delete a file in Redis.
 * @param path - The path of the file.
 */
export async function deleteFile(path: string): Promise<void> {
  try {
    const result = await redis.del(
      `fs:file:${path}`,
      `fs:ops:${path}`,
      `fs:meta:${path}`
    );
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
    const keys = await redis.keys(`fs:file:${path}*`); // Only return files that match the path pattern
    return keys.map((key) => key.slice(8));
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
    const content = await redis.get(`fs:file:${path}`);
    const rawChanges = await redis.get(`fs:ops:${path}`);
    const rawMetadata = await redis.get(`fs:meta:${path}`);
    let changes = [];
    if (rawChanges) {
      changes = JSON.parse(rawChanges);
    }
    let metadata = undefined;
    if (rawMetadata) {
      metadata = JSON.parse(rawMetadata);
    }
    if (content === null) {
      throw new Error(`File '${path}' not found.`);
    }
    return { path, content, changes, metadata };
  } catch (error) {
    console.error("Error fetching file:", error);
    throw new Error("Failed to fetch file.");
  }
}
