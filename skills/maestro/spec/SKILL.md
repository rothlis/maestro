---
name: spec
description: Write the spec issue under a pitch — the requirements for a scope of work, as sections of one GitHub issue — then propose the task issues a pull request will close, and create them after the author approves.
argument-hint: "[optional scope name, or the number of a spec issue to iterate on]"
---

# Spec issue

A spec says **what** the product does when the work is done. It never says how the code
works. The spec is one GitHub issue under the pitch issue, and its requirements are its
sections.

The spec then creates the first task issues. **The moment the author approves those tasks is
the spec review huddle.** After it, a task is cheap: anybody adds one when the work appears.

Use ultrathink for maximum reasoning depth.

**Nothing forces the size of a spec.** The author decides it. A scope that carries unknowns
earns a spec of its own.

## Namespace system

Every requirement carries a namespaced identifier, so that two specs in one pitch never
collide.

**The base namespace comes from the pitch name.** Split the kebab-case name on hyphens, take
the first letter of each word, and put it in upper case.

| Pitch                     | Namespace | Example      |
| ------------------------- | --------- | ------------ |
| `bulk-invoice-export`     | `BIE`     | `BIE-REQ-1`  |
| `fix-login-redirect-loop` | `FLRL`    | `FLRL-REQ-3` |
| `search-result-ranking`   | `SRR`     | `SRR-REQ-2`  |

Confirm the namespace with the user, and write it in the `**Namespace**` field of the issue
body.

### The scope segment

A pitch that spans several scopes can add a scope segment, so that identifiers never collide
across specs: `<PITCH>-<SCOPE>-REQ-N`. Derive the segment the same way, or take a short tag
of one to three letters from the user.

| Pitch          | Scope             | Namespace | Example       |
| -------------- | ----------------- | --------- | ------------- |
| `team-billing` | `seat-limits`     | `TB-SL`   | `TB-SL-REQ-1` |
| `team-billing` | `invoice-history` | `TB-IH`   | `TB-IH-REQ-1` |

The segment is optional and never forced:

- **A pitch with one spec stays flat** (`TB-REQ-N`).
- **A second spec in the same pitch is the signal.** Suggest a segment for the new spec. The
  user can decline. Do not relabel the first spec unless the user asks for it.

**Collision rule.** If two scopes derive the same segment, such as `publish-list` and
`plan-limits` which both give `PL`, extend one with its next significant letter (`PUL` and
`PLL`), or ask the user for a short tag. The same rule applies to the base namespace.

## Workflow

### 1. Find the pitch issue

```bash
gh issue list --label maestro:pitch --state all --search "<pitch name>" --json number,title
```

If no pitch issue exists, offer to run `/maestro:maestro init` first. A spec issue is a
sub-issue of the pitch issue, so the pitch issue must exist before this mode writes anything.

If the argument is an issue number labelled `maestro:spec`, read that issue. This is
iteration mode. Go to step 7.

### 2. Count the specs the pitch already holds

```bash
gh api repos/{owner}/{repo}/issues/<pitch>/sub_issues --jq '.[] | select(.labels[].name == "maestro:spec") | .number'
```

The count decides two things:

- **No spec yet.** This spec covers every scope of the pitch. It needs no `**Scopes**` field,
  and it stays flat in the namespace.
- **One or more specs already.** This spec **must** carry a `**Scopes**` field that names the
  scopes it covers, and its tasks **must** be grouped under the scope each one serves.
  `/maestro:maestro sync` reads that field and that grouping, and it reports an error and
  writes nothing when either is absent. It never guesses, because a wrong attribution is a
  wrong number that nobody can see is wrong.

The scopes come from shaping, and the pitch issue names them under `## Scopes`. Use those
names exactly, because `/maestro:maestro sync` matches them as written. If the list is empty,
the pitch has one scope, named for the pitch.

**The consequence to know: spec granularity sets progress granularity.** One spec covering
four scopes gives those four scopes the same number on the hill chart. A pitch that wants
four separate hills writes four specs.

### 3. Read the research and the memory

1. **The research issues of the pitch.** Read every sub-issue labelled `maestro:research`.
   Their findings and their open questions are what the requirements are derived from. Link
   them in the `**Research**` field.
2. **Shared project memory.** Scan `<memoryDir>/MEMORY.md` and read every fact whose hook
   looks relevant. Prior decisions say what is already settled, and stop the spec
   re-litigating them. See [../memory.md](../memory.md).

### 4. Explore the codebase

Use codebase exploration sub-agents, in parallel for independent areas. The goal is an
**informed** requirement: what is possible, what already exists, and the rough size.

**The goal is not to pre-plan the implementation.** Carry no file path, function name, class
structure or code pattern into the spec. That detail belongs to the build.

#### Abstraction level

A requirement describes what the product does. Some technical context helps when it explains
an architectural choice or says where the data comes from. Naming a module, a service or a
system is fine.

**Directional context, which belongs here:**

- "Completion state is derived from the existing checkpoint fields and the account data."
- "Dismissal is scoped to the organization, in `localStorage`."
- "The feature is behind the `new-onboarding` flag."

**Exact implementation, which does not:** CSS classes, type signatures, prop shapes, file
paths, framework patterns, function names, environment variables, DI tokens, schema field
names.

#### A criterion never weakens a blueprint rule

`/maestro:maestro build` measures a task against its acceptance criteria. So a criterion that
restates a blueprint rule in weaker words lowers the standard for that task, and the build
obeys the weaker words. When a criterion touches a rule, name the rule and keep all of it,
or leave the rule out and let the blueprint hold it.

A criterion once said "A read or a write that throws is caught". A
`catch { return undefined }` met it, and the blueprint said that this is never the answer.
"A storage fault is reported, as the blueprint's error-handling rule requires" keeps the
rule.

### 5. Size each requirement

A requirement becomes one or more task issues, and a task issue becomes part of one pull
request. Size the requirements now, while they are still cheap to move. A pull request that
is too large is corrected by a rebase and a second branch, after the reviewer has already
read it.

For each requirement, make sure that:

- It delivers **one concern**. A refactor and a behavior change are two requirements.
- It is a **vertical slice**. Slice down through the layers, not across them. A requirement
  that delivers all of the backend and then all of the frontend gives one pull request that
  touches everything.
- One pull request can carry it, against the numbers in
  [the pr-shape reference](../references/pr-shape.md). Restate none of them here.

If a requirement fails one of these, split it into two and order them. Some requirements
cannot be split, and a migration with its only consumer is the usual case. Keep that one
whole, and record the intended pull request order inside its `<details>` block.

State the count in **The solution**: how many pull requests the list holds, and how many of
them are small.

### 6. Write the spec issue

```bash
gh issue create --title "Spec: <Scope Title>" --label maestro:spec --parent <pitch> --body-file <path>
```

Write the body with `--body-file`. A here-string loses the line returns. `--parent` attaches
the issue to the pitch in the same call. The full route, and the fallback for a direct REST
call, are in [../SKILL.md](../SKILL.md).

#### The body

The body reads top down, from what a person gets to how the team knows it is done. Use no
horizontal rule (`---`) anywhere. The headings do that work.

```markdown
**Date**: <YYYY-MM-DD>
**Cycle**: <Cycle N>
**Team**: <team>
**Pitch**: `<pitch-name>` — #<pitch issue number>
**Namespace**: <NS>
**Scopes**: <the scopes this spec covers> <!-- only when the pitch holds more than one spec -->
**Research**: #<research issue number>

> One line. What a person can do when this is done.

## The problem

Who has the problem, and what it costs them today. Then the two or three facts about the
code that decide the order of everything below, as a short list with a bold lead. Name the
branch and the commit the research read, and the date.

## The solution

What the product does after this ships, in the words of the person who uses it. Then what
the platform owes, as a numbered list, with each item naming the requirements that deliver
it.

Close with the appetite: how many pull requests the requirements hold, and how many of them
are small.

### How one <run> works

Optional. One walk through the whole flow, with each step naming the requirement that makes
it possible. Keep it to one scenario. Say underneath which orderings are load-bearing, and
why.

## Requirements

| Id         | Requirement              | Priority |
| ---------- | ------------------------ | -------- |
| <NS>-REQ-1 | <the title, in one line> | `must`   |
| <NS>-REQ-2 | <the title, in one line> | `should` |

One or two lines after the table say where the cut line sits, and how many requirements are
done.

### <NS>-REQ-1: <Requirement Title>

`must` · #<task issue> · Depends on <NS>-REQ-2

Two to four lines. What is true when this is done, why it is not true today, and the one
sentence a reader must not miss, in bold.

<details>
<summary>Acceptance criteria and technical notes</summary>

- [ ] Criterion 1. Observable behavior. Naming a module or a service is fine.
- [ ] Criterion 2. A criterion that asserts something no longer happens names the test that
      proves it.

The technical notes follow the criteria in the same block: the constraints, the traps, the
decisions, the rejected alternatives, and the intended pull request order when the
requirement cannot be split.

</details>

## Decisions taken

These are settled, and the requirements above assume them. The research issues hold the
reasoning.

- ...

## Open questions

> **Do not start execution on an affected requirement until its blocking question is
> resolved.**

- [ ] **<The question>.** Who answers it, and which requirements it affects.
- [x] **<A resolved question>.** The answer, and the requirement that holds the detail.

## Out of scope

- ...

## Tasks

The task issues, in the order they land, each with what it waits on.

1. #<task> — <what it delivers>.
2. #<task> — <what it delivers>, after #<task>.
```

Omit the `**Cycle**` and `**Team**` lines when the context gives neither.

**When the spec covers several scopes, the Tasks section groups the tasks under the scope
each one serves.** Without that grouping the `**Scopes**` field says which scopes exist but
not which task belongs to which, and progress stays uncomputable.

#### The collapsed block is the rule, not an option

A person who opens the issue wants the shape of the bet. A person who builds one requirement
wants its criteria. The first reader must not pay for the second. So every requirement puts
its acceptance criteria and its technical notes inside the `<details>` block, and keeps
outside only the prose a reader needs to understand the requirement. Keep the visible part to
four lines or fewer.

#### The requirement line

| Part       | When it appears               | Example                 |
| ---------- | ----------------------------- | ----------------------- |
| Priority   | Always, first                 | `` `must` ``            |
| Status     | Only when it is not `pending` | `` `in_progress` ``     |
| Task issue | Only when one exists          | `#123`                  |
| Dependency | Only for a hard dependency    | `Depends on <NS>-REQ-1` |

Divide the parts with `·`. A requirement that is pending, uncut and independent carries its
priority alone.

#### Requirement statuses

| Status        | Meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `pending`     | Not started. Free to edit, reprioritize or rewrite. It is not written on the line.            |
| `in_progress` | An agent or a person is building it.                                                          |
| `done`        | Complete. The criteria are checked, and the notes name the pull request.                      |
| `cut`         | Removed from scope before the work started. Keep it, with the reason.                         |
| `obsolete`    | Was `done`, and a later pivot made it irrelevant. Keep it, and say what changed.              |
| `moved`       | Transferred to another pitch. Keep it, and link the destination pitch and the new identifier. |

**Never delete a requirement that has been worked on.** The spec is a historical record. When
priorities shift, change the status.

#### What the body must not hold

- A `---` divider. The headings do that work.
- A `## Context` section. **The problem** and **The solution** replace it.
- A "Key Files Reference", a "Testing Strategy" or a `## Bugs` section.
- **A requirement that no code delivers.** A design file, a QA pass, a rollout, a flag
  toggle or a stakeholder update is not a requirement. It can appear inside a `<details>`
  block as context.

**A bug is a requirement too.** There is no `<NS>-BUG-N` space. A defect is a requirement
whose goal is to make broken behavior work again, and it takes the same shape. Keep it in the
`<NS>-REQ-N` sequence, so that one list gives one total and one honest percentage.

### 7. Propose the task issues

A task issue is the unit a pull request closes. Propose the first ones now, and create none
of them before the author approves.

Show the user the proposed list: a title, the requirements each task carries, what it waits
on, and one line on what it delivers. Use `AskUserQuestion` for the approval. **This moment
is the spec review huddle.**

For each approved task, create the issue and attach it to the **spec** issue:

```bash
gh issue create --title "Task: <what it delivers>" --label maestro:task --parent <spec> --body-file <path>
```

The task body:

```markdown
**Pitch**: #<pitch> · **Spec**: #<spec> · **Requirements**: <NS>-REQ-1, <NS>-REQ-2

<What this task delivers, in two to five lines. The constraints that decide its shape, in
bold.>

Proof: <how somebody knows it works. Name the command or the run.>
```

Then edit the spec issue: write each task number on its requirement's line, and fill the
**Tasks** section. `--body-file` replaces the whole body, so start from the body you read,
and read it back after the edit, as [../SKILL.md](../SKILL.md) says.

### 8. Resolve the open questions

Walk the user through every open question before you finish. For each one: discuss it,
explore the codebase if that resolves it, then either resolve it or mark it **deferred** with
a reason. Edit the issue as each one is settled.

A deferred question is acceptable. An unaddressed one is not. Do not propose going to build
while a question blocks a requirement.

## Iterating on a spec

A spec is a living issue.

- Add a new requirement at the bottom, with the next `<NS>-REQ-N` number.
- Reprioritize and rewrite a pending requirement freely.
- Mark a completed but irrelevant requirement `obsolete`. Never delete it.
- When the scope itself shifts, rewrite **The problem** or **The solution**. The issue states
  what the bet is now, and the statuses carry the history.

After a build lands:

1. Read the issue again, because it can have changed.
2. Write `` `done` `` on the requirement's line, and name the pull request there.
3. Check the criteria that are satisfied. **A criterion that asserts something no longer
   happens is checked only when it names the test that proves it.** If one criterion holds
   several claims, split it: check the claim that landed, and carry the rest to a new
   `<NS>-REQ-N`.
4. Strike through a criterion that a later decision overtook, mark it **Superseded**, and
   name the decision that replaced it. Never delete it.
5. Update the priority column and the line under the table.
6. If the work revealed a new requirement, add it. If it invalidated a pending one, mark it
   `cut`.

## What spec does not do

- It writes no file. The output is the spec issue and its task issues.
- It creates no task issue before the author approves it.
- It carries no implementation detail. The build decides that.
