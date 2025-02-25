"use server";

import WebPageInitializer from "@/components/webpage";
import { FileSystemProvider } from "@/lib/storage";

interface Props {
  params: Promise<{
    userName: string;
    projectName: string;
  }>;
}

export default async function Home({ params }: Props) {
  const { userName, projectName } = await params;
  const fs = new FileSystemProvider(userName, projectName);

  const folder = await fs.listOrCreate();

  return <WebPageInitializer user={userName} project={projectName} folder={folder} />;
}
