import type { DocEntry } from "@/lib/documents/registry";
import type { DocumentPresence } from "@/lib/documents/awareness";
import { setAwarenessVisible } from "@/lib/documents/awareness";
import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";

export interface AwarenessParticipant {
    client: number;
    id?: string;
    name: string;
    color?: string;
    colorLight?: string;
}

/**
 * Advertises document presence only while the editor is visible and exposes
 * an immutable participant list suitable for rendering.
 */
export function useDocumentAwareness(
    entry: DocEntry | undefined,
    containerRef: RefObject<HTMLElement | null>,
): AwarenessParticipant[] {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!entry || !containerRef.current) return;
        const element = containerRef.current;
        let intersecting = false;
        const updateVisibility = () => setAwarenessVisible(
            entry.awareness,
            intersecting && globalThis.document.visibilityState !== "hidden",
        );
        const observer = typeof IntersectionObserver === "undefined"
            ? null
            : new IntersectionObserver(([intersection]) => {
                intersecting = intersection.isIntersecting && intersection.intersectionRatio > 0;
                updateVisibility();
            });

        if (observer) {
            observer.observe(element);
        } else {
            intersecting = true;
            updateVisibility();
        }
        globalThis.document.addEventListener("visibilitychange", updateVisibility);

        return () => {
            observer?.disconnect();
            globalThis.document.removeEventListener("visibilitychange", updateVisibility);
            setAwarenessVisible(entry.awareness, false);
        };
    }, [containerRef, entry]);

    useEffect(() => {
        if (!entry) return;
        const handleChange = () => setVersion((value) => value + 1);
        entry.awareness.on("change", handleChange);
        return () => entry.awareness.off("change", handleChange);
    }, [entry]);

    return useMemo(() => {
        if (!entry) return [];
        return [...entry.awareness.getStates().entries()]
            .filter(([client]) => client !== entry.awareness.clientID)
            .flatMap(([client, state]) => {
                const user = (state as DocumentPresence).user;
                if (!user?.name) return [];
                return [{ client, ...user }];
            });
        // Awareness owns a mutable map; version invalidates this snapshot.
    }, [entry, version]);
}
