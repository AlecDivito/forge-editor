"use server";

import { getFilePaths } from "@/service/fs";
import WebPageInitializer from "@/components/webpage";

export default async function Home() {
  const filePaths: string[] = await getFilePaths("/");

  return <WebPageInitializer tree={filePaths} />;
}
