import { saveInode, deleteInode } from "@/lib/redis";
import { readFile, saveFile, deleteFile, S3NotFound, DEFAULT_VERSION_NAME, listFiles } from "@/lib/s3";
import { NextResponse } from "next/server";

class InvalidPayload extends Error {}
class FailedToSaveFiles extends Error {}

interface File {
  path: string;
  content: string;
}

const get = async (Key: string, version: string) => {
  const [content, Metadata] = await readFile(Key, version);
  return { path: Key, content, metadata: Metadata };
};

const post = async (version: string, body?: unknown) => {
  if (!body || !Array.isArray(body)) {
    throw new InvalidPayload("Invalid request payload");
  }

  if (!body.every((f) => "path" in f && "content" in f)) {
    throw new InvalidPayload("Invalid request payload");
  }

  const files: File[] = body;
  const promises = files.map(async (file) => {
    await saveFile(file.path, version, file.content);
    await saveInode(file.path, version);
    return { path: file.path, status: "saved" };
  });

  try {
    // TODO(Alec): This has performance concerns. ChatGPT recommends
    // p-map (a concurrency-controlled async mapping library)
    const results = await Promise.all(promises);
    return results;
  } catch (error) {
    console.log(error);
    throw new FailedToSaveFiles("Failed to save all files");
  }
};

const remove = async (path: string, version: string) => {
  await deleteFile(path, version);
  await deleteInode(path, version);
};

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  const directory = searchParams.get("directory");
  const version = searchParams.get("version") || DEFAULT_VERSION_NAME;

  if (Array.isArray(version)) {
    return NextResponse.json({ error: "version path parameter can't be an array" }, { status: 400 });
  }

  if (req.method === "GET" && !path) {
    // Get all of the files
    if (!directory || Array.isArray(directory)) {
      return NextResponse.json({ error: "directory parameter is required to list files" }, { status: 400 });
    }

    const files = await listFiles(directory, version);
    return NextResponse.json(files);
  }

  if (!path || Array.isArray(path)) {
    return NextResponse.json({ error: "File path parameter is required" }, { status: 400 });
  }

  try {
    switch (req.method) {
      case "GET":
        const getResponse = await get(path, version);
        return NextResponse.json(getResponse);

      case "POST":
        const { files } = await req.json();
        const postResponse = await post(files);
        return NextResponse.json(postResponse);

      case "DELETE":
        await remove(path, version);
        return NextResponse.json({ message: "File deleted successfully" });

      default:
        console.log(req.method);
        return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
    }
  } catch (error: unknown) {
    if (error instanceof S3NotFound) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    } else if (error instanceof InvalidPayload) {
      return NextResponse.json({ error: "Invalid payload sent" }, { status: 400 });
    } else if (error instanceof FailedToSaveFiles) {
      return NextResponse.json({ error: "Failed to save file(s)" }, { status: 400 });
    } else {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }
}

export async function GET(req: Request) {
  return await handler(req);
}
export async function POST(req: Request) {
  return await handler(req);
}
export async function DELETE(req: Request) {
  return await handler(req);
}
