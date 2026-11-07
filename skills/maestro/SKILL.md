---
name: maestro
description: Orchestrate the work once a team has decided to build something — set Maestro up in a repository, open the project, research a topic, write the spec and its requirements, build one task, sync progress to the board, review a pull request against the team's blueprints, and announce a pull request in the team's chat. The artifacts are a tree in a store, GitHub Issues by default or the team's tracker through its MCP, and durable learnings go to shared project memory. Use when setting Maestro up in a repository, starting a project, researching, writing requirements, building a task, updating the board, reviewing a pull request ("review my changes"), or announcing a pull request ("post the PR to Slack", "announce this PR", "post the stack").
argument-hint: "<setup|init|research|spec|build|sync|review|announce> [optional argument]"
metadata:
  tags: research,requirements,execution,shared-memory
  alwaysApply: "false"
---

# Maestro

Maestro runs the work once the team has decided to build something. **Your brief keeps the
argument, and the store holds the work.** A brief is any PRD, RFC or doc that says why, in any
tool. A project needs none.

A project is a tree of artifacts in a store: GitHub Issues by default, or the team's tracker.
An agent keeps that tree current, so the person who picks a project up finds its research, its
requirements and its open tasks in one place, and finds them true.

Durable, cross-cutting knowledge does not live in the tree. It lives in shared project memory,
which a team setup loads into every session on its own. See [memory.md](memory.md).

## Configuration

The config is one JSON file, in one of two places. `/maestro:maestro setup` asks which, and
writes it with every value. The file is optional, and every field has a default.

| Scope  | The config                                | Memory and blueprints by default    |
| ------ | ----------------------------------------- | ----------------------------------- |
| `team` | `.maestro/config.json` in the repository  | `.maestro/` in the repository, committed |
| `me`   | `~/.maestro/<owner>/<repo>/config.json`   | the same private folder, never in the repository |

**The team file wins.** A private config is read only when the repository holds no
`.maestro/config.json`. `<owner>/<repo>` comes from the `origin` remote, so every clone and
worktree of one repository shares one private folder.

**Read the config at the start of every mode, with one command:**

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/config.mjs
```

It finds the file, applies the defaults, and prints every field with `scope`. It prints
`memoryDir` and `blueprintMap` as absolute paths, so use them as they are. Never look for
`.maestro/config.json` by hand, because a private config is not in the repository. **When
`scope` is `me`, read `<memoryDir>/MEMORY.md` next**, because no `CLAUDE.md` loads a private
memory.

| Field                   | Default                              | Used by                                    |
| ----------------------- | ------------------------------------ | ------------------------------------------ |
| `baseBranch`            | `main`                               | `build`, `review`, the pull request shape  |
| `memoryDir`             | `.maestro/memory`, or `memory` for `me` | every mode that reads or writes memory     |
| `blueprintMap`          | `.maestro/blueprints/map.json`, or `blueprints/map.json` for `me` | every mode that reads a blueprint          |
| `prTemplate`            | `.github/pull_request_template.md`   | `build`                                    |
| `branchPattern`         | none: plain kebab-case               | `build`, the project name, see Context     |
| `method`                | `default`                            | `init`, `spec`, `sync`, see Methods        |
| `store`                 | `github`                             | every mode that touches an artifact, see Stores |
| `tracker.instructions`  | none: the mode asks once             | every mode, when `store` is `tracker`      |
| `announce.slackChannel` | none: `announce` asks for a channel  | `announce`                                 |
| `board.instructions`    | none: `sync` writes the project only | `sync`                                     |

A relative `memoryDir` or `blueprintMap` is relative to the repository for `team`, and to the
private folder for `me`. `~` is the home folder, so a private config can point at a folder
the team shares, such as a clone of a separate repository. The paths inside a blueprint map
are relative to the map's own folder.

`branchPattern` is the branch name of a task, such as `"<type>/<slug>"`. `<type>` is the kind
of change (feat, fix). `<n>` is optional (e.g. `sprint-<n>/<slug>`), taken from the user or the
newest matching branch, never guessed. Without the field, the branch is plain kebab-case.

## The tree

```
Project                 the root, a pointer: links, progress
├── Research            what was unknown before the work
├── Spec                the requirements, as its sections
│   ├── Task            the unit a pull request closes
│   └── Task
└── Spec
    └── Task
```

An artifact is one node of the tree. Its kind is project, research, spec or task, and it has a
title, a body, a status and a parent. The store file says how each kind is marked, such as a
label on GitHub.

**The spec is the unit of progress.** A requirement lives inside a spec, as a section, and it
carries a namespaced identifier such as `BIE-REQ-4`.

**A spec may carry a milestone.** A milestone is an optional stage of the project, such as a
phase or a release. A spec belongs to one milestone at most, its tasks take the spec's
milestone, and `sync` groups progress by milestone. The **milestones** operation lists,
creates and sets them, and the store file says how a milestone is named.

**The project is a pointer, not a document.** Its body holds the fields that link the brief
and the board, and a progress section between `<!-- maestro:progress:start -->` and
`<!-- maestro:progress:end -->`. `init` writes the fields. `sync` owns the progress section,
and no other mode writes inside it. When a store strips the two markers, its store file gives
the fallback.

**A body reference is not enough.** A child joins its parent through the store's own link, so
that the store itself shows the tree, and one query finds every project.

A **reference** names one artifact in text: `#12` on GitHub, `ENG-123` on Linear, `PROJ-45` on
Jira. The mode files write `<ref>`.

**No mode writes a planning file.** The output of every mode is an artifact in the store, or a
pull request.

### Stores

**Where the artifacts live is a store.** `store` in the config picks it, and the
default is `github`. Pull requests and the review stay on GitHub with every store.

| Store     | File                                                         | The artifacts are                                         |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| `github`  | [references/stores/github.md](references/stores/github.md)   | labelled issues, sub-issues and milestones                |
| `tracker` | [references/stores/tracker.md](references/stores/tracker.md) | what `tracker.instructions` maps, through the tracker's MCP |

**A mode names an operation, and the store file runs it.** Every mode that touches an artifact
reads `references/stores/<store>.md`, and uses these operations, in bold, and no other:

| Operation         | What it does                                                                         |
| ----------------- | ------------------------------------------------------------------------------------ |
| **ready**         | Make the store ready: the labels on GitHub, the MCP and the mapping on a tracker     |
| **find projects** | List the projects, open and closed                                                   |
| **create**        | Create an artifact of a kind under a parent, with a title and a body, and return its reference |
| **read**          | Read an artifact's title, body, status and parent                                    |
| **replace body**  | Replace the whole body, then read it back and compare                                |
| **children**      | List an artifact's children, with the kind and the status of each                    |
| **milestones**    | List or create the project's milestones, and set an artifact's milestone             |
| **close**         | Mark an artifact done                                                                |
| **link PR**       | The line a pull request body carries so that merging it closes the task, and how to find the task from a pull request |

**Every command and every trap of a store lives in its store file**, and in no mode file. A
store that does a new job adds it to its file, and the modes do not change.

When `store` is `tracker` and `tracker.instructions` is empty, the mode asks the user for the
mapping once, then offers to save it to the config.

### Methods

**The core is method-neutral.** The tree, the stores and the modes are the same for Scrum,
Kanban, RFCs or no method at all, and a team picks its method with `method` in the
config. The default needs nothing more.

When `method` is `shape-up`, `init`, `spec` and `sync` read [references/methods/shape-up.md](references/methods/shape-up.md) and apply its section for their mode: the Shape Up preset changes words, never the kinds, and reads a milestone as a scope.

## The tree modes

| Mode         | Command                     | What it does                                                         | Output                          |
| ------------ | --------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| **setup**    | `/maestro:maestro setup`    | Once per repository: asks whether the team or only you use it, then each value, and writes the config, the memory index and the labels | The config, a ready store |
| **init**     | `/maestro:maestro init`     | Once per project: opens the project with a fixed body, and its milestones | Project                    |
| **research** | `/maestro:maestro research` | Reads five sources in parallel, grills last                          | Research                        |
| **spec**     | `/maestro:maestro spec`     | Writes the requirements, then proposes the tasks                     | Spec, tasks                     |
| **build**    | `/maestro:maestro build`    | Takes one task, writes the code, opens the draft pull request        | Code, and a pull request        |
| **sync**     | `/maestro:maestro sync`     | Reads the tree and writes progress per spec into the project, one way | A progress section that is true |

### How one project runs

0. `/maestro:maestro setup` sets the repository up, once. Run it again to change a value.
1. `/maestro:maestro init` opens the project.
2. `/maestro:maestro research` explores, then grills, then writes a research artifact under it.
3. `/maestro:maestro spec` writes the spec, then proposes the tasks. The author approves them.
4. `/maestro:maestro build` takes one task, asks for native plan mode, writes the code, and
   opens a draft pull request that closes the task.
5. `/maestro:maestro sync` writes the progress per spec into the progress section of the
   project, and to the board too when one is configured.

Not every project needs every mode. A small fix needs one task and a build.

## Reviewing a diff

| Mode       | Command                   | What it does                                                                                       | Output                |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------------------- | --------------------- |
| **review** | `/maestro:maestro review` | Reviews a pull request against the blueprints, through `${CLAUDE_PLUGIN_ROOT}/workflows/maestro-review.js` | A pull request review |

It sits outside the tree, like the mode below: any pull request can use it. **A request to
review a diff against the team's standards goes to this mode.** It reviews a pushed pull
request locally, on the user's own Claude session and `gh` token, and posts the result as a
pull request review. Then the session fixes the findings, pushes the fixes, replies to each
finding and starts a re-check, until the review approves or only declined findings are left.

## Announcing a pull request

| Mode         | Command                     | What it does                                                         | Output                    |
| ------------ | --------------------------- | -------------------------------------------------------------------- | ------------------------- |
| **announce** | `/maestro:maestro announce` | Writes the team's announcement and its reviewers, asks once, then posts it | A chat message, PR ready |

It sits outside the tree: any pull request can use it, inside a project or not. **A request to
post, share or announce a pull request in chat goes to this mode**, whatever words it uses.

`plan` and `pr-shape` are not modes. `build` applies the pull request shape standard before a
pull request opens, and `/maestro:maestro review` gives the verdict on the diff it reviews.

## Dispatching

**The mode files are not separate skills.** Claude Code loads this file only. A mode's
instructions load when you read its file, so **read the mode file before you run the mode**,
every time.

**With an argument** (`/maestro:maestro spec`), read the matching file under Modes below,
then follow it. A request in words, such as "post the PR to Slack", goes to the matching mode
in the same way. An optional second argument can follow the mode, such as a reference.

**With no argument** (`/maestro:maestro`):

1. Read the store file, then **find projects**.
2. Ask the user to continue one of them, or to start a new one.
3. Ask which mode to run.
4. Pass the project's reference to the mode, so it asks nothing you already know.

## Shared conventions

### Shared project memory

Durable, cross-cutting knowledge lives in the memory directory (`memoryDir`), indexed by its
`MEMORY.md`. For a team, the index loads into every session through a pointer in the
repository's `CLAUDE.md`. For `me`, every mode reads it after the config. The format and the rules are in **[memory.md](memory.md)**.

- **Read it** in `research` and `spec`: scan the index before exploring, so that nothing
  already settled is derived again.
- **Write it** in `build`: record only durable, cross-cutting learnings, and look for an
  existing fact before you add one.

### Pull request shape

A task is the unit a pull request closes, and a pull request closes one or more tasks. The
size, the exclusions and the five ways to split are in
**[references/pr-shape.md](references/pr-shape.md)**. Restate none of its numbers anywhere
else.

- **`spec`** sizes each requirement as one concern and one vertical slice.
- **`build`** opens the pull request with the store's **link PR** line. When the branch
  carries two concerns, it offers a second task before the pull request opens.

A discovery during the work becomes a task. **It never extends an open pull request.**

### Native Claude Code features

Maestro uses what is built in, and re-implements none of it.

- **Plan mode.** `research` and `spec` are read-only. `build` asks for native plan mode
  before it writes code.
- **Task tracking.** `build` uses `TaskCreate`, `TaskUpdate` and `TaskList` for the working
  set inside one session. The task in the store stays the cross-session record.
- **Blueprints.** A blueprint is a markdown file that states what good looks like on one part
  of the repository. The blueprint map (`blueprintMap`) ties paths to blueprints. Every mode
  reads the blueprint for the paths it touches, and restates none of its rules. With no map,
  a mode works from the code and says that it found no blueprints.
- **Sibling skills.** If a grilling skill is installed (for example `/grill-me`), use it for
  the grilling, else grill inline. If a plain-English writing skill is installed, use it for
  the prose. `/maestro:maestro review` and `/simplify`, when installed, are the quality
  passes. Name them, and duplicate none of their guidance. **A mode offers a quality pass and
  never launches one unasked**, because each one spends the author's tokens and minutes.

### Sub-agents

Use sub-agents for any work that gains from isolated context or from running in parallel:
mapping an architecture, tracing a data flow, reading several artifacts, understanding a
dependency.

- **Name the blueprint in every sub-agent prompt.** A sub-agent starts with its own context,
  and inherits nothing you have read.
- **Name the store file too**, when the sub-agent reads or writes an artifact.
- **Fire independent sub-agents in one message**, so that they run at the same time.
- Do not use one for a single known file, a small edit, or a step whose answer you hold.

### Writing a body

Every mode writes a body, and `spec`, `build` and the open-questions gate edit one that
exists. A body is the record of a project, so a lost body loses the work above it.

**Read the body back after every write, and compare it with what you wrote.** A write can
report success and leave the body empty, unchanged or wrong, and no store says so. Report an
edit only after the read-back matches. The store file gives the commands and the traps of its
store, under **create** and **replace body**.

### The open-questions gate

An artifact with unresolved open questions blocks the work that depends on them.

1. List them for the user.
2. Work through them one at a time: explore the codebase, present the trade-offs.
3. Resolve each one, or mark it **deferred** with a reason, then **replace body** of the
   artifact.

A deferred question is acceptable, because the team then chose to go on with the uncertainty.
An unaddressed one is not.

### Asking the user

Use `AskUserQuestion` for every structured choice: picking a project, approving the tasks,
resolving an open question, confirming a namespace, confirming a tracker mapping. Use plain
text only when the answer is free-form.

### Context

- **Project name.** Kebab-case. Read it from the `<slug>` part of the branch, or from the
  project's title.
- **Namespace.** Derived from the project name by `spec`, and confirmed with the user.

## Modes

- [setup/SKILL.md](setup/SKILL.md) — set the repository up: the configuration, the memory index, the store
- [init/SKILL.md](init/SKILL.md) — open the project, and its milestones
- [research/SKILL.md](research/SKILL.md) — five sources, the grilling last, a research artifact
- [spec/SKILL.md](spec/SKILL.md) — the requirements, and the tasks
- [build/SKILL.md](build/SKILL.md) — build one task, and open the pull request
- [sync/SKILL.md](sync/SKILL.md) — read the tree, and write the progress section
- [review/SKILL.md](review/SKILL.md) — review a pull request against the team's blueprints
- [announce/SKILL.md](announce/SKILL.md) — announce a pull request in the team's chat

Shared references:

- [memory.md](memory.md) — shared project memory
- [references/stores/github.md](references/stores/github.md) — each store operation on
  GitHub Issues, its commands and its traps
- [references/stores/tracker.md](references/stores/tracker.md) — each store operation on a
  tracker, through its MCP
- [references/pr-shape.md](references/pr-shape.md) — pull request size, one concern per pull
  request, how to split
- [references/review-risk.md](references/review-risk.md) — what a reviewer reads first
