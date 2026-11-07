---
name: sync
description: Read the pitch issue tree and write each scope's hill progress into the progress section of the pitch issue, one way. Gathers the evidence from the specs and their task issues, giving a task partial credit for a draft or a ready pull request, proposes a hill position, and writes the number the author gives. Rewrites only its own section and reads it back. When the config describes a board, pushes the same numbers there too. The board never writes back.
argument-hint: "[pitch issue number or pitch name]"
---

# Sync

Read the pitch tree in GitHub, and write what it says into one place that people read.

**One way. Nothing writes back**, because two writers on one record conflict. GitHub holds the
content. The progress section, and the board when there is one, hold the high-level view.

**The default target is a progress section in the pitch issue body.** When
`.maestro/config.json` holds `board.instructions`, sync also pushes the same numbers through
what those instructions describe: an MCP tool, a `gh project` command, or anything else.
Without that field, or with an empty one, the pitch issue is the only target.

**Sync owns its section and regenerates it whole.** Anything a person types inside it is
replaced on the next run. That is why sync writes the explanation of the hill position as
well as the position itself: the section has to stay readable without a human writing it. Put
commentary that must survive in the spec issue, which is the artifact for it.

## Workflow

### 1. Read the pitch tree

Find the pitch issue, then walk down it:

```bash
gh issue list --label maestro:pitch --state all --search "<pitch name>" --json number,title,body
gh api repos/{owner}/{repo}/issues/<pitch>/sub_issues
```

For each spec sub-issue, read its body and its own sub-issues. **Read the task states with
`--state all`**, because a closed task is the one that counts as done and a default query
hides it.

You need, per spec: its `**Scopes**` field if present, its requirements, its open questions,
and its task issues with their state.

### 2. Attribute each spec to its scopes

The scopes come from shaping, and the pitch issue names them. Attribution follows one rule:

Which specs feed a scope:

- **The pitch holds one spec: it covers every scope.** No `**Scopes**` header is needed.
- **The pitch holds more than one spec: each names its scopes in a `**Scopes**` header
  field**, and each scope is fed by the specs that name it.
- **A spec with no `**Scopes**` field, in a pitch that holds more than one spec, is an
  error.** Report it, and write nothing for that spec. **Never guess**, because a wrong
  attribution is a wrong number that nobody can see is wrong.

**Which tasks count for a scope is decided by the spec's Tasks section, and not by the number
of specs.** Read that section first:

- **It groups the tasks under scope headings: count each group against its scope.** This is
  the usual case, and it is how a single spec still gives four scopes four different numbers.
- **It is a flat list: every task counts for every scope the spec feeds**, and those scopes
  all get the same number.

A flat list in a spec that feeds several scopes is not an error, but it is a blunt instrument:
it gives every scope the pitch's overall number. Say so in the report, so the author can add
the grouping if they wanted separate hills.

If the pitch names no scope at all, **use one scope named for the pitch**, since it is then
the pitch's only scope.

### 3. Compute the hill, then ask

**The hill is a judgement about progress, and not a calculation.** Sync reads the evidence
and computes a reading. The author gives the number that lands. That order is the normal path
here, and not an exception for a disagreement.

**The task count cannot be the truth, because its denominator grows.** A scope at ten of
fourteen tasks reads 0.86. Size three more requirements into six tasks and the same ten
become ten of twenty, so the hill slides back to 0.75 with nothing regressed and more work
merged. A number that moves the wrong way on good news is worse than no number. Eighty
percent of today's tasks is not eighty percent of the scope, because tomorrow adds tasks.

**The two halves.**

- **Uphill, 0 to 0.5, is discovery.** Nobody yet knows how the scope gets built, and the way
  to find out is to research, to spike and to ask. A scope with no spec and no answers sits
  near the bottom.
- **The crossing, 0.5, is where the way you answer an unknown changes.** Uphill you answer it
  by investigating. Downhill you answer it by building. **Unknowns do not end at the
  crossing.** A scope carries them the whole way down, and meeting a new one while building
  does not send it back up. The crossing means the shape is clear enough to execute, and
  never that nothing is left to learn.
- **Downhill, 0.5 to 1, is implementation.** Once tasks exist and are in build, the scope is
  past the crossing, and past it for certain.

**A fully shaped scope with nothing built sits exactly at the top of the hill, 0.5.** A flat
hill then reads as missing shaping, and not as a stalled build.

**A requirement nobody has sized holds nothing back once the building has started.** Name it
in the section. Do not spend it on the number.

**The evidence to gather, and to show.** Each task earns credit as it advances, and not only
when it closes.

| The task                                   | Credit |
| ------------------------------------------ | ------ |
| Closed                                     | 1      |
| The author says it is done                 | 1      |
| Open, with a pull request ready for review | 0.8    |
| Open, with a pull request still in draft   | 0.5    |
| Open, with no pull request                 | 0      |

**A pull request is real progress and the hill says so.** Work that is written and waiting on
a merge is not the same as work nobody has started.

**Draft and ready are different states, and the gap between them is who holds the work.** A
draft is still the author's. A pull request marked ready for review has left their hands and
waits on other people, which is most of the way to done.

Find the pull request from the task issue, then read its draft state. Read every task with
`--state all`:

```bash
gh issue view <task> --json state,closedByPullRequestsReferences
gh pr view <pr> --json isDraft,state
```

A task carrying more than one pull request takes the credit of the furthest along.

**Compute `0.5 + 0.5 × (credit ÷ tasks total)` for a scope that is executing, and say what it
is.** It is a reading over the tasks that exist today. Offer a number below the crossing only
when no task exists yet and the scope is still being worked out.

**An open question keeps a scope uphill only while it is the thing being worked on.** A
question nobody can answer without investigating holds a scope that has not begun. The same
question, on a scope whose tasks are merging, is carried rather than blocking.

**Spec granularity sets progress granularity.** One spec covering four scopes gives those four
scopes the same evidence. A pitch that wants four separate hills writes four specs.

### 4. Ask for the number

**Ask with `AskUserQuestion`, every run, and write the answer.** The hill is the author's
judgement, and the section is shared. Offer the reading from step 3 as one option, say what
it is a reading of, and offer the alternatives a scope's evidence suggests.

**Show the credit per task, and not only the number.** The author can then see which task the
reading came from, and correct the one that is wrong. Say in the section which tasks the
author called done.

**Write in the section that the number was given.** The section says what the evidence was
and where the author put the scope against it. A reader can then tell a position somebody
chose from a ratio a machine produced.

### 5. Write the progress section

**Read the pitch body again just before you write.** A person can have edited another part
of it since step 1, and your write replaces the whole body.

Replace only the text between the two markers, and keep everything outside them byte for
byte. When the markers are missing, append the section at the end of the body.

```markdown
<!-- maestro:progress:start -->
## Progress

### Export to CSV — hill 0.7

**Spec**: [#101](https://github.com/acme/shop/issues/101) — EXP-REQ-1 to EXP-REQ-7

**Tasks**

- [x] [#104](https://github.com/acme/shop/issues/104) — the writer and its tests
- [~] [#105](https://github.com/acme/shop/issues/105) — the export button ·
  [#112](https://github.com/acme/shop/pull/112) ready for review

Progress: 1 task done, 1 out for review. Credit 1.8 of 2.

**Hill: going down, 0.7, given by the author.** Every requirement is written and its tasks
exist, and the last unknown is answered. The writer has landed, and the button is out for
review.

<!-- Written by /maestro:maestro sync. This section is regenerated on every run, so anything typed here is replaced. Commentary that must survive belongs in the spec issue. -->
<!-- maestro:progress:end -->
```

**Mark a task by its credit, so the line and the number agree.** `[x]` for a task that is
done, `[~]` for one carrying a pull request, `[ ]` for one not started. **Name the pull
request's state on the line** — `ready for review` or `draft` — because the two earn different
credit, and a reader cannot otherwise reach the number in the progress line. When the author
called a task done, write `[x]` and say so on the line: `— done, called by the author`.

**End the section with that comment.** A person who opens the body to type inside the section
is the one who needs the warning, and the section is where they are standing. It does not
render.

The example is literal on purpose. Write the real issue links, and never a placeholder in
angle brackets: a formatter rewrites `](<url>)` inside a fence, and the template stops being
the thing it describes.

One scope per heading, and one spec per block. A scope fed by two specs carries two blocks.

**The hill paragraph carries the evidence, and never only the number.** Write it from the
facts of step 3: uphill, name the unknown the scope is working out and how it is being
answered; downhill, name what has landed, what is out for review, and what is still unsized
or waiting on a person. A reader must be able to disagree with the position from the
paragraph alone.

**Write the body from a file, and check the file first.** `gh issue edit --body-file` accepts
an empty file, exits 0, and wipes the pitch. Make sure the file holds the whole body, with
the text outside the markers unchanged:

```bash
D=$(mktemp -d)
gh issue view <pitch> --json body --jq .body > "$D/before.md"
# write $D/after.md: before.md with only the marked section replaced
test -s "$D/after.md" && gh issue edit <pitch> --body-file "$D/after.md"
gh issue view <pitch> --json body --jq .body > "$D/readback.md"
diff "$D/before.md" "$D/readback.md"
```

**Read the diff.** It must show the progress section changed and nothing else. If any other
line moved, put `before.md` back with `--body-file` and report it.

### 6. Push to the board, when there is one

**Only when `board.instructions` is set and not empty.** Follow what it describes, and push the same
numbers and the same evidence the section holds. Never a number that differs from the
section.

- **Read the board only to find an id**, so that a second run updates a record rather than
  creating a duplicate. Never read it as an authority.
- **Pass only the fields you computed** when the tool accepts a partial update, so a field
  you omit keeps its value.
- If the instructions name a tool that is not connected, say so, and stop after the pitch
  issue. The section is already written.

### 7. Report

Say what was written, per scope: the number before, the number after, and the reason it moved.
Name any spec you skipped for a missing `**Scopes**` field or a missing task grouping. Say
whether the board was written, skipped, or failed.

## What sync does not do

- **It mirrors no task onto a board.** A board task hangs off a scope, a task issue hangs off
  a spec, and a spec covers several scopes, so the mapping is ambiguous and the value is a
  number GitHub already holds.
- **It never reads the board as an authority.** The board never writes back.
- **It does not decide the hill.** It gathers the evidence, computes a reading, and writes the
  number the author gives. A number typed into the section or the board between two runs is
  replaced, because the next run asks again rather than reading what was typed. Say the
  position to sync, and it lands with the evidence beside it.
- It edits nothing outside its section, and writes no file in the repository.
