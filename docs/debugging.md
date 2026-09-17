# Debugging in Forge

Forge provides server-owned launch debugging through the Debug sidebar and
CodeMirror editor. The browser never chooses an adapter executable, sends raw
DAP messages, or receives numeric adapter handles and private host paths.

New to the protocol? Follow [Learning DAP with Go and Delve](./learning-dap-with-go.md)
for a focused explanation and hands-on curriculum using the Go playground.

## Available now

### Launch and sessions

- Discover validated `.vscode/launch.json` configurations.
- Launch the server-approved Rust, Go, Node, or Python adapter strategy.
- Receive lifecycle and output updates over the shared editor WebSocket.
- Stop an owned session.
- Restart by terminating the old session and creating a replacement with a new
  session identity.
- Reattach the current browser connection to an existing recovery snapshot.

Adapter installation remains a server responsibility. A configuration can be
valid while its required adapter program is unavailable on the host.

### Breakpoints

- Add or remove source breakpoints from the editor gutter.
- View all workspace breakpoints in the Debug sidebar.
- Enable, disable, navigate to, or remove a breakpoint.
- Add or clear a condition, hit-count condition, or log message using the
  breakpoint editor.
- Retain breakpoint intent in server-owned application data across restarts.
- Protect concurrent updates with expected revisions.
- Remap breakpoint files on workspace rename and retain deleted-file intent as
  disabled.
- Map live editor line changes back to durable breakpoint positions after a
  short debounce.
- Synchronize complete per-source breakpoint lists to active adapters.
- Show requested, disabled, unverified, verified, moved, conditional/logpoint,
  and rejected states.
- Keep adapter verification separate for each active session.

### Execution and stacks

- Pause a running target when supported.
- Continue, step over, step into, and step out from a stopped target.
- Stop immediately clears stale runtime authority.
- Inspect bounded thread lists.
- Load stack frames lazily and request additional pages.
- Select frames and navigate mapped workspace sources.
- Distinguish the current stopped line from a selected non-current frame.
- Represent generated and unavailable sources without exposing private paths.

Thread and frame handles are opaque and valid only for their session and
stopped generation. Continuing or stopping again invalidates old handles.

### Variables and evaluation

- Load scopes for a selected frame.
- Expand variables one level at a time.
- Bound variable page size, retained nodes, nesting depth, and display strings.
- Show explicit truncation state when an adapter exceeds a limit.
- Evaluate an expression from the Debug Console after acknowledging its
  side-effect risk.
- Distinguish evaluation failures from timeout cases whose outcome is unknown.
- Bound retained console records by count and encoded byte size.

### Watches

- Create, remove, and explicitly refresh session-held watches.
- Opt an individual watch into refresh after a new stopped generation.
- Keep automatic refresh off for newly created watches.
- Clear runtime values when execution resumes.

Watch definitions are intentionally session-ephemeral. They are not stored as
shared workspace settings.

### Generated source

- Open generated adapter source through an opaque source handle.
- Enforce a generated-source size limit.
- Display generated source in a dedicated read-only editor.
- Keep generated content outside workspace file IDs, writes, and Yjs documents.
- Close generated editors when their stopped generation is invalidated.

## Current limits

| Resource | Limit |
| --- | ---: |
| Breakpoints per workspace | 4,096 |
| Breakpoints per source | 256 |
| Threads per stopped generation | 256 |
| Stack frames per request | 200 |
| Retained frame handles | 2,000 |
| Scopes per frame | 64 |
| Variables per request | 500 |
| Retained variable nodes | 5,000 |
| Variable nesting depth | 20 |
| Individual display string | 64 KiB |
| Watches per session | 100 |
| Evaluation/watch expression | 8 KiB |
| Concurrent inspection requests | 8 |
| Generated source | 1 MiB |
| Console records | 1,000 records / 256 KiB |

## Not available yet

The following are known product or hardening gaps, not hidden controls:

- Arbitrary process/PID attach or remote adapter attach.
- Function, data, instruction, exception-configuration, or memory breakpoints.
- Disassembly, memory, registers, and data-breakpoint views.
- Compound launches, child-session debugging, and multi-process debugging.
- Adapter-native restart; Forge restart always creates a replacement session.
- Hot reload or a claim that edited source matches code already loaded by the
  debuggee.
- An explicit source-revision mismatch warning after editing during a run.
- Durable watches shared across sessions.
- Hover evaluation, expression completion, and variable mutation.
- Arbitrary/custom DAP requests or a raw debug console.
- Multiple-session selection and simultaneous session decorations in the UI.
- View-only versus controller attachment roles.
- Full reconnect authority replacement when the browser receives a new
  connection identity.
- Independent per-thread stack caches and per-request error/retry state.
- Indexed/named variable collection paging controls.
- Breakpoint collaboration updates for clients that have no active debug
  session.
- A pinned real-adapter compatibility artifact and browser end-to-end CI suite.

## Known qualification gaps

The implemented path has focused Rust protocol/runtime tests and frontend
store/wire tests. Before treating the debugger as production-qualified, Forge
still needs broader adapter-crash, reconnect, cancellation, concurrency, load,
privacy, process-cleanup, CodeMirror interaction, accessibility, browser E2E,
and exactly pinned real-adapter coverage.

For engineering closeout details, see the DAP Phase 4 completion plan in the
local `plans` directory.
