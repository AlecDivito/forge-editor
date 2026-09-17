// lib/ws/useSocketStatus.ts
import { useSyncExternalStore } from 'react';
import { socket } from '../lib/ws/connection';
import type { ConnectionStatus } from '../lib/ws/types';

export function useSocketStatus(): ConnectionStatus {
  return useSyncExternalStore(
    (cb) => socket.subscribeStatus(cb),
    () => socket.status,
  );
}
