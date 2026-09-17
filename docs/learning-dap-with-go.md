# Learning DAP with Go and Delve

This guide is deliberately about one subject: the Debug Adapter Protocol
(DAP), using Go's Delve debugger and Forge as the concrete implementation.

The goal is not to memorize every DAP request. It is to understand who sends
each message, why messages arrive in a particular order, and why runtime IDs
must only be used while the program is stopped.

## The system in one picture

```text
Forge browser UI
    │  Forge's typed WebSocket messages
    ▼
Forge debug service
    │  DAP requests, responses, and events over loopback TCP
    ▼
Delve: dlv dap --listen=127.0.0.1:<port>
    │  controls and inspects
    ▼
Go debuggee (the program being debugged)
```

These are four distinct roles:

- The **debuggee** is your Go program.
- **Delve** is the Go debugger. It understands goroutines, Go stack frames,
  variables, compiled binaries, and the Go runtime.
- The **debug adapter** is Delve's DAP-facing server. In this setup Delve is
  both debugger and adapter.
- The **debug client** is Forge. It starts Delve, sends DAP requests, receives
  DAP events, and presents safe results to the browser.

Forge does not forward raw DAP to the browser. The browser uses Forge's own
public WebSocket contract. This lets the server enforce workspace boundaries,
hide host paths, replace numeric adapter IDs with opaque handles, apply limits,
and verify that a browser owns the session it is controlling.

## What DAP actually is

DAP is a JSON protocol between a development tool and a debug adapter. It lets
one editor implement a common debugging UI while language-specific adapters do
the language and runtime work. Read the official [DAP overview][dap-overview]
first, then use the [protocol specification][dap-spec] as a reference rather
than reading it front to back.

DAP has three message types:

| Type | Direction | Purpose | Example |
| --- | --- | --- | --- |
| Request | either direction | Ask the other side to do something | `threads`, `continue` |
| Response | reply to a request | Report success/failure and optional data | response to `stackTrace` |
| Event | unsolicited notification | Announce that state changed | `stopped`, `output` |

A request has a `seq` and `command`. Its response identifies the original
request using `request_seq`. Events are not replies and therefore have no
`request_seq` relationship.

```json
{"seq": 12, "type": "request", "command": "threads", "arguments": {}}
```

```json
{
  "seq": 44,
  "type": "response",
  "request_seq": 12,
  "success": true,
  "command": "threads",
  "body": {"threads": [{"id": 1, "name": "main"}]}
}
```

DAP JSON is framed on a byte stream like this:

```text
Content-Length: 73\r\n
\r\n
{"seq":1,"type":"request","command":"threads","arguments":{}}
```

`Content-Length` counts the UTF-8 body bytes, not characters. TCP does not
preserve message boundaries, so a read may contain part of a message or several
messages. Forge's reader must therefore parse the header and then read exactly
the declared byte count. See [`dap.rs`](../crates/src/debug/dap.rs).

## Go's DAP implementation: Delve

[Delve][delve] is the debugger normally used for Go. Its `dlv dap` command runs
a DAP server, and its official [DAP documentation][delve-dap] describes the
supported launch and attach behavior.

Forge's Go profile starts it as:

```text
dlv dap --listen=127.0.0.1:<ephemeral-port> --log=false
```

The port is chosen by Forge and bound to loopback, so it is not a public remote
debugging endpoint. Forge then connects to that port and speaks DAP. The exact
adapter command and Go launch arguments are in
[`go.rs`](../crates/src/debug/profiles/go.rs).

Install Delve on the machine running Forge:

```bash
go install github.com/go-delve/delve/cmd/dlv@latest
command -v dlv
dlv version
```

The directory containing `dlv` must be on the Forge server process's `PATH`.
For repeatable production builds, pin a Delve version instead of using
`@latest`.

### Forge's Go launch configuration

Use `type: "forge-go"`, not the VS Code Go extension's `type: "go"`:

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Go HTTP server",
      "type": "forge-go",
      "request": "launch",
      "program": "${workspaceFolder}",
      "cwd": "${workspaceFolder}",
      "args": ["serve", "--port", "8090"],
      "env": {},
      "console": "internalConsole"
    }
  ]
}
```

The prepared playground already contains launch configurations at
`/Users/divitoa/code/alecdivito/forge-debug-playground/.vscode/launch.json`.
Forge currently supports launching a Go program; arbitrary PID or remote
attach is not part of its public feature set.

## The complete launch conversation

This is the most important sequence to learn:

```text
Forge                              Delve
  │── initialize ───────────────────▶│
  │◀─ initialize response ───────────│  capabilities
  │── launch ────────────────────────▶│  program, cwd, args, env, mode=debug
  │◀─ initialized event ─────────────│  ready for breakpoint configuration
  │── setBreakpoints ────────────────▶│  complete list for source A
  │◀─ response ──────────────────────│  verified/resolved breakpoints
  │── setBreakpoints ────────────────▶│  complete list for source B
  │◀─ response ──────────────────────│
  │── configurationDone ─────────────▶│
  │◀─ response ──────────────────────│
  │◀─ launch response ───────────────│  may occur earlier with some adapters
  │                                  │  program runs
  │◀─ stopped event ─────────────────│  breakpoint, step, pause, exception
```

Important details:

1. `initialize` negotiates capabilities. A client must not assume every adapter
   supports every optional request.
2. `launch` describes the debuggee. For Forge Go sessions, the profile adds
   `mode: "debug"`; Delve builds a debug binary and launches it.
3. The `initialized` event means the client may configure breakpoints. It does
   not mean that the debuggee has stopped.
4. `setBreakpoints` replaces the complete breakpoint list for one source. It is
   not an "add one breakpoint" operation.
5. DAP allows adapter-specific ordering around the `launch` response and
   `initialized` event. Forge explicitly tolerates Delve returning them in
   either order.
6. `configurationDone` tells Delve the initial configuration is complete.

Trace this implementation in the startup section of
[`service.rs`](../crates/src/debug/service.rs), beginning at the `initialize`
request. Breakpoint translation is in
[`breakpoints.rs`](../crates/src/debug/breakpoints.rs).

## What happens when Delve stops

When a Go breakpoint is hit, Delve sends a `stopped` event. The event includes
a reason and commonly a DAP `threadId`. For Go, the threads exposed through DAP
represent the execution contexts Delve chooses to present; Go developers will
usually think of the interesting contexts as goroutines. Do not assume a DAP
thread ID is an operating-system thread ID.

Forge then inspects the stopped program lazily:

```text
stopped event
  └─ threads
      └─ stackTrace(threadId)
          └─ scopes(frameId)
              └─ variables(variablesReference)
                  └─ variables(child variablesReference)

Optional at the same stop:
  evaluate(expression, frameId)
  source(sourceReference)
```

- `threads` lists execution contexts.
- `stackTrace` lists frames for one thread/goroutine.
- `scopes` usually exposes locals, arguments, and globals for one frame.
- `variables` expands one scope or compound value. A nonzero
  `variablesReference` means the value has children that can be requested.
- `evaluate` asks Delve to evaluate a Go expression in a frame's context.
- `source` fetches source content supplied by the adapter rather than a normal
  workspace file.

These calls are lazy because recursively loading every goroutine, frame, map,
slice, struct, and pointer could be extremely expensive.

### Runtime IDs expire

DAP's `threadId`, `frameId`, `variablesReference`, and `sourceReference` values
belong to adapter state. A frame or variable reference that worked at one stop
may be meaningless after `continue`, `next`, `stepIn`, or `stepOut`.

Forge models each stop as a **stopped generation**. It wraps Delve's numeric IDs
in opaque handles tied to both the session and generation. On resume, Forge
invalidates those handles. A delayed browser request from the previous stop is
rejected instead of being accidentally applied to new runtime state. See the
handle definitions in [`runtime.rs`](../crates/src/debug/models/runtime.rs) and
their use in [`service.rs`](../crates/src/debug/service.rs).

This is the core distinction:

- A source breakpoint is durable intent: "stop at this file and line."
- A frame or variable reference is temporary authority: "inspect this object
  while this exact stopped state still exists."

## Execution-control messages

While stopped, Forge maps its UI actions to these DAP requests:

| Forge action | DAP command | Go/Delve meaning |
| --- | --- | --- |
| Continue | `continue` | Resume execution until another stop |
| Pause | `pause` | Interrupt a currently running target |
| Step over | `next` | Advance without entering a called function |
| Step into | `stepIn` | Enter a called function when possible |
| Step out | `stepOut` | Run until the current function returns |
| Stop session | `disconnect` | Disconnect and ask Delve to terminate the debuggee |

Stepping is implemented by Delve against compiled Go code. Compiler inlining,
optimized code, generated wrappers, and runtime frames can make a source-level
step differ from a simplistic "next line" model. The Go project's official
[diagnostics guide][go-diagnostics] provides useful context on Go debugging
and profiling tools.

Forge offers session-level pause in its public API, but DAP requires a
`threadId`. The server resolves a current thread before sending Delve the
request. That translation is another example of Forge's WebSocket contract not
being a raw DAP tunnel.

## Breakpoints in Delve

A source breakpoint request can include:

- a one-based `line` and optional `column`;
- `condition`, a Go expression that must be true;
- `hitCondition`, controlling which hit stops execution;
- `logMessage`, producing output instead of stopping when supported.

Delve answers with breakpoint objects containing `verified` and possibly a
resolved line. A breakpoint may be moved because not every source line maps to
an executable machine instruction. Forge therefore stores the requested
position separately from each session's adapter verification.

Capability negotiation matters here: conditional breakpoints, hit conditions,
and logpoints are optional DAP features. Forge only sends fields that the
adapter says it supports.

## Hands-on DAP curriculum

Use `/Users/divitoa/code/alecdivito/forge-debug-playground` for these exercises.
Spend about 45–60 minutes on each lesson and do them in order.

### Lesson 1: identify every participant

1. Open the playground's `.vscode/launch.json`.
2. Select `Go CLI analyze` in Forge.
3. Launch it and watch the session state move through starting, running,
   stopped, and terminated states as applicable.
4. Write down which process is Forge, Delve, and the Go debuggee.
5. Read [`go.rs`](../crates/src/debug/profiles/go.rs) and find the `dlv dap`
   command, TCP transport, adapter ID, and `mode: "debug"` launch argument.

You are done when you can explain why Forge connects to Delve rather than
directly controlling the Go process.

### Lesson 2: follow initialization

1. In [`service.rs`](../crates/src/debug/service.rs), find the `initialize`
   request, then follow `launch`, `initialized`, `setBreakpoints`, and
   `configurationDone`.
2. Compare each message to the corresponding type in the
   [DAP specification][dap-spec].
3. Find where Forge records Delve's capability response.
4. Explain why Forge waits for `initialized` before sending breakpoints.
5. Explain why it cannot require one fixed ordering for the `launch` response.

### Lesson 3: stop in Go code

1. Open the playground's `internal/playground/service.go`.
2. Place a breakpoint inside the factorial or counting loop.
3. Start `Go CLI analyze`, or start `Go HTTP server` and call its endpoint.
4. Confirm whether Delve verifies the requested line or moves it.
5. At the stop, identify the `stopped` event's reason in Forge's state.

For the HTTP configuration, the Go process may run normally until a request
executes the handler containing your breakpoint.

### Lesson 4: traverse runtime data

1. Select a goroutine/thread.
2. Load its stack and select a non-top frame.
3. Open each scope and expand a struct, slice, map, or pointer.
4. Evaluate a harmless Go expression in the selected frame.
5. For each UI action, name the DAP request: `threads`, `stackTrace`, `scopes`,
   `variables`, or `evaluate`.
6. Locate the matching command construction in
   [`service.rs`](../crates/src/debug/service.rs).

Do not evaluate function calls or expressions with side effects until you are
comfortable with Delve evaluation semantics. An evaluation timeout does not
prove that the expression had no effect.

### Lesson 5: prove handle invalidation

1. Expand a nested variable while stopped.
2. Record mentally that the UI now holds an opaque variable handle.
3. Continue or step so the program enters a new stopped generation.
4. Observe that old runtime data is cleared and must be requested again.
5. Read the generation checks in [`runtime.rs`](../crates/src/debug/models/runtime.rs)
   and [`service.rs`](../crates/src/debug/service.rs).

You are done when you can explain why caching a Delve `frameId` across a
continue would be a correctness and security bug.

### Lesson 6: understand DAP without bypassing Forge

1. Read the shared examples in [`debug-wire.json`](../fixtures/debug-wire.json).
2. Read [`dap.rs`](../crates/src/debug/dap.rs) and explain how two DAP frames in
   one TCP read are separated.
3. Compare DAP data with Forge's browser messages in
   [`messages.ts`](../src/lib/ws/messages.ts).
4. Follow a browser request through
   [`connection.ts`](../src/lib/ws/connection.ts),
   [`debug-runtime.ts`](../src/store/debug-runtime.ts), and the server service.
5. List what Forge removes or replaces: host paths, numeric handles, raw
   adapter commands, unbounded payloads, and unauthenticated session control.

## A request-tracing worksheet

For any debugger action, fill in this table. If you can complete it without
guessing, you understand the relevant DAP flow.

| Question | Example: expand local variable |
| --- | --- |
| What did the user do? | Expanded `items` in the variables tree |
| What does the browser send? | Forge variable request with an opaque handle |
| What validation occurs? | Session, attachment, generation, depth, and limits |
| What DAP request is emitted? | `variables` with Delve's `variablesReference` |
| What does Delve return? | Child variable records and more references |
| What state may be retained? | New opaque child handles for this stop |
| What invalidates it? | Resume, a new stop, termination, or detachment |

Repeat it for setting a breakpoint, loading a stack, evaluating an expression,
stepping over, and opening generated source.

## Go and Delve details worth remembering

- Delve must be compatible with the installed Go toolchain. Check `dlv version`
  when a newly upgraded Go version stops debugging correctly.
- Forge passes `mode: "debug"`, so Delve owns the build-and-launch step for the
  configured Go package/program.
- Goroutines are a Go runtime concept; DAP exposes the adapter's generic
  `Thread` model. Treat the ID as an opaque Delve/DAP identifier.
- A valid Go source line may still have no executable instruction. Verification
  is Delve's answer about the compiled program, not merely about the text file.
- Variables can be expensive or recursive. Forge deliberately pages and bounds
  them rather than recursively fetching the whole object graph.
- Source paths originate on the Forge server. They must be mapped to workspace
  identities before the browser may navigate to them.
- `dlv dap` also supports capabilities Forge does not currently expose, notably
  general attach scenarios. Adapter capability and product support are not the
  same thing.

## Troubleshooting the playground

| Symptom | Check |
| --- | --- |
| Adapter cannot start | Run `command -v dlv` in the environment that starts Forge |
| Breakpoint stays unverified | Confirm the selected launch runs that package and the line is executable |
| HTTP breakpoint never hits | Start the Go HTTP launch and send a request to port 8090 |
| Forge cannot start on port 8080 | Port 8080 is Forge; the playground target intentionally uses 8090 |
| Variables disappear after stepping | Expected: stepping creates a new stopped generation |
| Stepping jumps unexpectedly | Consider Go compiler inlining, wrappers, and optimized/generated instructions |
| Launch works in a terminal, not Forge | Compare the Forge service user's `PATH`, cwd, and filesystem permissions |

## Completion checklist

You understand this system when you can explain all of these in your own words:

- why Delve is both the Go debugger and Forge's DAP adapter;
- the difference between a request, response, and event;
- DAP's `Content-Length` framing;
- the `initialize` → `launch` → `initialized` → breakpoint configuration →
  `configurationDone` sequence;
- how a `stopped` event leads to `threads`, `stackTrace`, `scopes`, and
  `variables` requests;
- why `setBreakpoints` sends the complete list for a source;
- why breakpoint intent can persist but frame and variable handles cannot;
- why every resume invalidates runtime inspection data;
- why DAP capabilities do not automatically become Forge features; and
- why Forge uses a separate browser protocol instead of exposing raw DAP.

## Authoritative references

- [Debug Adapter Protocol overview][dap-overview]
- [Debug Adapter Protocol specification][dap-spec]
- [Debug Adapter Protocol repository][dap-repository]
- [Delve repository and installation instructions][delve]
- [Delve DAP usage][delve-dap]
- [Delve DAP implementation notes][delve-dap-api]
- [Go diagnostics documentation][go-diagnostics]

[dap-overview]: https://microsoft.github.io/debug-adapter-protocol/overview
[dap-spec]: https://microsoft.github.io/debug-adapter-protocol/specification
[dap-repository]: https://github.com/microsoft/debug-adapter-protocol
[delve]: https://github.com/go-delve/delve
[delve-dap]: https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_dap.md
[delve-dap-api]: https://github.com/go-delve/delve/blob/master/Documentation/api/dap/README.md
[go-diagnostics]: https://go.dev/doc/diagnostics
