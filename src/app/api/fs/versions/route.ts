import { getInodeReversions } from "@/lib/redis";
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path } = req.query;

  if (!path || Array.isArray(path)) {
    return res.status(400).json({ error: "File path is required" });
  }

  try {
    const versions = await getInodeReversions(path);

    if (!versions.length) {
      return res.status(404).json({ error: "No versions found" });
    }

    return res.status(200).json({ versions });
  } catch (error: unknown) {
    return res.status(500).json({ error: "Failed to retrieve versions" });
  }
}
