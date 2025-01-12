export type Message =
  | { event: "file:created"; body: { path: string } }
  | { event: "file:updated"; body: { path: string; content: string } }
  | { event: "file:moved"; body: { path: string; newPath: string } }
  | { event: "file:deleted"; body: { path: string } };

export const FileCreated = (path: string): Message => {
  let p = path;
  if (!p.startsWith("/")) {
    p = `/${path}`;
  }
  return { event: "file:created", body: { path: p } };
};

export const FileUpdated = (path: string, content: string): Message => {
  return { event: "file:updated", body: { path, content } };
};

export const FileMoved = (path: string, newPath: string): Message => {
  return { event: "file:moved", body: { path, newPath } };
};

export const FileDeleted = (path: string): Message => {
  return { event: "file:deleted", body: { path } };
};
