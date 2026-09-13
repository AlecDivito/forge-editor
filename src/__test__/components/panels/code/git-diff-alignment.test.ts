import { buildAlignedDiff } from "@/components/panels/code/components/GitDiffView/GitDiffView";

describe("Git diff alignment", () => {
  it("inserts a blank gutter row opposite an added line", () => {
    const diff = buildAlignedDiff("one\nthree\n", "one\ntwo\nthree\n");

    expect(diff.before.text).toBe("one\n\nthree");
    expect(diff.after.text).toBe("one\ntwo\nthree");
    expect(diff.before.lineNumbers).toEqual([1, null, 2]);
    expect(diff.after.lineNumbers).toEqual([1, 2, 3]);
    expect(diff.before.spacers).toEqual(new Set([2]));
    expect(diff.after.changed).toEqual(new Set([2]));
  });

  it("pairs replacement lines and pads the shorter side", () => {
    const diff = buildAlignedDiff("one\nold\nthree\n", "one\nnew a\nnew b\nthree\n");

    expect(diff.before.lineNumbers).toEqual([1, 2, null, 3]);
    expect(diff.after.lineNumbers).toEqual([1, 2, 3, 4]);
    expect(diff.before.spacers).toEqual(new Set([3]));
    expect(diff.before.changed).toEqual(new Set([2]));
    expect(diff.after.changed).toEqual(new Set([2, 3]));
  });
});
