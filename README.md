# Maestro

Maestro is a Claude Code plugin for teams that work in [Shape Up](https://basecamp.com/shapeup). It takes over once a pitch is shaped and bet on: the shaping document keeps the argument, and the work lives in GitHub as a tree of issues. It also reviews each pull request against your team's own standards.

## What it does

A pitch becomes a tree of labelled issues:

```
Pitch issue          maestro:pitch      a pointer to the shaped pitch
├── Research issue   maestro:research   what was unknown before the work
├── Spec issue       maestro:spec       the requirements, one section each
│   └── Task issue   maestro:task       the unit one pull request closes
└── Spec issue
```

| Command                      | What it does                                                         |
| ---------------------------- | -------------------------------------------------------------------- |
| `/maestro:maestro init`      | Opens the pitch issue and creates the labels                         |
| `/maestro:maestro research`  | Reads memory, the code, prior art, your docs and chat, then grills you |
| `/maestro:maestro spec`      | Writes the requirements, then proposes the task issues               |
| `/maestro:maestro build`     | Takes one task, plans, writes the code, opens a draft pull request   |
| `/maestro:maestro sync`      | Computes hill progress per scope and writes it to the pitch issue    |
| `/maestro:maestro review`    | Reviews a pull request in several passes and posts the review        |
| `/maestro:maestro announce`  | Posts a pull request to your Slack channel                           |

Durable lessons go to shared project memory (`docs/memory/` by default). Each session loads the index, so nobody works out the same fact twice.

## The review

`review` runs a [workflow](https://code.claude.com/docs/en/workflows.md) on your own Claude session, in five phases:

1. Route: decides if a person must read the change, and which team must know about it.
2. Scope: sorts the changed files by the parts of your repo they touch.
3. Review: two reasoning passes, one checklist pass per part, a pull request size check, and a spec check when a task issue is linked.
4. Verify: a separate pass tries to refute the most severe findings, and drops the ones it refutes.
5. Synthesize: one report, grouped by severity, posted as a pull request review.

Then it fixes the findings, replies to each one and re-checks, until the review approves.

The review checks your code against blueprints, short markdown files that say what good looks like in one part of your repo. A map ties paths to blueprints and owners. Without blueprints, the review still runs on its general method, and it tells you that it found none.

## Install

```
/plugin marketplace add rothlis/maestro
/plugin install maestro@rothlis
```

You need `gh` (2.100 or later, for `--parent`), signed in to your repository, and Node 20 or later.

## Set it up in your repository

Nothing is required. Every setting has a default. To change one, copy what you need from [`templates/`](templates/):

- `.maestro/config.json`: the base branch, the memory directory, the blueprint map, your Slack channel and your board.
- `.maestro/blueprints/map.json` and one `README.md` per blueprint: your standards, for the review.
- `docs/memory/MEMORY.md`: the empty memory index. Add one line to your `CLAUDE.md` that tells Claude to read it.

## Not included

Maestro runs on your own Claude session and your own `gh` login. It ships no GitHub App and no CI job.
