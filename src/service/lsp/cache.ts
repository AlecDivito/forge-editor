import redis from "@/lib/redis";
import { createFile, deleteFile, readFile } from "../fs";

interface TextDocument {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

interface ChangeEvent {
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  rangeLength?: number;
  text: string;
}

export class CacheManager {
  private project: string;
  private bucket: string;

  constructor(bucket: string, project: string) {
    this.bucket = bucket;
    this.project = project;
  }

  async createDocument(uri: string): Promise<TextDocument> {
    const key = this.getCacheKey(uri);

    const file = await readFile(this.bucket, uri);
    if (file) {
      throw new Error(
        "Failed to create new document because it already exists"
      );
    }

    await createFile(this.bucket, uri);
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
    await deleteFile(this.bucket, uri);
  }

  async getDocument(uri: string): Promise<TextDocument> {
    const key = this.getCacheKey(uri);
    let cachedDoc = await redis.get(key);

    if (!cachedDoc) {
      console.log(`Cache miss for ${uri}. Fetching from S3...`);
      const text = await this.fetchFromS3(uri);
      cachedDoc = JSON.stringify({
        uri,
        languageId: this.getLanguageFromUri(uri),
        version: 1,
        text,
      });
      await redis.set(key, cachedDoc);
    }

    return JSON.parse(cachedDoc);
  }

  async syncAllToS3(): Promise<void> {
    const keys = await redis.keys(`fs:file:${this.project}:*`);
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

  async applyChanges(
    uri: string,
    version: number,
    changes: ChangeEvent[]
  ): Promise<void> {
    const key = this.getCacheKey(uri);
    const cachedDoc = await this.getDocument(uri);

    if (version <= cachedDoc.version) {
      throw new Error(
        `Incoming version ${version} is older than cached version ${cachedDoc.version}`
      );
    }

    for (const change of changes) {
      if (!change.range) {
        cachedDoc.text = change.text;
      } else {
        cachedDoc.text = this.applyIncrementalChange(cachedDoc.text, change);
      }
    }

    cachedDoc.version = version;
    await redis.set(key, JSON.stringify(cachedDoc)); // No TTL set
  }

  private applyIncrementalChange(content: string, change: ChangeEvent): string {
    if (!change.range) return change.text;
    const { start, end } = change.range;
    const lines = content.split("\n");
    const startIndex = this.getAbsoluteIndex(
      lines,
      start.line,
      start.character
    );
    const endIndex = this.getAbsoluteIndex(lines, end.line, end.character);
    return content.slice(0, startIndex) + change.text + content.slice(endIndex);
  }

  private getAbsoluteIndex(
    lines: string[],
    line: number,
    character: number
  ): number {
    let index = 0;
    for (let i = 0; i < line; i++) {
      index += lines[i].length + 1;
    }
    return index + character;
  }

  private async uploadToS3(uri: string, content: string): Promise<void> {
    try {
      await createFile(this.bucket, uri, content);
      console.log(`Successfully uploaded ${uri} to S3.`);
    } catch (error) {
      console.error(`Failed to upload ${uri} to S3`, error);
    }
  }

  private async fetchFromS3(uri: string): Promise<string> {
    try {
      const response = await readFile(this.bucket, uri);
      return response || "";
    } catch (error) {
      console.error(`Failed to fetch ${uri} from S3`, error);
      return "";
    }
  }

  private getCacheKey(uri: string): string {
    return `fs:file:${this.project}:${uri}`;
  }

  private getLanguageFromUri(uri: string): string {
    return uri.split(".").pop() || "";
  }
}
