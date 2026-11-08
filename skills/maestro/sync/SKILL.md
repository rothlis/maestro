---
name: sync
description: Read the project tree and write progress per spec, grouped by milestone, into the progress section of the project body, one way. Per spec it counts the status, the tasks closed of the total, the tasks with a draft or a ready pull request, and the open questions. Counts, never a percentage. Rewrites only its own section and reads it back. When the config describes a board, pushes the same counts there too. The board never writes back.
argument-hint: "[project reference or project name]"
---

# Sync

If the config sets `method` to `shape-up`, read `../references/methods/shape-up.md` and apply its section for this mode.

Run every artifact operation through the store file: `../references/stores/<store>.md`, where
`<store>` is config `store` (default `github`).

Read the project tree in the store, and write what it says into one place that people read.

**One way. Nothing writes back**, because two writers on one record conflict. The store holds
the content. The progress section, and the board when there is one, hold the high-level view.

**The default target is a progress section in the project body.** When
the config holds `board.instructions`, sync also pushes the same counts through
what those instructions describe: an MCP tool, a `gh project` command, or anything else.
Without that field, or with an empty one, the project is the only target.

**Sync never touches the `## Context` section or the `## Changes` log.** People, `init`,
`research` and `spec` own those.

**Sync owns its section and regenerates it whole.** Anything a person types inside it is
replaced on the next run. That is why sync writes each count with the tasks behind it: the
section has to stay readable without a human writing it. Put commentary that must survive in
the spec, which is the artifact for it.

## Workflow

### 1. Read the project tree

**Find projects**, and take the one the argument names. **Read** it. List its
**milestones**, then walk down the tree with **children**: the project's specs, then each
spec's tasks.

For each spec, **read** its body and its milestone. **Count the closed tasks too**, because a
closed task is the one that counts as done.

You need, per spec: its milestone, its requirements, its open questions, and its tasks with
their status.

### 2. Count progress per spec

**The spec is the unit of progress.** Sync computes four things per spec, all from the tree:

| Count          | How                                                                    |
| -------------- | ---------------------------------------------------------------------- |
| Status         | `not started`, `discovery`, `building` or `done`, from the table below |
| Tasks          | closed of total, such as `3 of 7 closed`                               |
| Pull requests  | open tasks with a pull request, split into ready for review and draft  |
| Open questions | unchecked items in the spec's **Open questions** section               |

| Status        | When                                         |
| ------------- | -------------------------------------------- |
| `not started` | No task and no open question                 |
| `discovery`   | Open questions, and no task yet              |
| `building`    | At least one task, and not every task closed |
| `done`        | Every task closed, and no open question      |

A spec whose tasks are all closed but which still holds an open question stays `building`,
and the open-questions count says why.

**Counts, never a percentage.** The task total grows as work is found. A spec at ten of
fourteen tasks reads 71%. Size three more requirements into six tasks and the same ten become
ten of twenty, so the percentage slides back to 50% with nothing regressed and more work
merged. A number that moves the wrong way on good news is worse than no number. `10 of 20
closed` says both facts: the work done and the work found.

**Draft and ready are different states, and the gap between them is who holds the work.** A
draft is still the author's. A pull request marked ready for review has left their hands and
waits on other people. Count them apart.

Find the pull requests of each open task with **link PR**, then read the draft state of each
one:

```bash
gh pr view <pr> --json isDraft,state
```

A task carrying more than one pull request counts at the furthest along.

**Sync judges nothing and asks nothing.** Every count comes from the tree, so two runs on the
same tree write the same section.

### 3. Group the specs by milestone

**One heading per milestone**, in due-date order, then by title. A milestone without a due
date comes after the dated ones. Write the due date on the heading when it is set.

- **A milestone with no spec shows `not started`**, so a stage nobody has specified is still
  visible.
- **A spec with no milestone goes under `No milestone`**, last. So does a spec whose
  milestone is not among the project's **milestones**, and the report names it.
- **A project with no milestone at all has no milestone heading.** List the specs directly.

The heading uses the milestone name that the store file says a mode shows.

### 4. Write the progress section

**Read the project body again just before you write.** A person can have edited another part
of it since step 1, and your write replaces the whole body.

Find the section in that body, in this order:

1. **Both markers are there.** The section is the text between them.
2. **No markers, and a `## Progress` heading.** The store stripped the markers on an earlier
   run. The section is that heading and everything after it, to the end of the body.
3. **Neither.** Append the section at the end of the body.

Keep everything outside the section byte for byte.

```markdown
<!-- maestro:progress:start -->

## Progress

### Export to CSV · due 2026-03-20

[#101](https://github.com/acme/shop/issues/101) Export spec — building
EXP-REQ-1 to EXP-REQ-7 · 1 of 2 tasks closed · 1 ready for review · 0 open questions

- [x] [#104](https://github.com/acme/shop/issues/104) — the writer and its tests
- [~] [#105](https://github.com/acme/shop/issues/105) — the export button ·
  [#112](https://github.com/acme/shop/pull/112) ready for review

### Scheduled exports

Not started.

### No milestone

[#120](https://github.com/acme/shop/issues/120) Export limits spec — discovery
EXP-REQ-8 to EXP-REQ-9 · 0 of 0 tasks closed · 2 open questions

<!-- Written by /maestro:maestro sync. This section is regenerated on every run, so anything typed here is replaced. Commentary that must survive belongs in the spec. -->
<!-- maestro:progress:end -->
```

**Mark a task by its state, so the line and the counts agree.** `[x]` for a closed task,
`[~]` for one carrying a pull request, `[ ]` for one not started. **Name the pull request's
state on the line** — `ready for review` or `draft` — because a reader cannot otherwise reach
the count. **End the line of an open task with its assignee**, as `· @login`, so a reader
sees who holds it.

When the store's **link PR** says that merging closes nothing, **close** each open task whose
pull request merged, before you count, and name it in the report.

**End the section with that comment.** A person who opens the body to type inside the section
is the one who needs the warning, and the section is where they are standing. It does not
render.

The example is literal on purpose, and it shows the github store. Write the real links of
your store, and never a placeholder in angle brackets: a formatter rewrites `](<url>)` inside
a fence, and the template stops being the thing it describes.

Write the body with **replace body**. Before you write it, compare the old body with the new
one. Only the section must differ.

**Then read it back.** If any line outside the section moved, write the old body back with
**replace body**, and report it. If the read-back has no markers, the store strips them:

- From then on, case 2 above finds the section. So keep `## Progress` as the last heading of
  the body, and put nothing after it.
- The warning comment is stripped too. Write the same warning as the last line of the section,
  in plain text.

### 5. Push to the board, when there is one

**Only when `board.instructions` is set and not empty.** Follow what it describes, and push the
same counts the section holds. Never a count that differs from the section.

- **Read the board only to find an id**, so that a second run updates a record rather than
  creating a duplicate. Never read it as an authority.
- **Pass only the fields you computed** when the tool accepts a partial update, so a field
  you omit keeps its value.
- If the instructions name a tool that is not connected, say so, and stop after the project.
  The section is already written.

### 6. Report

Say what was written, per spec: the counts before, the counts after, and what moved them.
Name any spec whose milestone is not one of the project's. Say whether the board was written,
skipped, or failed.

## What sync does not do

- **It mirrors no task onto a board.** The tasks already live in the store, and a second copy
  is a second writer.
- **It never reads the board as an authority.** The board never writes back.
- **It does not judge progress.** It counts. A forecast or an estimate is a person's call, and
  belongs in the spec. A count typed into the section or the board between two runs is
  replaced.
- It edits nothing outside its section, and writes no file in the repository.
