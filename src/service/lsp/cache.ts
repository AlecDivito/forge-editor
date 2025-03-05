import redis from "@/lib/redis";
import { TextDocumentContentChangeEvent } from "vscode-languageserver-protocol";
import { readFile, writeFile, rm } from "fs/promises";
import path from "path";

export interface TextDocument {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export class CacheManager {
  private workspace: string;
  private bucket: string;

  constructor(bucket: string, workspace: string) {
    this.bucket = bucket;
    this.workspace = workspace;
  }

  async createDocument(uri: string): Promise<TextDocument> {
    const key = this.getCacheKey(uri);
    const absolutePath = path.join(process.env.ROOT_PROJECT_DIRECTORY, uri);

    const file = await readFile(absolutePath);
    if (file) {
      throw new Error("Failed to create new document because it already exists");
    }

    await writeFile(absolutePath, "");
    const cachedDoc = JSON.stringify({
      uri,
      languageId: this.getLanguageFromUri(uri),
      version: 1,
      text: "",
    });
    await redis.set(key, cachedDoc);

    return JSON.parse(cachedDoc);
  }

  async deleteDocument(uri: string): Promise<void> {
    const key = this.getCacheKey(uri);
    await redis.del(key);
    await rm(uri);
  }

  getFileExtension = (filename?: string): string => {
    const parts = filename?.split(".") || [];
    const exts: { [key: string]: string } = {
      go: "go",
      rs: "rust",
      json: "json",
      js: "javascript",
      ts: "typescript",
      md: "markdown",
    };
    const extension = parts.length > 1 ? parts.pop() : undefined;
    if (extension && extension in exts) {
      return exts[extension];
    } else {
      return "text";
    }
  };

  async getDocument(uri: string): Promise<TextDocument> {
    const key = this.getCacheKey(uri);
    const absolutePath = path.join(process.env.ROOT_PROJECT_DIRECTORY, uri);
    let cachedDoc = await redis.get(key);

    if (!cachedDoc) {
      console.log(`[INFO] Cache miss for ${uri}. Fetching from file system...`);
      const text = await readFile(absolutePath);
      // const text = await this.fetchFromS3(uri);
      cachedDoc = JSON.stringify({
        uri,
        languageId: this.getFileExtension(uri.split(".")?.pop()),
        version: 1,
        // TODO(Alec): This might not be a string. How can we estimate
        // what the file type is.
        text: text.toString(),
      });
      await redis.set(key, cachedDoc);
    }

    return JSON.parse(cachedDoc);
  }

  async syncAllToS3(): Promise<void> {
    const keys = await redis.keys(`fs:file:${this.workspace}:*`);
    for (const key of keys) {
      this.syncDocumentToS3(key);
    }
    console.log("All documents synced to S3 and removed from cache.");
  }

  async syncDocumentToS3(uri: string): Promise<void> {
    const key = this.getCacheKey(uri);
    const document = await redis.get(key);
    if (document) {
      const parsed = JSON.parse(document) as TextDocument;
      await this.uploadToS3(parsed.uri, parsed.text);
      await redis.del(key);
    }
    console.log(`Successfully synced ${uri} to S3`);
  }

  async applyChanges(uri: string, version: number, changes: TextDocumentContentChangeEvent[]): Promise<void> {
    const key = this.getCacheKey(uri);
    const cachedDoc = await this.getDocument(uri);

    if (version <= cachedDoc.version) {
      throw new Error(`Incoming version ${version} is older than cached version ${cachedDoc.version}`);
    }

    for (const change of changes) {
      if ("range" in change) {
        cachedDoc.text = CacheManager.applyIncrementalChange(cachedDoc.text, change);
      } else {
        cachedDoc.text = change.text;
      }
    }

    cachedDoc.version = version;
    await redis.set(key, JSON.stringify(cachedDoc)); // No TTL set
  }

  static applyAllIncrementalChanges(content: string, changes: TextDocumentContentChangeEvent[]): string {
    let string = content;
    for (const change of changes) {
      string = CacheManager.applyIncrementalChange(string, change);
    }
    return string;
  }

  static applyIncrementalChange(content: string, change: TextDocumentContentChangeEvent): string {
    if (!("range" in change)) return change.text;
    const { start, end } = change.range;
    const lines = content.split("\n");
    const startIndex = CacheManager.getAbsoluteIndex(lines, start.line, start.character);
    const endIndex = CacheManager.getAbsoluteIndex(lines, end.line, end.character);
    return content.slice(0, startIndex) + change.text + content.slice(endIndex);
  }

  static getAbsoluteIndex(lines: string[], line: number, character: number): number {
    let index = 0;
    for (let i = 0; i < line; i++) {
      index += lines[i].length + 1;
    }
    return index + character;
  }

  private async uploadToS3(uri: string, content: string): Promise<void> {
    try {
      const absolutePath = path.join(process.env.ROOT_PROJECT_DIRECTORY, uri);
      await writeFile(absolutePath, content);
      console.log(`Successfully uploaded ${uri} to S3.`);
    } catch (error) {
      console.error(`Failed to upload ${uri} to S3`, error);
    }
  }

  private async fetchFromS3(uri: string): Promise<string> {
    try {
      const absolutePath = path.join(process.env.ROOT_PROJECT_DIRECTORY, uri);
      const response = await readFile(absolutePath);
      return response.toString() || "";
    } catch (error) {
      console.error(`Failed to fetch ${uri} from S3`, error);
      return "";
    }
  }

  private getCacheKey(uri: string): string {
    return `fs:file:${this.workspace}:${uri}`;
  }

  private getLanguageFromUri(uri: string): string {
    return uri.split(".").pop() || "text";
  }
}
