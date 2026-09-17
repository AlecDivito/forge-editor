# DAP rebuild: server-owned launch configuration

## Goal

Define a small, deterministic configuration layer that reads a Forge-supported
subset of `.vscode/launch.json`. It must produce a server-only resolved
configuration and a separate browser-safe summary. This milestone does not
start an adapter or speak DAP.

## Supported input

The initial schema supports one `version: "0.2.0"` launch file with a
`configurations` array. Each configuration may contain:

- `name` (required)
- `type` (required; one of Forge's registered adapter types)
- `request` (required; only `"launch"`)
- `program` (required)
- `cwd` (optional; defaults to `${workspaceFolder}`)
- `args` (optional array of strings)
- `env` (optional string-to-string map)
- `stopOnEntry` (optional boolean)

Only `${workspaceFolder}` may be substituted, and only in `program` and `cwd`.
The server resolves those paths and verifies they remain within the workspace.

## Outputs

The parser will return both:

1. A private resolved configuration containing absolute `program` and `cwd`
   paths plus launch arguments and environment values.
2. A public configuration summary containing an opaque ID, display name,
   adapter type, request kind, validity, and diagnostics. It must not expose
   host paths, environment values, executable commands, or adapter arguments.

## Commit checklist

- [ ] Add private and public configuration data models.
- [ ] Parse JSONC and report syntax diagnostics.
- [ ] Validate required fields, unique names, supported types, and
      `request: "launch"`.
- [ ] Resolve workspace-relative paths and `${workspaceFolder}`.
- [ ] Reject traversal, unsupported substitutions, invalid path targets, and
      oversized argument/environment collections.
- [ ] Add unit tests for each accepted and rejected boundary.
- [ ] Document the final supported subset in the user-facing debugging guide.

## Non-goals

- Full VS Code launch configuration compatibility.
- Command, environment, configuration, or arbitrary variable substitution.
- Adapter discovery, spawning, transport selection, or DAP messages.
- HTTP/WebSocket routes, browser UI, breakpoints, or runtime inspection.

## Review rule

Each checklist item is a separate focused commit. After each commit, stop for
review before beginning the next item.
