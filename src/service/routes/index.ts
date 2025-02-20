import { ServerAcceptedMessage } from "../lsp";

// Some requests send a message to all LSP's loaded in the managers memory
// Other requests are meant to target a specific LSP.
//
// We keep a mapping of language (js/javascript) to LSP (process/docker/kubernetes).
// If the langauge doesn't already exist, we initialize it and spawn it.

// Requests come in 3 types:
// 1. Clients requesting some type of information
// 2. Clients notifying Language Server(s) that an event happened
// 3. Clients responding to a servers request.

// Depending on the `type` and the `message.method`, we'll want to
// take an action.
//
// Overall, this feels like the strategy pattern, We'll need some clients
// who don't care about messaging the particular LSP and others who all
// they care about is messaging the correct language server

// Extract only valid [type, method] pairs
type ValidKeyPairs = {
  [T in ServerAcceptedMessage as `${T["type"]}_${T["message"]["method"]}`]: [T["type"], T["message"]["method"]];
}[keyof {
  [T in ServerAcceptedMessage as `${T["type"]}_${T["message"]["method"]}`]: [T["type"], T["message"]["method"]];
}];

type ParamsFor<T extends ValidKeyPairs> = Extract<
  ServerAcceptedMessage,
  { type: T[0]; message: { method: T[1] } }
>["message"]["params"];

// The request mapping takes the common arguments and returns back a callback
const RequestMapping = new Map<ValidKeyPairs, ParamsFor<ValidKeyPairs>>([
  // Client to server notifications
  [["client-to-server-notification", "initialized"], ""],
  [["client-to-server-notification", "textDocument/didOpen"], ""],
  [["client-to-server-notification", "workspace/didChangeWatchedFiles"], ""],
  [["client-to-server-notification", "textDocument/didClose"], ""],
  [["client-to-server-notification", "textDocument/didChange"], ""],
  // Client to server requests\
  [["client-to-server-request", "initialize"], ""],
  [["client-to-server-request", "textDocument/completion"], ""],
  [["client-to-server-request", "textDocument/hover"], ""],
  [["client-to-server-request", "textDocument/didSave"], ""],
  [["client-to-server-request", "textDocument/definition"], ""],
  [["client-to-server-request", "textDocument/references"], ""],
  [["client-to-server-request", "textDocument/symbol"], ""],
  [["client-to-server-request", "textDocument/formatting"], ""],
  [["client-to-server-request", "textDocument/diagnostic"], ""],
  [["client-to-server-request", "textDocument/codeAction"], ""],
  [["client-to-server-request", "workspace/workspaceFolders"], ""],
  [["client-to-server-request", "textDocument/rename"], ""],
  [["client-to-server-request", "textDocument/documentSymbol"], ""],
  [["client-to-server-request", "textDocument/signatureHelp"], ""],
]);

class Router {}

const router = ({ type, id, ctx, message }: ServerAcceptedMessage) => {
  const pair = [type, message.method] as ValidKeyPairs;
  const strategy = RequestMapping.get(pair);
  if (!strategy) {
    // Handle the fact that the required handler doesn't exist
  }
};
