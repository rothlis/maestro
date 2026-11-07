# Shared Project Memory

Maestro's durable knowledge lives in a **git-committed, team-shared memory store**. Its
directory is `memoryDir` in `.maestro/config.json`, and the default is `docs/memory/`. This
file uses the default path.

## Why this exists

A knowledge doc pays off only if somebody reads it, and the only knowledge that reliably gets
read is the kind that is **auto-loaded into every session's context**. Claude's native memory
(`MEMORY.md`) works because the harness injects its index on every turn. Standalone per-pitch
knowledge docs are almost never written and almost never read.

Shared project memory copies the mechanic that works, but commits it to the repo so the
**whole team** benefits, not just one developer's machine:

- **`docs/memory/MEMORY.md`** is the index, one line per fact. A pointer to it lives in the
  repo's root `CLAUDE.md`, so it loads into every Claude session automatically. This is what
  makes the knowledge get read.
- **`docs/memory/<slug>.md`** files each hold exactly one fact, with frontmatter. The body is
  pulled into context only when a session decides a fact is relevant, from its index line.

The result: cross-pitch decisions, patterns and solved problems surface on their own in
future work.

## The pointer in `CLAUDE.md`

Add these lines to the repository's root `CLAUDE.md`. The `@` import loads the index into
every session. Use the real path when `memoryDir` is not the default.

```markdown
## Shared project memory

Durable project knowledge lives in `docs/memory/`, one fact per file. At the start of
relevant work, read any fact whose index line looks relevant.

@docs/memory/MEMORY.md
```

## Layout

```
docs/memory/
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
  pitch: <cycle-N>/<pitch-name> # provenance: where this was learned
  date: <YYYY-MM-DD>
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
| `convention` | A durable project-wide rule worth following (a candidate for `CLAUDE.md` too). |
| `reference`  | A pointer to an external resource: an RFC or ADR, a dashboard, a ticket, a doc page. |

## Read rules (research, spec)

Before exploring the codebase, **scan `docs/memory/MEMORY.md`** and read any fact whose
description looks relevant to the scope. This is the first place to look for prior decisions
and solved problems. It prevents re-deriving things the team already settled. It is in
addition to the pitch's own research issues, not a replacement.

## Write rules (build)

`build` is the writer. After a requirement lands, if it produced a decision, pattern or
solved problem worth carrying forward, record it here.

Only write a fact when it is **durable and cross-cutting**: something a future, unrelated
session would benefit from knowing. Do not mirror what the code, the git history, the shaping
doc or `CLAUDE.md` already record. Most tasks produce no fact. A pitch that made a real
architectural decision produces one or two.

When writing a fact:

1. **Check for an existing file first.** If a fact already covers the topic, update it rather
   than creating a near-duplicate. Delete facts that turn out to be wrong.
2. Write the `<slug>.md` file with the frontmatter above.
3. Add a one-line pointer to `MEMORY.md`: `- [Title](<slug>.md) — <hook>`. Group it under a
   sensible `##` heading, by domain or theme.
4. Link related facts with `[[slug]]`.

If the memory directory does not exist yet, create it with the first fact and its `MEMORY.md`,
and offer the user the `CLAUDE.md` pointer above.

## Keeping the store healthy

There is no automated consolidation mode. Memory is valuable only because it stays small
enough to scan, so prune as you go: when `build` finds a fact that a newer decision
superseded, update or delete it rather than letting contradictory entries pile up. For a
periodic cleanup pass (merging duplicates, fixing stale facts, trimming the index), run a
memory-consolidation skill against the memory directory if one is installed, or do it by hand.

## Relationship to other stores

- **`CLAUDE.md`**: terse, always-on _instructions and conventions_. A `convention` fact that
  proves universal can graduate into `CLAUDE.md`. Memory holds the reasoning and the long
  tail, and `CLAUDE.md` holds the rules.
- **Personal memory** (`~/.claude/.../memory/`): per developer, not committed. Shared project
  memory is the team-visible counterpart. Prefer it for anything a teammate would want.
