import { socket } from "@/lib/ws/connection";
import { TerminalId, WorkspaceId } from "@/lib/ws/messages";
import { useCallback, useEffect } from "react";


export default function useTerminal(workspaceId: WorkspaceId, terminalId: TerminalId) {

    useEffect(() => {
        const unsubscribe = socket.subscribe(msg => {
            if (msg.kind === 'TerminalOutput' && msg.term_id === terminalId) {
                console.log(`terminal output ${msg.data}`)
                // terminalEmitter.emit(terminalId, Uint8Array.from(msg.data))
            }
        })
        return () => { unsubscribe(); }
    })

    const write = useCallback((data: Uint8Array) => {
        socket.send({ kind: 'TerminalInput', term_id: terminalId, data: Array.from(data) })
    }, [workspaceId, terminalId])

    return { write }
}
