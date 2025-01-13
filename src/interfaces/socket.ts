export type Message =
  | { event: "file:read"; body: { path: string } }
  | { event: "file:created"; body: { path: string } }
  | { event: "file:updated"; body: { path: string; content: string } }
  | { event: "file:moved"; body: { path: string; newPath: string } }
  | { event: "file:deleted"; body: { path: string } };

const appendSlash = (path: string) =>
  path.startsWith("/") ? path : `/${path}`;

export const ReadFile = (path: string): Message => {
  return { event: "file:read", body: { path: appendSlash(path) } };
};

export const FileCreated = (path: string): Message => {
  return { event: "file:created", body: { path: appendSlash(path) } };
};

export const FileUpdated = (path: string, content: string): Message => {
  return { event: "file:updated", body: { path: appendSlash(path), content } };
};

export const FileMoved = (path: string, newPath: string): Message => {
  return { event: "file:moved", body: { path: appendSlash(path), newPath } };
};

export const FileDeleted = (path: string): Message => {
  return { event: "file:deleted", body: { path: appendSlash(path) } };
};
