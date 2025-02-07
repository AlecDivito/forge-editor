/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { CacheManager } from "./cache";
import { TextDocumentContentChangeEvent } from "vscode-languageserver-protocol";

it("CacheManager: Successfully updates incremental updates", () => {
  const original = `console.log(testing)`;
  const expected = `console.log("testing")`;
  const changes: TextDocumentContentChangeEvent[] = [
    {
      range: {
        end: { line: 0, character: 12 },
        start: { line: 0, character: 12 },
      },
      text: '"',
    },
    {
      range: {
        end: { line: 0, character: 20 },
        start: { line: 0, character: 20 },
      },
      text: '"',
    },
  ];

  const content = CacheManager.applyAllIncrementalChanges(original, changes);
  expect(content).toEqual(expected);
});
