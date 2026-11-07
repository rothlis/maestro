---
name: maestro
description: Orchestrate the work once a team has decided to build something — open the project issue, research a topic, write the spec and its requirements, build one task, sync progress to the board, review a pull request against the team's blueprints, and announce a pull request in the team's chat. The artifacts are a tree of labelled GitHub issues, and durable learnings go to shared project memory. Use when starting a project, researching, writing requirements, building a task, updating the board, reviewing a pull request ("review my changes"), or announcing a pull request ("post the PR to Slack", "announce this PR", "post the stack").
argument-hint: "<init|research|spec|build|sync|review|announce> [optional argument]"
metadata:
  tags: research,requirements,execution,shared-memory
  alwaysApply: "false"
---

# Maestro

Maestro runs the work once the team has decided to build something. **Your brief keeps the
argument, and GitHub holds the work.** A brief is any PRD, RFC or doc that says why, in any
tool. A project needs none.

A project is a tree of labelled GitHub issues. An agent keeps that tree current, so the
person who picks a project up finds its research, its requirements and its open tasks in one
place, and finds them true.

Durable, cross-cutting knowledge does not live in the tree. It lives in shared project memory,
which loads into every session on its own. See [memory.md](memory.md).

## Configuration

A team can put `.maestro/config.json` at the root of its repository. The file is optional,
and every field has a default.

| Field                  | Default                             | Used by                                    |
| ---------------------- | ----------------------------------- | ------------------------------------------ |
| `baseBranch`           | `main`                              | `build`, `review`, the pull request shape  |
| `memoryDir`            | `docs/memory`                       | every mode that reads or writes memory     |
| `blueprintMap`         | `.maestro/blueprints/map.json`      | every mode that reads a blueprint          |
| `prTemplate`           | `.github/pull_request_template.md`  | `build`                                    |
| `branchPattern`        | none: plain kebab-case              | `build`, the project name, see Context     |
| `method`               | `default`                           | `init`, `spec`, `sync`, see Methods        |
| `announce.slackChannel` | none: `announce` asks for a channel | `announce`                              |
| `board.instructions`   | none: `sync` writes the project issue | `sync`                                   |

Read the file once at the start of a mode. A missing file or a missing field takes the
default.

`branchPattern` is the branch name of a task, such as `"<type>/<slug>"`. `<type>` is the kind
of change (feat, fix). `<n>` is optional (e.g. `sprint-<n>/<slug>`), taken from the user or the
newest matching branch, never guessed. Without the field, the branch is plain kebab-case.

## The tree

```
Project issue                       maestro:project    the root, a pointer: links, progress
├── Research issue                  maestro:research   what was unknown before the work
├── Spec issue                      maestro:spec       the requirements, as its sections
│   ├── Task issue                  maestro:task       the unit a pull request closes
│   └── Task issue
└── Spec issue
    └── Task issue
```

**The spec is the unit of progress.** A requirement lives inside a spec, as a section, and it
carries a namespaced identifier such as `BIE-REQ-4`.

**A spec may carry a milestone.** A milestone is an optional stage of the project, such as a
phase or a release. It is a native GitHub milestone named `<project-slug>/<milestone-name>`,
because milestones are repository-wide and the prefix ties them to one project. A spec
belongs to one milestone at most, its tasks take the spec's milestone, and `sync` groups
progress by milestone.

**The project issue is a pointer, not a document.** Its body holds the fields that link the
brief and the board, and a progress section between `<!-- maestro:progress:start -->` and
`<!-- maestro:progress:end -->`. `init` writes the fields. `sync` owns the progress section,
and no other mode writes inside it.

**A body reference is not enough.** The parent and the child must be joined through the
sub-issues API, so that GitHub itself shows the tree and one query finds every project.

| Issue    | Label              |
| -------- | ------------------ |
| Project  | `maestro:project`  |
| Research | `maestro:research` |
| Spec     | `maestro:spec`     |
| Task     | `maestro:task`     |

`/maestro:maestro init` creates any label that is missing. No other mode creates a label.

### How a mode attaches a child

Attach the child in the same call that creates it. `gh` 2.100.0 and later has the flag
natively.

```bash
gh issue create --title "<title>" --label <label> --parent <parent> --body-file <path>
```

`gh issue edit` carries `--parent`, `--add-sub-issue`, `--remove-sub-issue` and
`--remove-parent`, for a child that already exists. To read a tree:

```bash
gh api repos/{owner}/{repo}/issues/<parent>/sub_issues
```

**Fallback, for a direct REST call or a `gh` older than 2.100.0.** The `sub_issues`
endpoint takes the child's `id`, and never its issue number, and `gh` must send it as an
integer with `-F`. `-f` sends a string, and the API answers
`422 ... is not of type integer`. This is the only copy of that trap.

**No mode writes a planning file.** The output of every mode is a GitHub issue or a pull
request.

### Methods

**The core is method-neutral.** The tree, the labels and the modes are the same for Scrum,
Kanban, RFCs or no method at all, and a team picks its method with `method` in
`.maestro/config.json`. The default needs nothing more.

When `method` is `shape-up`, `init`, `spec` and `sync` read [references/methods/shape-up.md](references/methods/shape-up.md) and apply its section for their mode: the Shape Up preset changes words, never labels, and reads a milestone as a scope.

## The five tree modes

| Mode         | Command                     | What it does                                                        | Output                     |
| ------------ | --------------------------- | ------------------------------------------------------------------- | -------------------------- |
| **init**     | `/maestro:maestro init`     | Opens the project issue, with a fixed body, and creates missing labels | Project issue            |
| **research** | `/maestro:maestro research` | Reads five sources in parallel, grills last                         | Research issue             |
| **spec**     | `/maestro:maestro spec`     | Writes the requirements, then proposes the task issues              | Spec issue, task issues    |
| **build**    | `/maestro:maestro build`    | Takes one task issue, writes the code, opens the draft pull request | Code, and a pull request   |
| **sync**     | `/maestro:maestro sync`     | Reads the tree and writes progress per spec into the project issue, one way | A progress section that is true |

### How one project runs

1. `/maestro:maestro init` opens the project issue.
2. `/maestro:maestro research` explores, then grills, then writes a research issue under it.
3. `/maestro:maestro spec` writes the spec issue, then proposes the task issues. The author
   approves them.
4. `/maestro:maestro build` takes one task issue, asks for native plan mode, writes the
   code, and opens a draft pull request that closes the task.
5. `/maestro:maestro sync` writes the progress per spec into the progress section of the
   project issue, and to the board too when one is configured.

Not every project needs every mode. A small fix needs one task issue and a build.

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
in the same way. An optional second argument can follow the mode, such as an issue number.

**With no argument** (`/maestro:maestro`):

1. Find the projects: `gh issue list --label maestro:project --state all`.
2. Ask the user to continue one of them, or to start a new one.
3. Ask which mode to run.
4. Pass the project issue number to the mode, so it asks nothing you already know.

## Shared conventions

### Shared project memory

Durable, cross-cutting knowledge lives in the memory directory (`memoryDir`, default
`docs/memory/`), indexed by its `MEMORY.md`, which loads into every session through a pointer
in the repository's `CLAUDE.md`. The format and the rules are in **[memory.md](memory.md)**.

- **Read it** in `research` and `spec`: scan the index before exploring, so that nothing
  already settled is derived again.
- **Write it** in `build`: record only durable, cross-cutting learnings, and look for an
  existing fact before you add one.

### Pull request shape

A task issue is the unit a pull request closes, and a pull request closes one or more tasks.
The size, the exclusions and the five ways to split are in
**[references/pr-shape.md](references/pr-shape.md)**. Restate none of its numbers anywhere
else.

- **`spec`** sizes each requirement as one concern and one vertical slice.
- **`build`** opens the pull request with a `Closes #<task>` line. When the branch carries two
  concerns, it offers a second task issue before the pull request opens.

A discovery during the work becomes a task issue. **It never extends an open pull request.**

### Native Claude Code features

Maestro uses what is built in, and re-implements none of it.

- **Plan mode.** `research` and `spec` are read-only. `build` asks for native plan mode
  before it writes code.
- **Task tracking.** `build` uses `TaskCreate`, `TaskUpdate` and `TaskList` for the working
  set inside one session. The task issue stays the cross-session record.
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
mapping an architecture, tracing a data flow, reading several issues, understanding a
dependency.

- **Name the blueprint in every sub-agent prompt.** A sub-agent starts with its own context,
  and inherits nothing you have read.
- **Fire independent sub-agents in one message**, so that they run at the same time.
- Do not use one for a single known file, a small edit, or a step whose answer you hold.

### Writing an issue body

Every mode writes an issue body, and `spec`, `build` and the open-questions gate edit one
that exists. A body is the record of a project, so a lost body loses the work above it.

- **`gh issue edit --body-file` replaces the whole body.** An edit that adds one line
  rewrites the whole document.
- **An empty body is accepted.** `gh` writes it, exits `0` and prints the issue URL. A script
  inside a quoted command substitution that produces nothing empties the body, and nothing
  says so.
- **Read the body back before you report the edit.** Exit `0` is not proof:

```bash
gh issue view <n> --json body --template '{{.body}}' | diff - <path>
```

### The open-questions gate

An issue with unresolved open questions blocks the work that depends on them.

1. List them for the user.
2. Work through them one at a time: explore the codebase, present the trade-offs.
3. Resolve each one, or mark it **deferred** with a reason, and edit the issue.

A deferred question is acceptable, because the team then chose to go on with the uncertainty.
An unaddressed one is not.

### Asking the user

Use `AskUserQuestion` for every structured choice: picking a project, approving the task issues,
resolving an open question, confirming a namespace. Use plain text only when the answer is
free-form.

### Context

- **Project name.** Kebab-case. Read it from the `<slug>` part of the branch, or from the
  project issue.
- **Namespace.** Derived from the project name by `spec`, and confirmed with the user.

## Modes

- [init/SKILL.md](init/SKILL.md) — open the project issue, and create missing labels
- [research/SKILL.md](research/SKILL.md) — five sources, the grilling last, a research issue
- [spec/SKILL.md](spec/SKILL.md) — the requirements, and the task issues
- [build/SKILL.md](build/SKILL.md) — build one task issue, and open the pull request
- [sync/SKILL.md](sync/SKILL.md) — read the tree, and write the progress section
- [review/SKILL.md](review/SKILL.md) — review a pull request against the team's blueprints
- [announce/SKILL.md](announce/SKILL.md) — announce a pull request in the team's chat

Shared references:

- [memory.md](memory.md) — shared project memory
- [references/pr-shape.md](references/pr-shape.md) — pull request size, one concern per pull
  request, how to split
- [references/review-risk.md](references/review-risk.md) — what a reviewer reads first
