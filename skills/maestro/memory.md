# Shared Project Memory

Maestro's durable knowledge lives in a memory store. Its directory is `memoryDir` in the
config. For a team setup, the default is `.maestro/memory/`, committed and shared. For a
private setup, it is `~/.maestro/<owner>/<repo>/memory/`, or a folder the user shares with
the team. This file uses the team path.

## Why this exists

A knowledge doc pays off only if somebody reads it, and the only knowledge that reliably gets
read is the kind that is **auto-loaded into every session's context**. Claude's native memory
(`MEMORY.md`) works because the harness injects its index on every turn. Standalone per-project
knowledge docs are almost never written and almost never read.

Shared project memory copies the mechanic that works, but commits it to the repo so the
**whole team** benefits, not just one developer's machine:

- **`.maestro/memory/MEMORY.md`** is the index, one line per fact. A pointer to it lives in the
  repo's root `CLAUDE.md`, so it loads into every Claude session automatically. This is what
  makes the knowledge get read.
- **`.maestro/memory/<slug>.md`** files each hold exactly one fact, with frontmatter. The body is
  pulled into context only when a session decides a fact is relevant, from its index line.

The result: cross-project decisions, patterns and solved problems surface on their own in
future work.

## The pointer in `CLAUDE.md`

**A private memory has no pointer**, because the repository's `CLAUDE.md` is part of the
repository. Every mode reads its index after it reads the config. A session that runs no
Maestro mode does not load it.

For a team setup, add these lines to the repository's root `CLAUDE.md`. The `@` import loads the index into
every session. Use the real path when `memoryDir` is not the default.

```markdown
## Shared project memory

Durable project knowledge lives in `.maestro/memory/`, one fact per file. At the start of
relevant work, read any fact whose index line looks relevant.

@.maestro/memory/MEMORY.md
```

## Layout

```
.maestro/memory/
  MEMORY.md          <- index, one line per fact, auto-loaded via the CLAUDE.md pointer
  <slug>.md          <- one fact per file (kebab-case slug)
```

## Fact file format

```markdown
---
name: <short-kebab-case-slug>
description: <one-line summary, used to decide relevance when scanning the index>
metadata:
  type: decision | pattern | problem | convention | reference
  project: <project-name> # provenance: where this was learned
  date: <YYYY-MM-DD>
  seen: 1 # how many times the lesson came back, see "Seen, and promotion to a blueprint"
  surface: <id> # optional: the blueprint map surface it holds for, when it holds for one
---

<The fact, written to be useful cold. Someone who wasn't there must be able to act on it.>

<For `decision`: state what was chosen, the rationale, and what was rejected.>
<For `problem`: state the symptom, the root cause, and the fix, with key files.>

Link related facts with [[their-slug]].
```

### Types

| Type         | Use for                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| `decision`   | An architectural or design choice, and why it beat the alternatives.        |
| `pattern`    | A reusable approach or convention discovered or established during the work. |
| `problem`    | A solved problem: symptom → root cause → fix → key files. Searchable for recurrence. |
| `convention` | A durable rule worth following (a candidate for a blueprint, or for `CLAUDE.md`). |
| `reference`  | A pointer to an external resource: an RFC or ADR, a dashboard, a ticket, a doc page. |

## Read rules (research, spec)

Before exploring the codebase, **scan `<memoryDir>/MEMORY.md`** and read any fact whose
description looks relevant to the work. This is the first place to look for prior decisions
and solved problems. It prevents re-deriving things the team already settled. It is in
addition to the project's own research artifacts, not a replacement.

## Write rules (build)

`build` is the writer. After a requirement lands, if it produced a decision, pattern or
solved problem worth carrying forward, record it here.

Only write a fact when it is **durable and cross-cutting**: something a future, unrelated
session would benefit from knowing. Do not mirror what the code, the git history, the brief
or `CLAUDE.md` already record. Most tasks produce no fact. A project that made a real
architectural decision produces one or two.

When writing a fact:

1. **Check for an existing file first.** If a fact already covers the topic, update it rather
   than creating a near-duplicate, and add 1 to its `seen`. Delete facts that turn out to be
   wrong.
2. Write the `<slug>.md` file with the frontmatter above.
3. Add a one-line pointer to `MEMORY.md`: `- [Title](<slug>.md) — <hook>`. Group it under a
   sensible `##` heading, by domain or theme.
4. Link related facts with `[[slug]]`.

`/maestro:maestro setup` creates the memory directory with an empty `MEMORY.md`, and offers
the `CLAUDE.md` pointer above. If the directory does not exist yet, create it with the first
fact and its `MEMORY.md`, and offer the pointer.

## In the moment

When the user corrects you on a matter of standard during a mode ("no, we always do X here"),
offer to record it before you go on: a new fact with `seen: 1`, or 1 more on the fact that
already says it. Write it only after the user agrees. A correction that only holds for this
task is no fact.

## Seen, and promotion to a blueprint

Memory is what the team learned. A blueprint is what the team enforces: the review cites a
blueprint rule as an authority, and uses a fact only as a lead. **A lesson that keeps coming
back belongs in a blueprint**, and `seen` is how Maestro tells that it keeps coming back.

**Add 1 to `seen` when the same lesson comes back:** the user corrects the same thing again,
a review finds a defect that the fact describes, or a build hits the same trap. Count one
event one time. One pull request or one session adds 1 at most, whatever the number of
findings in it.

**At `seen: 3`, propose a promotion.** A fact is a candidate only when all of these hold:

- its `type` is `convention`, `pattern` or `problem`. A `decision` or a `reference` stays
  in memory.
- it holds for one surface of the blueprint map, or for one set of paths.
- a reviewer can tell from a diff alone whether code obeys it.

Draft the rule or the trap in the words of the blueprint, in the right section, and show it
to the user. **Nothing writes a blueprint without the user's yes.** For a team setup, the
change goes on its own branch and pull request, for the surface's `owner` in the map to
review. For a private setup, the user is the owner, so write it after the yes.

When the paths of the fact have no surface, propose a new blueprint for them: a `README.md`
with the sections Owners, Paths, Rules, Traps and Proof, and a surface in the map. Copy the
shape of a template in `${CLAUDE_PLUGIN_ROOT}/templates/.maestro/blueprints/`.

**After the promotion is accepted, the rule lives in one place.** Delete the fact and its
index line, or cut the fact to one line that points at the blueprint rule. Two copies drift
apart, and the review would read the stale one as a lead.

## Keeping the store healthy

There is no automated consolidation mode. Memory is valuable only because it stays small
enough to scan, so prune as you go: when `build` finds a fact that a newer decision
superseded, update or delete it rather than letting contradictory entries pile up. For a
periodic cleanup pass (merging duplicates, fixing stale facts, trimming the index), run a
memory-consolidation skill against the memory directory if one is installed, or do it by hand.

## Relationship to other stores

- **`CLAUDE.md`**: terse, always-on _instructions and conventions_. A `convention` fact that
  proves universal, for the whole repository, can graduate into `CLAUDE.md`. A fact that holds
  for one surface graduates into its blueprint instead, as above. Memory holds the reasoning and the long
  tail, and `CLAUDE.md` holds the rules.
- **Personal memory** (`~/.claude/.../memory/`): per developer, not committed. Shared project
  memory is the team-visible counterpart. Prefer it for anything a teammate would want.
- **A shared folder.** A user who cannot commit to the repository can still share memory: the
  team keeps it in a separate repository, each person clones it, and each private config points
  `memoryDir` at the clone. Pull it before a mode reads it, and commit a new fact to it.
