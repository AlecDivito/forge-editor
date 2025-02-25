import { NextApiRequest, NextApiResponse } from "next";
import { readFile, saveFile, S3NotFound, deleteFile } from "@/lib/s3";
import { saveInode, getInodeReversions, deleteInode } from "@/lib/redis";
import { diff_match_patch } from "diff-match-patch";

class MergeConflictError extends Error {}

const mergeFiles = async (baseVersion: string, targetVersion: string, dryRun: boolean) => {
  const dmp = new diff_match_patch();
  const paths = await getInodeReversions(baseVersion);
  const conflicts = [];
  const successfulMerges = [];

  for (const path of paths) {
    try {
      const [baseContent] = await readFile(path, baseVersion);
      const [targetContent] = await readFile(path, targetVersion);

      const differences = dmp.diff_main(baseContent, targetContent);
      dmp.diff_cleanupSemantic(differences);

      const conflictLines = differences.filter((diff) => diff[0] !== 0);

      if (conflictLines.length > 0) {
        conflicts.push({ path, differences });
      } else {
        successfulMerges.push({ path, content: targetContent });
      }
    } catch (error) {
      if (error instanceof S3NotFound) {
        continue;
      }
      throw error;
    }
  }

  if (conflicts.length > 0) {
    throw new MergeConflictError(JSON.stringify(conflicts));
  }

  if (!dryRun) {
    await Promise.all(
      successfulMerges.map(async ({ path, content }) => {
        await saveFile(path, baseVersion, content);
        await saveInode(path, baseVersion);
        await deleteFile(path, targetVersion);
        await deleteInode(path, targetVersion);
      }),
    );
  }

  return successfulMerges.map(({ path }) => ({ path, status: "merged" }));
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { baseVersion, targetVersion, dryrun } = req.body;
    const isDryRun = dryrun === "true";

    if (!baseVersion || !targetVersion) {
      return res.status(400).json({ error: "Both baseVersion and targetVersion are required" });
    }

    const result = await mergeFiles(baseVersion, targetVersion, isDryRun);
    return res.status(200).json({ message: "Merge successful", result });
  } catch (error) {
    if (error instanceof MergeConflictError) {
      return res.status(409).json({ error: "Merge conflict detected", conflicts: JSON.parse(error.message) });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}
