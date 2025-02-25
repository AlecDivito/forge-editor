import GitS3 from "@/lib/git";
import { NextResponse } from "next/server";

// **POST Handler (for addFile, commit, createBranch, switchBranch)**
export async function POST(req: Request) {
  const body = await req.json();

  if (body.action === "addFile") {
    const result = await GitS3.addFile(body.branch, body.filename, body.content);
    return NextResponse.json(result);
  } else if (body.action === "commit") {
    const result = await GitS3.commit(body.branch, body.message);
    return NextResponse.json(result);
  } else if (body.action === "createBranch") {
    const result = await GitS3.createBranch(body.sourceBranch, body.targetBranch);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// **GET Handler (for listing branches)**
export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (action === "listBranches") {
    const result = await GitS3.listBranches();
    return NextResponse.json({ branches: result });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
