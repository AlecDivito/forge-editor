import { parseFileQueryTarget, parseLineTarget, quickPickMode } from "@/components/panels/commandPallet/hooks/use-quick-pick-mode";

describe("command palette query parsing", () => {
  test.each([[">x", "commands"], ["#x", "workspaceSymbols"], ["@x", "documentSymbols"], [":4", "line"], ["file", "files"]])(
    "%s selects %s", (value, mode) => expect(quickPickMode(value)).toBe(mode),
  );

  it("only treats a numeric file suffix as a target", () => {
    expect(parseFileQueryTarget("src/main.ts:12:4")).toEqual({ query: "src/main.ts", line: 12, column: 4 });
    expect(parseFileQueryTarget("notes:todo")).toEqual({ query: "notes:todo" });
  });

  it("parses one-based line targets", () => {
    expect(parseLineTarget("12:4")).toEqual({ line: 12, column: 4 });
    expect(parseLineTarget("12")).toEqual({ line: 12, column: 1 });
    expect(parseLineTarget("abc")).toBeUndefined();
  });
});
