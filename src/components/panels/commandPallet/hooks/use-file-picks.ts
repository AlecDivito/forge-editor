import { useEffect, useState } from "react";
import { searchFileNames } from "@/lib/generated";

export type FilePick = { path: string; name: string };

export function useFilePicks(query: string, enabled: boolean) {
  const [picks, setPicks] = useState<FilePick[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || query.length === 0) {
      setPicks([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await searchFileNames({
          query: { search: query },
          responseType: "json",
          throwOnError: true,
        });
        const result = response.data as { results?: FilePick[] };
        if (!cancelled) setPicks(result.results ?? []);
      } catch {
        if (!cancelled) setPicks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [enabled, query]);

  return { picks, loading };
}
