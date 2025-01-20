"use server";

import { listDirectoryFiles } from "@/service/fs";
import WebPageInitializer from "@/components/webpage";

interface Props {
  params: Promise<{
    projectName: string;
  }>;
}

export default async function Home({ params }: Props) {
  const { projectName } = await params;
  const folder = await listDirectoryFiles(process.env.S3_BUCKET!, projectName);

  return <WebPageInitializer project={projectName} folder={folder} />;
}
