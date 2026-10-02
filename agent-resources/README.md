# Forge agent resources

Configure `FORGE_AGENT_RESOURCES_DIR` to this directory or another directory
with the same layout.

- `skills/<skill-id>/SKILL.md` is an Agent Skills-compatible instruction file.
  It needs frontmatter with a matching lowercase-hyphen `name` and a
  `description`; `disable-model-invocation: true` hides it from autonomous
  model discovery while keeping it available through the composer.
- `rules/*.md` are included as system rules for every agent operation.
- `prompts/system.md` is included as the base system prompt when present.
- `policies/bash.json` contains approved command prefixes. A matching command
  runs without a prompt; prefixes match only at a command-token boundary.
  Choosing “don't ask again” for a command in the UI writes its displayed
  prefix here.
