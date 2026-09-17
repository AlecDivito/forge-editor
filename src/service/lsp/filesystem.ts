import { writeFile, mkdir, readFile } from "fs/promises";
import { TextDocument } from "./cache";
import { join, parse } from "path";

export class FileSystemManager {
  constructor(private readonly baseDirectory: string = process.env.ROOT_PROJECT_DIRECTORY || "/") {}

  getFilePath(path: string) {
    return parse(join(this.baseDirectory, path));
  }

  async readFile(path: string): Promise<Buffer<ArrayBufferLike>> {
    const file = await readFile(path);
    return file;
  }

  async createFile(path: string): Promise<TextDocument> {
    const absolutePath = this.getFilePath(path);
    await mkdir(absolutePath.dir, { recursive: true });
    await writeFile(join(absolutePath.dir, absolutePath.base), "");
    const document = {
      uri: `file://${path}`,
      languageId: absolutePath.ext,
      version: 1,
      text: "",
    };
    return document;
  }

  async saveFile(path: string, text: string): Promise<void> {
    const absolutePath = this.getFilePath(path);
    await writeFile(join(absolutePath.dir, absolutePath.base), text, { flush: true });
  }

  async createFolder(path: string): Promise<TextDocument> {
    const absolutePath = parse(join(this.baseDirectory, path));
    await mkdir(absolutePath.dir, { recursive: true });
    const document = {
      uri: `file://${path}`,
      languageId: absolutePath.ext,
      version: 1,
      text: "",
    };
    return document;
  }

  async delete(path: string): Promise;
}
