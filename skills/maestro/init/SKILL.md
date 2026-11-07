---
name: init
description: Create the project — the root of a project's tree in the store — once per project. Creates the project with a fixed body: fields that point at the brief and, when one exists, at the project on the team's board, and an empty progress section that sync owns. Creates the project's milestones when it has any. Writes no configuration and creates no label: /maestro:maestro setup does that, once per repository.
argument-hint: "[optional project name in kebab-case]"
---

# Project

If the config sets `method` to `shape-up`, read `../references/methods/shape-up.md` and apply its section for this mode.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where `<store>` is config `store` (default `github`).

The project is the root of the tree. Research and specs hang off it, tasks hang off a spec,
and a pull request closes one or more tasks. The tree, the stores and the milestones are in
[../SKILL.md](../SKILL.md).

**A project is a pointer and not a document.** The argument lives in the brief, in whatever
tool the team writes it. The work lives in the children. The body holds a fixed set of fields
and the progress section, and nothing else, so that every project looks the same.

## Workflow

### 1. Read the configuration

Read the config, as [../SKILL.md](../SKILL.md) says. **If its `scope` is `none`, there is no
config yet: say so, and offer to run `/maestro:maestro setup` first.** If the user declines, go on with the defaults from the
Configuration table in [../SKILL.md](../SKILL.md).

### 2. Make sure that the store is ready

On GitHub, make sure that the four labels exist, as **ready** in the store file lists them.
On a tracker, do **ready**: it finds the MCP tools and confirms the mapping. **Init creates no
label.** If a label is missing, or the tracker is not ready, offer `/maestro:maestro setup`,
and stop until the store is ready.

### 3. Get the project name

Read the name from the argument. If no argument exists, read it from the `<slug>` part of the
branch name, against `branchPattern`. If neither gives a name, ask the user with
`AskUserQuestion`.

The name is kebab-case, such as `bulk-invoice-export`. The title is
`Project: <Project Name>`, in title case.

### 4. Look for an existing project

Before you create anything, **find projects**, open and closed, and look for this name.

If a project with this name exists, report its reference and stop. Two projects for one piece
of work split the tree, and no query can join them again.

### 5. Get the links

- **Brief.** The document that says why: a PRD, an RFC, a doc page, a markdown file, an
  issue. Ask the user for the link. A brief is optional, so omit the `**Brief**` line when
  there is none.
- **Board.** The project on the team's board, when `board.instructions` in the configuration
  says how to reach one. Follow those instructions to find it. If the board holds no item
  with this name, or no board is configured, omit the `**Board**` line. Do not create a board
  item here, because `/maestro:maestro sync` owns that.

### 6. Create the project

The body is exactly this, and nothing else:

```markdown
**Project**: <Project Name>
**Brief**: [<title>](<link to the brief>)
**Board**: [<title>](<link to the project on the board>)

<!-- maestro:progress:start -->
<!-- maestro:progress:end -->
```

Omit the `**Brief**` line when there is no brief, and the `**Board**` line when no board item
exists. Leave the progress section empty: `/maestro:maestro sync` owns the text between the
two markers and rewrites it. Add no other field, no other heading and no summary.

**Create** a project with the title `Project: <Project Name>` and this body. A project has no
parent. Then read the body back, as [../SKILL.md](../SKILL.md) says under Writing a body. If
the read-back lost the two markers, use the fallback the store file gives.

### 7. Create the milestones

Ask the user whether the project has milestones: stages, phases or releases. None is fine,
and most small projects have none.

List the project's **milestones**, and skip each one that exists already. Then create each
missing one with **milestones**, with its due date when the user gives one. The store file
says how a milestone is named.

**Do not list the milestones in the body.** The milestones themselves are the record, and
`/maestro:maestro sync` finds them through the same operation.

### 8. Report

Give the user the project's reference and its URL, and the milestones it created. Then name
the next mode: `/maestro:maestro research` to explore, or `/maestro:maestro spec` to write
the requirements.

## What init does not do

- It writes no file, and no configuration. `/maestro:maestro setup` writes
  the config and creates the labels.
- It creates no board item. `/maestro:maestro sync` writes to the board.
- It writes no progress. The progress section starts empty, and sync fills it.
- It writes no summary of the project into the body. The brief holds the argument.
