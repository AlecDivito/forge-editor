import fixture from "../../../fixtures/debug-wire.json";
import type { ClientMessage, ServerMessage } from "@/lib/ws/messages";

test("shared debug wire fixtures cover every operation", () => {
  const clients = fixture.client as ClientMessage[];
  const operations = clients.flatMap((message) =>
    message.kind === "DebugRequest" ? [message.operation.operation] : [],
  );
  expect(new Set(operations)).toEqual(
    new Set([
      "threads",
      "stack_trace",
      "scopes",
      "variables",
      "evaluate",
      "source",
      "continue",
      "pause",
      "next",
      "step_in",
      "step_out",
      "watch_create",
      "watch_update",
      "watch_refresh",
      "watch_delete",
    ]),
  );
  expect((fixture.server as ServerMessage[]).map((message) => message.kind)).toEqual(["DebugResult", "DebugError"]);
});
