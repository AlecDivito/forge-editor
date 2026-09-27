# Forge agent resources

Configure `FORGE_AGENT_RESOURCES_DIR` to this directory or another directory
with the same layout.

- `skills/<skill-id>/SKILL.md` provides an on-demand skill available through
  the `load_skill` agent tool.
- `rules/*.md` are included as system rules for every agent operation.
- `prompts/system.md` is included as the base system prompt when present.
- `policies/bash.json` is loaded and validated now; richer policy behavior is
  intentionally deferred. Bash approvals use the durable `allow_once`,
  `allow_always`, and `deny` decisions.
