import redis from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { path, content } = await req.json();
    await redis.set(path, content);
    return NextResponse.json(
      { success: true, message: `File '${path}' created/updated.` },
      { status: 200 }
    );
  } catch (error) {
    console.error("Filesystem error:", error);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { path } = await req.json();
    const result = await redis.del(path);
    if (result) {
      return NextResponse.json(
        { success: true, message: `File '${path}' deleted.` },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        { success: false, message: `File '${path}' not found.` },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error("Filesystem error:", error);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json(
        { success: false, message: "Path parameter is required." },
        { status: 400 }
      );
    }

    const keys = await redis.keys(`${path}*`); // Get all keys that start with the given path
    const files = await Promise.all(
      keys.map(async (key) => ({
        path: key,
        content: await redis.get(key),
      }))
    );

    return NextResponse.json({ success: true, files }, { status: 200 });
  } catch (error) {
    console.error("Filesystem error:", error);
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}
