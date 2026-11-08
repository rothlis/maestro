---
name: init
description: Create the project — the root of a project's tree in the store — once per project. Creates the project with a fixed body: fields that point at the brief and the board when they exist, a Context section that keeps what the project is about (from pasted text or the brief), a Changes log, and an empty progress section that sync owns. Run it again on an existing project to fill an empty Context. Creates the project's milestones when it has any. Writes no configuration and creates no label: /maestro:maestro setup does that, once per repository.
argument-hint: "[optional project name in kebab-case]"
---

# Project

If the config sets `method` to `shape-up`, read `../references/methods/shape-up.md` and apply its section for this mode.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where `<store>` is config `store` (default `github`).

The project is the root of the tree. Research and specs hang off it, tasks hang off a spec,
and a pull request closes one or more tasks. The tree, the stores and the milestones are in
[../SKILL.md](../SKILL.md).

**A project holds what the work is about, and its children hold the work.** The body has a
fixed shape: the fields, the Context section, the Changes log and the progress section, so
that every project looks the same. The rules of Context and Changes are under "The project
context" in [../SKILL.md](../SKILL.md).

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

If a project with this name exists, do not create a second one. Two projects for one piece of
work split the tree, and no query can join them again. **Read** it instead:

- If it has no `## Context` section, or an empty one, and the user gave context, fill it as
  step 6 says, add a line to Changes, and **replace body**. Then report, and stop.
- Else report its reference, and stop. A later change to the context goes through the rules of
  "The project context".

### 5. Get the links and the context

- **Brief.** The document that says why: a PRD, an RFC, a doc page, a markdown file, an
  issue. Ask the user for the link. A brief is optional, so omit the `**Brief**` line when
  there is none.
- **Board.** The project on the team's board, when `board.instructions` in the configuration
  says how to reach one. Follow those instructions to find it. If the board holds no item
  with this name, or no board is configured, omit the `**Board**` line. Do not create a board
  item here, because `/maestro:maestro sync` owns that.
- **Context.** Take everything the user gave: text pasted in the conversation, a file, and the
  content behind the brief link when you can read it. If the user gave nothing, ask once for
  the problem, the outcome and any decision already taken. None is fine.

### 6. Create the project

The body is exactly this, and nothing else:

```markdown
**Project**: <Project Name>
**Brief**: [<title>](<link to the brief>)
**Board**: [<title>](<link to the project on the board>)

## Context

**Problem.** <who struggles today, and how>
**Outcome.** <what is true for them when the project is done>
**Decided.** <each decision already taken: who, when, and what, in their words>
**Limits.** <the size of the bet, what is out of scope, what must not happen>
**Open questions.** <what nobody knows yet>
**Sources.** <where this came from: the brief link, or "pasted by <who> on <date>">

## Changes

- <YYYY-MM-DD>: created from <the source>.

<!-- maestro:progress:start -->
<!-- maestro:progress:end -->
```

Omit the `**Brief**` line when there is no brief, and the `**Board**` line when no board item
exists. Leave the progress section empty: `/maestro:maestro sync` owns the text between the
two markers and rewrites it. Add no other field and no other heading.

**Write the Context from what the user gave, and invent nothing.** Condense the prose, but
**keep every decision, name, date, number and limit in the source's own words**, because those
are the lines that get misquoted later. Leave out a line that the source does not fill, and
keep its label with `Not known yet.` only for **Problem** and **Outcome**. When the source has
no Context at all, write `Not known yet.` under **Problem**, and let `research` fill it.

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

Give the user the project's reference and its URL, the milestones it created, and the lines
of Context that the source did not fill. Then name
the next mode: `/maestro:maestro research` to explore, or `/maestro:maestro spec` to write
the requirements.

## What init does not do

- It writes no file, and no configuration. `/maestro:maestro setup` writes
  the config and creates the labels.
- It creates no board item. `/maestro:maestro sync` writes to the board.
- It writes no progress. The progress section starts empty, and sync fills it.
- It writes nothing into Context that the source does not say.
