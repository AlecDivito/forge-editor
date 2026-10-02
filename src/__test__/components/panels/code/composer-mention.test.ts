import {
  findComposerMention,
  replaceComposerMention,
  cycleMentionIndex,
} from "@/components/panels/code/components/AgentHarnessPanel/mention";

describe("composer @mentions", () => {
  it("finds the mention being typed at the cursor", () => {
    expect(findComposerMention("Review @skill:auth", 18)).toEqual({ start: 7, end: 18, query: "skill:auth" });
  });

  it("replaces only the active mention", () => {
    const mention = findComposerMention("Review @aut", 11)!;
    expect(replaceComposerMention("Review @aut", mention, "@skill:skill-authoring")).toBe(
      "Review @skill:skill-authoring",
    );
  });

  it("wraps keyboard selection through mention results", () => {
    expect(cycleMentionIndex(0, 3, -1)).toBe(2);
    expect(cycleMentionIndex(2, 3, 1)).toBe(0);
    expect(cycleMentionIndex(0, 0, 1)).toBe(0);
  });
});
