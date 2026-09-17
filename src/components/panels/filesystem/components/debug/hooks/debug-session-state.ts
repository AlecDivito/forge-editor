import { SessionState } from "@/lib/generated";

const terminalStates = new Set<SessionState>([SessionState.TERMINATED, SessionState.FAILED]);

export function isTerminalDebugState(state?: SessionState): boolean {
  return state !== undefined && terminalStates.has(state);
}
