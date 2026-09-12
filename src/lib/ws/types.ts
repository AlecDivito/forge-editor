// lib/ws/types.ts
export type ConnectionStatus =
    | { kind: 'idle' }                                    // never connected yet
    | { kind: 'connecting' }                                // handshake in flight
    | { kind: 'open' }                                       // connected, Hello received
    | { kind: 'reconnecting'; attempt: number }               // dropped, retrying
    | { kind: 'closed'; reason: 'unauthenticated' | 'server' | 'client' }; // gave up or explicit close