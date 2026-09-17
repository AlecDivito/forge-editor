import type { AwarenessParticipant } from "../hook/use-document-awareness.hook";

interface DocumentParticipantsProps {
    participants: AwarenessParticipant[];
}

export function DocumentParticipants({ participants }: DocumentParticipantsProps) {
    if (participants.length === 0) return null;

    const names = participants.map((participant) => participant.name).join(", ");

    return <div
        className="absolute right-3 top-2 z-20 flex items-center -space-x-1"
        role="status"
        aria-label={`Present: ${names}`}
        title={`Present: ${names}`}
    >
        {participants.slice(0, 5).map((participant) => <span
            key={participant.client}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-background text-[10px] font-semibold text-white"
            style={{ backgroundColor: participant.color }}
            aria-hidden="true"
        >
            {participant.name.slice(0, 1).toUpperCase()}
        </span>)}
        {participants.length > 5 && <span className="pl-2 text-xs">+{participants.length - 5}</span>}
    </div>;
}

