# Shape Up preset

Read this file only when `.maestro/config.json` sets `method` to `shape-up`. Each section
changes one mode, and a mode reads only its own section. The kinds, the tree, the store and
the body write rules do not change. **The preset changes words, never the kinds.**

## Words

| Core                                 | Shape Up                                    |
| ------------------------------------ | ------------------------------------------- |
| project                              | pitch (the kind stays `project`)            |
| brief                                | shaped pitch                                |
| milestone                            | scope                                       |
| `<n>` in a branch                    | the cycle or cooldown number                |
| "once the team has decided to build" | after the bet                               |

**Write the Shape Up word in titles, prose and reports.** The project issue title is
`Pitch: <Pitch Name>`. **The body field names do not change:** `**Project**` and `**Brief**`
stay, because every mode reads them by name. The Brief link points at the shaped pitch.

**The branch pattern carries the cycle.** Set `branchPattern` to `cycle-<n>/<slug>` (or
`cooldown-<n>/<slug>` during a cooldown). Read `<n>` from the branch name or from the user,
and never guess it, because the cycle boundaries live in the team's calendar and not in the
repository.

**The bet is the decision to build.** Maestro starts after it. It does not shape, and it does
not bet.

## init

**One milestone per scope.** The scopes come from shaping. Read their names from the shaped
pitch, or ask the user, and create one milestone (store operation) for each, named for
the scope. Write the names only: a scope's description stays in the shape.

**A pitch can have no scopes yet.** Then it gets no milestone, and sync uses one hill named for
the pitch.

## spec

**Scopes and specs are two decompositions of one pitch.** Scopes come from shaping, as
milestones. Specs come from `/maestro:maestro spec`. **A requirement is not a scope.** It lives
inside a spec as a section, with an identifier such as `BIE-REQ-4`.

**A spec belongs to one scope at most, through its milestone.** A spec that would serve two
scopes is two specs. **Spec granularity sets progress granularity:** each scope gets its own
hill only when its specs carry its milestone.

**A scope that carries unknowns earns a spec of its own**, so its hill can sit uphill while
the others go down.

**The milestone segment is the scope segment.** Derive it from the scope name, the same way as
the base namespace:

| Pitch          | Scope             | Namespace | Example       |
| -------------- | ----------------- | --------- | ------------- |
| `team-billing` | `seat-limits`     | `TB-SL`   | `TB-SL-REQ-1` |
| `team-billing` | `invoice-history` | `TB-IH`   | `TB-IH-REQ-1` |

**Collision rule.** If two scopes derive the same segment, such as `publish-list` and
`plan-limits` which both give `PL`, extend one with its next significant letter (`PUL` and
`PLL`), or ask the user for a short tag.

In the spec body, the problem and the solution describe the shape of the bet. **The Solution
closes with the appetite**: how many pull requests the requirements hold, and how many are
small. A requirement moved out goes to another pitch. Add `**Cycle**: <Cycle N>` under
`**Date**` when the context gives it.

**The moment the author approves the tasks is the spec review huddle.**

## sync

Sync computes the core counts per spec first. Then it adds **one hill per scope**, fed by the
tasks of the specs that carry that scope's milestone. The progress section keeps one heading
per scope, and the counts of each spec stay under it.

A spec with no milestone gets its counts and no hill. **Report it**, so the author attaches it
to a scope. **Never guess the scope**, because a wrong attribution is a wrong number that
nobody can see is wrong. A pitch with no milestone at all has one hill, named for the pitch.

### The hill is a judgement, not a calculation

Sync reads the evidence and computes a reading. The author gives the number that lands. That
order is the normal path, and not an exception for a disagreement.

**The task count cannot be the truth, because its denominator grows.** A scope at ten of
fourteen tasks reads 0.86. Size three more requirements into six tasks and the same ten
become ten of twenty, so the hill slides back to 0.75 with nothing regressed and more work
merged. Eighty percent of today's tasks is not eighty percent of the scope, because tomorrow
adds tasks.

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

### The credit per task

Each task earns credit as it advances, and not only when it closes.

| The task                                   | Credit |
| ------------------------------------------ | ------ |
| Closed                                     | 1      |
| The author says it is done                 | 1      |
| Open, with a pull request ready for review | 0.8    |
| Open, with a pull request still in draft   | 0.5    |
| Open, with no pull request                 | 0      |

**A pull request is real progress and the hill says so.** A draft is still the author's. A
pull request marked ready for review waits on other people, which is most of the way to done.
A task carrying more than one pull request takes the credit of the furthest along.

**Compute `0.5 + 0.5 × (credit ÷ tasks total)` for a scope that is executing, and say what it
is.** It is a reading over the tasks that exist today. Offer a number below the crossing only
when no task exists yet and the scope is still being worked out.

**An open question keeps a scope uphill only while it is the thing being worked on.** A
question nobody can answer without investigating holds a scope that has not begun. The same
question, on a scope whose tasks are merging, is carried rather than blocking.

### Ask for the number

**Ask with `AskUserQuestion`, every run, and write the answer.** The hill is the author's
judgement, and the section is shared. Offer the reading as one option, say what it is a
reading of, and offer the alternatives the scope's evidence suggests.

**Show the credit per task, and not only the number**, so the author can correct the task the
reading came from. Say in the section which tasks the author called done:
`— done, called by the author`, marked `[x]`.

**Write in the section that the number was given.** A reader can then tell a position somebody
chose from a ratio a machine produced. A number typed into the section or the board between
two runs is replaced, because the next run asks again. Say the position to sync, and it lands
with the evidence beside it.

### The scope block

Each scope heading carries its hill, and a paragraph closes the block:

```markdown
### Export to CSV — hill 0.7 · due 2026-03-20

[#101](https://github.com/acme/shop/issues/101) Export spec — building
EXP-REQ-1 to EXP-REQ-7 · 1 of 2 tasks closed · 1 ready for review · 0 open questions

- [x] [#104](https://github.com/acme/shop/issues/104) — the writer and its tests
- [~] [#105](https://github.com/acme/shop/issues/105) — the export button ·
  [#112](https://github.com/acme/shop/pull/112) ready for review

Credit 1.8 of 2.

**Hill: going down, 0.7, given by the author.** Every requirement is written and its tasks
exist, and the last unknown is answered. The writer has landed, and the button is out for
review.
```

**The hill paragraph carries the evidence, and never only the number.** Uphill, name the
unknown the scope is working out and how it is being answered. Downhill, name what has landed,
what is out for review, and what is still unsized or waiting on a person. A reader must be
able to disagree with the position from the paragraph alone.

When the board is configured, push the hill with the counts. **Never a number that differs
from the section.**

In the report, give per scope the hill before, the hill after, and the reason it moved.
