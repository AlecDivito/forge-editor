// import { Change } from "@/service/fs";
// import DiffMatchPatch from "diff-match-patch";
// import { nanoid } from "nanoid";

// export function applyChanges(original: string, changes: Change[]) {
//   let result = original;
//   changes.forEach(({ op, pos, text }) => {
//     if (op === "insert") {
//       result = result.slice(0, pos) + text + result.slice(pos);
//     } else if (op === "delete") {
//       result = result.slice(0, pos) + result.slice(pos + text.length);
//     }
//   });
//   return result;
// }

// // export type Message =
// //   | { event: "file:edit"; body: { path: string; changes: Change[] } }
// //   | { event: "file:read"; body: { path: string } }
// //   | { event: "file:created"; body: { path: string } }
// //   | { event: "file:updated"; body: { path: string; content: string } }
// //   | { event: "file:moved"; body: { path: string; newPath: string } }
// //   | { event: "file:deleted"; body: { path: string } };

// const appendSlash = (path: string) =>
//   path.startsWith("/") ? path : `/${path}`;

// export const FileEdit = (
//   path: string,
//   old: string,
//   update: string
// ): Message => {
//   const dmp = new DiffMatchPatch();
//   const diffs = dmp.diff_main(old, update);
//   dmp.diff_cleanupSemantic(diffs);

//   let position = 0; // Running position in the document

//   const changes = diffs
//     .map(([op, text]) => {
//       if (op === 0) {
//         // For equal parts, just move the position forward
//         position += text.length;
//         return null; // No change needed for equal parts
//       }

//       const change = {
//         id: nanoid(),
//         op: op === -1 ? "delete" : "insert",
//         pos: position, // Current position in the document
//         text,
//         timestamp: Date.now(),
//       } as Change;

//       if (op === 1) {
//         // If insert, the position doesn't move (we're inserting at `position`)
//       } else if (op === -1) {
//         // If delete, move position forward by the length of the deleted text
//         position += text.length;
//       }

//       return change;
//     })
//     .filter((change) => change !== null); // Filter out no-op changes

//   return { event: "file:edit", body: { path: appendSlash(path), changes } };
// };

// // export const ReadFile = (path: string): Message => {
// //   return { event: "file:read", body: { path: appendSlash(path) } };
// // };

// // export const FileCreated = (path: string): Message => {
// //   return { event: "file:created", body: { path: appendSlash(path) } };
// // };

// // export const FileUpdated = (path: string, content: string): Message => {
// //   return { event: "file:updated", body: { path: appendSlash(path), content } };
// // };

// // export const FileMoved = (path: string, newPath: string): Message => {
// //   return { event: "file:moved", body: { path: appendSlash(path), newPath } };
// // };

// // export const FileDeleted = (path: string): Message => {
// //   return { event: "file:deleted", body: { path: appendSlash(path) } };
// // };
