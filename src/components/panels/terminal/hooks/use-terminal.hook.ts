import { socket } from "@/lib/ws/connection";
import { TerminalId, WorkspaceId } from "@/lib/ws/messages";
import { useCallback, useEffect } from "react";


export default function useTerminal(workspaceId: WorkspaceId, terminalId: TerminalId) {

    useEffect(() => {
        const unsubscribe = socket.subscribe(msg => {
            if (msg.kind === 'TerminalOutput' && msg.term_id === terminalId) {
                terminalEmitter.emit(terminalId, msg.data)
            }
        })
        return () => { unsubscribe(); }
    })

    const write = useCallback((data: Uint8Array) => {
        socket.send({ kind: 'TerminalInput', workspace, terminalId, data })
    }, [workspaceId, terminalId])

    return { write }
}