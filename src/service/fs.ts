"use server";

import redis from "@/lib/redis";
import { s3 } from "@/lib/s3";
import { NoSuchKey } from "@aws-sdk/client-s3";
import { existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { TextDocument } from "./lsp/cache";

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

// export async function consolidateFileEdits(path: string): Promise<{
//   content: string;
//   metadata: Metadata;
// }> {
//   // Get the current file and its edits
//   const file = await getFile(path);
//   const changes = JSON.parse((await redis.get(`fs:ops:${path}`)) || "[]");

//   // Apply all changes to consolidate the content
//   const consolidatedContent = applyChanges(file.content, changes);

//   // Save the consolidated content and clear the change log
//   await saveFile(path, consolidatedContent);
//   await redis.del(`fs:ops:${path}`);

//   // Update metadata
//   const metadata = {
//     version: (file.metadata?.version || 0) + 1,
//     lastModified: Date.now(),
//     size: consolidatedContent.length,
//   };
//   await redis.set(`fs:meta:${path}`, JSON.stringify(metadata));

//   // Broadcast the updated file content
//   return { content: consolidatedContent, metadata };
// }

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

export interface Folder {
  files: string[];
  directories: string[];
}

export async function listDirectoryFiles(
  bucketName: string,
  projectName: string
): Promise<Folder> {
  // List objects in the project folder
  const data = await s3.listObjectsV2({
    Bucket: bucketName,
    Prefix: `${projectName}/`,
    Delimiter: "/",
  });

  // Extract files and directories
  const files =
    data.Contents?.map((item) =>
      item.Key!.replace(`${projectName}/`, "")
    ).filter((key) => key && !key.endsWith("/")) || [];
  const directories =
    data.CommonPrefixes?.map((prefix) =>
      prefix.Prefix!.replace(`${projectName}/`, "").replace("/", "")
    ) || [];

  // Return tree structure
  return {
    files,
    directories,
  };
}

export async function downloadProject(
  bucketName: string,
  projectName: string,
  to: string
): Promise<void> {
  const objects = await s3.listObjectsV2({
    Bucket: bucketName,
    Prefix: `${projectName}/`,
    Delimiter: "/",
  });

  if (!objects.Contents) {
    console.warn("No files found in the specified S3 bucket and prefix.");
    return;
  }

  for (const object of objects.Contents) {
    if (!object.Key) continue;

    const getObjectParams = {
      Bucket: bucketName,
      Key: object.Key,
    };

    const relativePath = object.Key.replace(`${projectName}/`, "");
    const filePath = join(to, relativePath);

    console.log(`Reading ${object.Key} from S3 into ${filePath}`);
    // Ensure the directory exists
    const dirPath = dirname(filePath);
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
    }

    let content = "";
    const redisKey = `fs:file:${projectName}:${object.Key}`;
    const document = await redis.get(redisKey);
    if (document) {
      const parsed = JSON.parse(document) as TextDocument;
      content = parsed.text;
    } else {
      const fileData = await s3.getObject(getObjectParams);
      if (fileData?.Body) {
        content = await fileData.Body.transformToString();
      }
    }
    await writeFile(filePath, content || "");
  }
}

export async function readFile(
  bucketName: string,
  path: string
): Promise<string | undefined> {
  try {
    const response = await s3.getObject({
      Bucket: bucketName,
      Key: path,
    });
    if (!response.Body) {
      return undefined;
    }

    const content = await response.Body.transformToString("utf-8");
    return content;
  } catch (error) {
    if (error instanceof NoSuchKey) {
      return undefined;
    }
    throw error;
  }
}

export async function createFile(
  bucketName: string,
  path: string,
  Body: string = ""
): Promise<void> {
  await s3.putObject({
    Bucket: bucketName,
    Key: path,
    Body,
  });
}

export async function deleteFile(
  bucketName: string,
  path: string
): Promise<void> {
  await s3.deleteObject({
    Bucket: bucketName,
    Key: path,
  });
}
