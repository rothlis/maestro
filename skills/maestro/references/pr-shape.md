# PR Shape

A pull request carries one concern, and a reviewer reads it in one sitting. This file holds the numbers, the exclusions, and the ways to split work that is too large for one PR.

**This file governs every pull request in a repository that uses maestro**, whoever opens it and whatever tool they used to get there. It is the authority for PR shape, and the numbers below are the only copy in the prose. `${CLAUDE_PLUGIN_ROOT}/scripts/pr-shape/report.mjs` counts them.

## Decide the boundary before the code exists

The cheapest moment to size the work is before anybody writes it. Decide what one pull request carries while you are still deciding what to build. Then measure the branch before you open it, and when it has grown a second concern, move that concern out rather than letting one pull request carry both.

`/maestro:maestro` does this at two fixed points: `spec` sizes each requirement as one concern and one vertical slice, and `build` runs the script before the pull request opens. Working without it changes nothing about the standard, only about who remembers to apply it.

**`/maestro:maestro review` gives the verdict on every diff it reviews**, whoever wrote it. The check is the one process exception its correctness pass carries, and the verdict is reported apart from the correctness findings. So a branch that carries two concerns is named at review time even when nobody sized it earlier.

A PR that is too large is expensive to correct after it is open. The author must rebase, move commits onto a second branch, and open a new PR. A PR that went out at 51 files was split afterward into a two-PR stack, and only the first half merged.

## Measure the branch

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pr-shape/report.mjs <base> --json
```

`<base>` is `origin/<baseBranch>` from the config, by default `origin/main`. Without `--json`, the script prints the same report as text. The JSON report carries these fields:

| Field               | What it holds                                                                   |
| ------------------- | ------------------------------------------------------------------------------- |
| `base`              | The base the branch was measured against                                        |
| `lines`             | `counted`, after the exclusions below, and `raw`                                |
| `files`             | `counted` reviewable files, and how many were `excluded`, `renamed`, `deleted`  |
| `codeAreas`         | The code areas the branch touches                                               |
| `supportAreas`      | The support areas it touches                                                    |
| `domains`           | The product domains it touches                                                  |
| `layers`            | The architectural layers it touches                                             |
| `signals`           | Paths that deserve care, such as a migration or CI configuration                |
| `straddlingCommits` | Commits that touch more than one code area, with their `sha`, `subject`, `areas` |
| `breaches`          | Each measure past its ceiling: `measure`, `value`, `ceiling`                    |
| `concernSignals`    | The reasons the branch may carry more than one concern                          |

## The numbers

| Measure       | Target | Ceiling |
| ------------- | ------ | ------- |
| Changed lines | 200    | 400     |
| Files         | 10     | 20      |
| Code areas    | 1      | 2       |

Above 400 changed lines, reviewers find fewer defects. Reviewer attention falls after about 60 minutes. As a PR grows, a reviewer spends less time per file, not more, and moves from a line-by-line read to a skim.

Count files and areas as well as lines. A change of 200 lines in one file is small. The same 200 lines across 50 files is large.

A code area is one deployable or one package: a directory under `apps/`, `services/`, `libs/` or `packages/`, or a top-level source directory. Docs, CI, tooling and root config are support areas. They are reported, and they never breach a ceiling.

These numbers are a signal to look again. They are not a gate. A PR above the ceiling can still be the right PR.

## What does not count as a changed line

A size rule that fires on a dependency bump gets ignored, and then it catches nothing. Exclude these from every count:

- Lock files, such as `pnpm-lock.yaml`, `package-lock.json` and `yarn.lock`
- Generated files: `**/__generated__/**` and `**/*.generated.*`
- Vendored archives, such as `vendor/*.tgz`

Two more exclusions apply to any path:

- **A deleted file counts as one line, and never toward the file ceiling.** A reviewer confirms the deletion once. The content of a deleted file is not review work, and neither is opening it. A deletion-only change is therefore always within the file ceiling, however many files it removes.
- **A pure rename counts as zero lines.** Detect renames with `git diff --stat -M`.

A file that a build step or a hook regenerates, and that the list above does not name, counts. When one inflates a report, say so next to the number, rather than reading the breach as real.

## One concern per PR

A PR carries one concern. A reviewer holds one story in mind, not two.

These combinations are two PRs:

- A refactor and a behavior change. The reviewer cannot tell which lines changed behavior.
- A migration and the code that reads the new schema. Ship the migration first.
- Backend and frontend, unless one cannot work without the other in the same deploy.
- Two product domains, such as two modules of one app.
- Risky or novel work and routine work. The risky half deserves its own review.

A PR that crosses client code and server code is the strongest signal of two concerns. Confirm it, or split it.

## Five ways to split

Name the one you used in the plan, so a reviewer knows the order.

1. **By layer.** The server half ships first and the client half reads its output.
2. **Migration first, then the consumer.** The schema lands and deploys. The code that uses it follows.
3. **Refactor first, then the behavior change.** The refactor PR changes no behavior, so a reviewer reads it fast.
4. **Walking skeleton, then the detail.** A thin end-to-end path proves the wiring. Each later PR fills in one part.
5. **Risky work on its own.** Isolate the novel part from the routine part, whatever layer each sits in.

Slice a requirement down the layers, not across them. A requirement that delivers all of the backend, and then all of the frontend, produces one PR that touches everything.

## Size is a process signal, never a priority signal

Diff size is not importance. A 4-line migration outranks 900 lines of renamed imports. Both rules are correct, and they answer different questions:

- **Size decides whether to split the PR.** This is a process question, and it is answered before review.
- **Size never decides what a reviewer reads first.** [review-risk.md](review-risk.md) answers that question.
