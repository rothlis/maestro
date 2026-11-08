# Maestro

Maestro is a Claude Code plugin that runs a project from the decision to build it to the merged code. The brief, wherever you write it, says why. The work lives as a tree of issues, in GitHub or in your tracker, and Maestro reviews each pull request against your team's own standards.

It works with any method. Teams that use [Shape Up](https://basecamp.com/shapeup) can turn on a preset that adds its words and the hill chart.

## What it does

A project becomes a tree, by default of labelled GitHub issues:

```
Project issue        maestro:project    links to the brief, and a progress section
├── Research issue   maestro:research   what was unknown before the work
├── Spec issue       maestro:spec       the requirements, one section each
│   └── Task issue   maestro:task       the unit one pull request closes
└── Spec issue
```

A spec can belong to a milestone, which is a stage of the project, such as a phase or a release, and its tasks carry the spec's milestone.

By default these are GitHub issues and milestones. A team that keeps its work in Linear, Jira or another tracker sets `"store": "tracker"` and describes in one paragraph how each artifact maps onto it. Maestro then uses that tracker's MCP server. A team that wants neither sets `"store": "files"`: each artifact is then a markdown file, linked to its parent, in `.maestro/work/` or in your private folder. Pull requests and the review stay on GitHub in every case.

| Command                     | What it does                                                              | How it works                                          |
| --------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| `/maestro:maestro setup`    | Asks who uses it here, then your settings, and writes them                | [setup/SKILL.md](skills/maestro/setup/SKILL.md)       |
| `/maestro:maestro init`     | Opens the project issue and any milestones                                | [init/SKILL.md](skills/maestro/init/SKILL.md)         |
| `/maestro:maestro research` | Reads memory, the code, prior art, your docs and chat, then grills you    | [research/SKILL.md](skills/maestro/research/SKILL.md) |
| `/maestro:maestro spec`     | Writes the requirements, then proposes the task issues                    | [spec/SKILL.md](skills/maestro/spec/SKILL.md)         |
| `/maestro:maestro build`    | Takes one task, plans, writes the code, opens a draft pull request        | [build/SKILL.md](skills/maestro/build/SKILL.md)       |
| `/maestro:maestro sync`     | Writes progress per spec and per milestone into the project issue         | [sync/SKILL.md](skills/maestro/sync/SKILL.md)         |
| `/maestro:maestro review`   | Reviews a pull request in several passes, posts the review, then reflects | [review/SKILL.md](skills/maestro/review/SKILL.md)     |
| `/maestro:maestro announce` | Posts a pull request to your Slack or Microsoft Teams channel             | [announce/SKILL.md](skills/maestro/announce/SKILL.md) |

The entry point is [skills/maestro/SKILL.md](skills/maestro/SKILL.md). It holds the config, the tree, the stores and the methods that every command shares.

Progress is shown as counts (tasks closed of total, pull requests in flight, open questions), never as a percentage. The task total grows as the team finds work, so a percentage would go down on good news.

Durable lessons go to project memory. With a team setup, it sits in `.maestro/memory/`, and each session loads its index, so nobody works out the same fact twice.

## How it learns

Maestro builds two kinds of knowledge about your repository as it works:

- **Memory** is what the team learned: decisions, solved problems, traps. Each fact is a small file, and Maestro reads the index before it starts work.
- **Blueprints** are what the team enforces. The review checks code against them.

A lesson moves from the first to the second when it keeps coming back. Each fact counts how many times it came back, in a `seen` field. A fact comes back when you correct Claude on the same thing again, when a review finds the defect the fact describes, or when a build hits the same trap. At 3, Maestro drafts a blueprint rule from the fact and asks you. In a team setup, the change goes to the owner of that part of the repository as a pull request. Once it is accepted, the fact is removed, so each rule lives in one place.

Three moments feed this:

- **During a mode.** When you correct Claude on a standard, it offers to remember it.
- **After `build`.** It records a lesson when the task produced one.
- **After `review`.** The review reflects once its loop stops. It sorts what it found into lessons that repeat a fact, rules that are missing, rules that are wrong, and slips that teach nothing. It asks you before it writes anything.

## The review

`review` runs a [workflow](https://code.claude.com/docs/en/workflows.md) on your own Claude session, in five phases:

1. Route: decides if a person must read the change, and which team must know about it.
2. Scope: sorts the changed files by the parts of your repo they touch.
3. Review: two reasoning passes, one checklist pass per part, a pull request size check, and a spec check when a task issue is linked.
4. Verify: a separate pass tries to refute the most severe findings, and drops the ones it refutes.
5. Synthesize: one report, grouped by severity, posted as a pull request review.

Then it fixes the findings, replies to each one and re-checks, until the review approves. Last, it reflects on what the review taught, as [How it learns](#how-it-learns) says.

The review checks your code against blueprints, short markdown files that say what good looks like in one part of your repo. A map ties paths to blueprints and owners. Without blueprints, the review still runs on its general method, and it tells you that it found none.

## Getting started

### 1. Install the plugin

Run these two commands in Claude Code:

```
/plugin marketplace add rothlis/maestro
/plugin install maestro@vascohq
```

The plugin installs for your user by default, so it works in every repository on your machine. It writes nothing to a repository until you run setup.

You need `gh` 2.100 or later, signed in to your repository, and Node 20 or later.

### 2. Run setup in each repository

Open the repository and run `/maestro:maestro setup`. Setup asks one question at a time. The first question is who uses Maestro in this repository:

| Answer         | The config                              | Memory and blueprints                         | What the repository gets            |
| -------------- | --------------------------------------- | --------------------------------------------- | ----------------------------------- |
| The whole team | `.maestro/config.json`                  | `.maestro/memory/` and `.maestro/blueprints/` | These files, for the team to commit |
| Only me        | `~/.maestro/<owner>/<repo>/config.json` | The same folder in your home                  | Nothing                             |

If the team can commit to the repository, choose **The whole team**. Everybody then shares the memory, and the review uses the same standards for everybody.

If you cannot commit to the repository, or you do not want Maestro to be visible in it, choose **Only me**. Maestro then writes only to your home folder. `<owner>/<repo>` comes from the `origin` remote, so all clones and worktrees of one repository use the same folder. When both configs exist, the team config wins.

Then setup asks for these values:

- the method: `default`, or `shape-up`
- the store: `github`, or `tracker`
- the base branch and the branch pattern
- the memory folder and the blueprint map
- your chat (Slack or Microsoft Teams), its channel, and your board

Every value has a default, so you can accept each one. To change a value later, run setup again. Setup can also copy example blueprints from [`templates/`](templates/) to start from.

### 3. Share memory without the repository (optional)

With **Only me**, the memory and the blueprints are yours alone. To share them with a team that cannot commit to the code repository, use a separate repository:

1. Create a small repository for the team, for example `acme/maestro-team`.
2. Clone it on each machine, for example to `~/maestro-team`.
3. In setup, set the memory folder to `~/maestro-team/memory`.
4. Set the blueprint map to `~/maestro-team/blueprints/map.json`.
5. Pull the clone to get new facts. Commit and push each fact that you add.

One shared repository can serve many code repositories.

### What you give up with Only me

- Memory loads only when a Maestro mode runs. A team setup loads it in every session, through a line in `CLAUDE.md`.
- Without a shared folder, your teammates do not get your memory, and the review uses your copy of the standards.
- The `github` store still creates labels and issues in the repository, so other people see them. If you cannot create labels, choose the `tracker` store, or ask a maintainer to create them.

With `"method": "shape-up"`, the project is called a pitch, the brief is the shaped pitch, each milestone is a scope, and sync draws one hill per scope.

## Not included

Maestro runs on your own Claude session and your own `gh` login. It ships no GitHub App and no CI job.
