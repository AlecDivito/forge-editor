import { apiUrl } from "@/lib/transport";
import { EnvironmentSnapshot, validateEnvironmentSnapshot } from "./model";

export async function fetchEnvironmentSnapshot(): Promise<EnvironmentSnapshot> {
  const response = await fetch(apiUrl("/api/environment"), { cache: "no-store" });
  if (!response.ok) throw new Error(`Environment request failed (${response.status})`);
  return validateEnvironmentSnapshot(await response.json());
}
