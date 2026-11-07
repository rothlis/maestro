---
name: build
description: Build one task issue — read it and its spec, plan in native plan mode, write the code, open the draft pull request that closes it, and record what landed on the spec issue. This is the only maestro mode that changes code.
argument-hint: "[task issue number, or a pitch name to pick one from]"
---

# Build

Take one task issue, and turn it into a draft pull request that closes it. This is the
**only** maestro mode that edits code. `research` and `spec` are read-only.

**There is no plan document.** Claude plans well from a requirement already, and a plan
document dies with the pull request that implements it. Native plan mode does that job, and
the task issue is the record that outlives the session.

Build does not restate what another file owns. It **reads** the blueprint for every path it
changes, and it **names** sibling skills rather than repeating them: `/maestro:maestro review`
for the quality pass, `/simplify` for a simplification pass when it is installed, and a
plain-English writing skill for prose when one is installed.

**Build offers the quality passes, and never launches one unasked.** A writing skill is part
of writing, so run it when it is installed. `/maestro:maestro review` and `/simplify` are the
author's call.

## Configuration

Read `.maestro/config.json` once, at the start. Every field has a default, and a missing file
means every default.

| Field                 | Default                             | Used in   |
| --------------------- | ----------------------------------- | --------- |
| `baseBranch`          | `main`                              | steps 7–8 |
| `memoryDir`           | `docs/memory`                       | steps 2, 10 |
| `blueprintMap`        | `.maestro/blueprints/map.json`      | steps 4–6 |
| `prTemplate`          | `.github/pull_request_template.md`  | step 8    |
| `cycle.branchPattern` | none: a plain kebab-case branch     | step 8    |

## Workflow

### 1. Take a task issue

Read the number from the argument. With no argument, walk down the pitch to its open tasks
and ask which one. Walk the tree rather than listing by label: a label query returns every
open task in the repository, across every pitch.

```bash
gh api repos/{owner}/{repo}/issues/<pitch>/sub_issues --jq '.[] | select(.labels[].name == "maestro:spec") | .number'
gh api repos/{owner}/{repo}/issues/<spec>/sub_issues
```

**One build is one task issue.**

### 2. Read the tree above it

A task is the leaf of a tree, and the tree holds why it exists.

1. **The task issue.** What it delivers, its constraints, and the proof it names.
2. **Its spec issue**, from the `**Spec**` field. Read the requirements the task names, and
   their `<details>` blocks. The acceptance criteria are what "done" means.
3. **The research issues** of the pitch, for the architecture and the rejected alternatives.
4. **Shared project memory.** Scan `<memoryDir>/MEMORY.md` and read every fact whose hook
   looks relevant. See [../memory.md](../memory.md).

### 3. Gate on the open questions

Read the spec issue's **Open questions**. If an unresolved question blocks a requirement this
task carries, **stop and work through it with the user before any code**. Resolve it, or mark
it deferred with a reason, and edit the spec issue.

A deferred question is acceptable, because the team then chose to go on with the uncertainty.
An unaddressed one is not.

### 4. Plan in native plan mode

Call `EnterPlanMode`. **Read the blueprint for every path you will touch, before you design
anything.** The blueprint map ties each path to its blueprint: match the path against the
`paths` of each surface, and the narrowest match wins. The blueprint decides where code lives
and how it is wired, and the plan is where those decisions are made. Do not improvise what a
blueprint already states. Then explore the code, design the approach, and present it with
`ExitPlanMode` for approval. Write no file before that approval.

If the repository has no blueprint map, say so once, and follow the patterns of the code
around the change.

**When a blueprint says how to find a home and a precedent for new code, the plan names both
for each piece it adds.** The user can then dispute a design before the code exists, and
`/maestro:maestro review` checks the same two things after.

This step replaces the plan document. What the plan mode produces is a plan for this session,
and the task issue and the pull request are what the team reads later.

### 5. Write the code

Work through the change with `TaskCreate`, `TaskUpdate` and `TaskList` for the in-session
working set. The task issue stays the cross-session record.

- **If you touch a path the plan did not name, read its blueprint first.**
- **Use sub-agents** for exploration that would bloat this context. Fire independent ones in
  one message. Do the edits here, in the main context.
- **Write the tests the task names.** Follow the patterns of the package you are changing.

If a task turns out to be blocked or wrong, say so. Never skip it in silence.

**When an instruction contradicts a requirement, offer the spec edit before you write the
code.** You read the task's requirements in step 2, so you are holding the thing the
instruction disagrees with. Say which requirement it contradicts, and what the new wording
would be. Then write both, in one change. The spec issue is the requirement record for a
task, so the criteria you read in step 2 are the ones to check the instruction against.
**Offer it now, while the person who can approve it is still there**, and not after the pull
request opens. A requirement the code made false is read as true forever.

**Write no requirement the author has not approved.** Offer the wording and wait. A spec
edited without them is the same fault in the other direction.

### 6. Verify

Run the checks for the packages you changed, and report what they said:

- **Typecheck**, scoped to the package when the repository allows it. Never the whole
  repository when one package will do.
- **Tests** — the suites covering the change.
- **Lint** — in the affected package. Read the whole output.
- **The thing you changed.** A tooling change is proven by one real invocation, and a
  user-visible change by the running app. A read proves neither.
- **The Proof section of each blueprint you read in steps 4 and 5.** It names the evidence for
  its surface, and that evidence goes past the three commands above. Read it again now,
  and supply what it names for the code you wrote.

**Check that the evidence the task named exists, file by file.** The task issue names its
proof, and each acceptance criterion names its own. A test that nobody wrote cannot fail,
so the suite is green and the record reads as covered. Tasks get ticked that way, and a later
review finds them one pull request at a time. The check is mechanical, because the task names
the path:

```bash
ls <the test path the task names>
```

**A path that is absent is an unfinished task**, and never a `done` you write in step 9.
Write the test, or say in the pull request and on the task issue that the proof moved,
and where it went.

### 7. Size the branch before the pull request exists

Apply the standard in [the pr-shape reference](../references/pr-shape.md), and restate none
of its numbers. The script counts:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pr-shape/report.mjs <base> --json
```

**`<base>` is the branch the pull request targets, and not always `origin/<baseBranch>`.** A
stacked pull request measured against `origin/<baseBranch>` counts the branch below it as
well. Never diff against a local base branch, which adds the upstream commits it is missing.

The script gives the size and the concern signals. You judge the tangle: could one half merge
on its own, is this a vertical slice or a horizontal one, does any commit mix a refactor with
a behavior change.

**Run this step every time.** `/maestro:maestro review` answers the same question against the
same standard, but it runs only after the pull request opens, and it is optional. So this step
is the only reading that always happens. The cheapest moment to move a second concern out is
before the pull request exists.

**When the branch carries two concerns, offer a second task issue before the pull request
opens.** A mid-build discovery becomes its own task issue, and **it never extends an open pull
request**. Create it with `spec/SKILL.md`'s task shape, as a sub-issue of the same spec.

### 8. Open the draft pull request

**Name the branch and the title from `cycle.branchPattern` when it is set.** With
`cycle-<n>/<slug>`, the branch is `cycle-4/add-export-button` and the title starts with the
same period: `Cycle 4: Add export button`. Take `<n>` from the user, or from the newest branch
that matches the pattern. Never guess it. **Without a pattern, the branch is plain
kebab-case**, `add-export-button`, and the title is the description alone.

```bash
gh pr create --draft --base <base> --title "<title>" --body-file <path>
```

**The body carries `Closes #<task>`**, which is what joins the pull request to the tree. A
pull request closes one or more task issues.

**Then check that GitHub made the link, because it does not make it at once.** This was
measured on two pull requests. Both bodies held the `Closes` line from the `gh pr create`
call, and both reported no link for several minutes. On one, the link appeared on its own
after four and a half minutes, with nothing touched in between.

```bash
gh pr view <pr> --json closingIssuesReferences
```

**An empty list means "not yet", and not "failed".** Wait and read it again before you act.
Give it about five minutes, and only then re-apply the body with `gh pr edit --body-file`.

Two things were measured, and a third was not. GitHub does not create the link
synchronously, and it does create it without help. Whether editing the body makes it arrive
sooner was never isolated, because an edit preceded both appearances. Do not repeat that an
edit repairs it.

Never take the `Closes` line as proof on its own, and never take one empty read as proof of
failure.

**The body follows the file at `prTemplate`, when it exists.** Read it before you write the
body. When it does not exist, write a short Why, a What, and how the change was proven, and
keep the `Closes` line.

**Then offer `/maestro:maestro review` on the pull request, and wait for the answer.** The
review reads the pushed head, so push before you offer it. Say what it costs, so the answer is
informed: [the review skill](../review/SKILL.md) gives the time of one pass, and each
re-check after a fix is a full run again. That is the author's budget and the author's time.

Never launch it because the step exists. A build that reviews itself every run teaches the
author to stop reading the result.

### 9. Record what landed on the spec issue

The spec issue is the living artifact, and this is the step that keeps it true.

Write `` `done` `` on the requirement's line, name the pull request there, and check the
acceptance criteria that are satisfied. **The rules for that edit — the bundled-criterion
split, the superseded-criterion strike-through, and the golden rule that a worked requirement
is never deleted — live in [../spec/SKILL.md](../spec/SKILL.md), under "After a build
lands".** Restate none of them here.

Read the issue again before you edit it. It can have changed since step 2.

### 10. Record a durable learning, when there is one

**Most builds produce none.** Write a fact in `<memoryDir>/` only when it is durable and
cross-cutting, and not already carried by the code, the git history, the spec issue or the
repository's `CLAUDE.md`. Check for an existing fact to update first. The format is in
[../memory.md](../memory.md).

## What build does not do

- It writes no plan document, and no file under `docs/plans/`.
- It does not extend an open pull request with a second concern. That is a new task issue.
- It does not restate the pull request shape numbers, the spec edit rules, or a blueprint.
- It does not launch `/maestro:maestro review` or `/simplify`. It offers each one, and the
  author decides.
- It does not mark the pull request ready or announce it. `/maestro:maestro announce` does
  both, after one question.
- It commits and pushes when the user asks, and follows the git workflow of the repository.
