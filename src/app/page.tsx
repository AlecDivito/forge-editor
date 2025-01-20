"use server";

import WebPageInitializer from "@/components/webpage";

export default async function Home() {
  return (
    <WebPageInitializer project="" folder={{ files: [], directories: [] }} />
  );
}
