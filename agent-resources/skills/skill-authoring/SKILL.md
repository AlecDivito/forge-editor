---
name: skill-authoring
description: Design or improve a Forge agent skill, including focused instructions, supporting references, scripts, and assets. Use when the user asks to create, revise, or organize a skill.
---

# Forge skill authoring

Use this skill to design a reusable capability package, not a one-off answer.

## Choose the right resource

- A **skill** is a reusable, task-specific workflow with optional supporting material.
- A **rule** is an instruction applied automatically to future agent turns.
- A **prompt template** is a user-invoked request with arguments.
- A **tool** is a Forge backend capability or authority boundary.

## Required structure

Each skill has a directory and a `SKILL.md` entrypoint:

```text
skills/<skill-name>/
  SKILL.md
  references/       # optional detailed material loaded only when needed
  scripts/          # optional helpers
  assets/           # optional templates or static files
```

`SKILL.md` begins with frontmatter:

```markdown
---
name: lowercase-hyphen-name
description: State the task, outputs, and when this skill applies.
disable-model-invocation: false
---
```

The name must be 1–64 lowercase letters, numbers, and single interior hyphens.
The description must tell a model when to load the skill and be no longer than
1024 characters.

## Write effective instructions

1. State the task outcome first.
2. Describe the shortest reliable workflow in ordered steps.
3. Name required Forge tools and expected inputs and outputs.
4. Put lengthy examples, references, and reusable templates in relative
   `references/` or `assets/` files instead of inflating `SKILL.md`.
5. Call out confirmation requirements and anything the agent must not assume.
6. Include a verification step when the work changes code, configuration, or data.

Relative paths resolve from the skill directory. Do not use an absolute machine
path in a skill.

## Creation workflow

Before creating or replacing a skill, propose its name, description, planned
files, workflow, and verification. Keep the first version small. Add scripts
or reference files only when they remove repeated work or keep the entrypoint
concise. Preserve useful material in an existing skill and explain any
replacement before making it.

## Invocation behavior

Users explicitly invoke a skill with `/skill:<name>` in the Forge composer.
The model can autonomously load a skill only when it is visible in the skill
catalog. Set `disable-model-invocation: true` for skills that require an
explicit user choice.
