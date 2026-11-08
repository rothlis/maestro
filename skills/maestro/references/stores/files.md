# Store: files

Read this file when `store` in the config is `files`. The artifacts are then markdown files in
a folder: no issue, no label and no MCP. Pull requests and the review stay on GitHub.

Each section below is one store operation. The modes name the operation in bold, and this
file says how to run it on files.

## Where the files live

The folder is `workDir` in the config, as an absolute path. For a team setup the default is
`.maestro/work/` in the repository, and the team commits it. For a private setup the default
is `work/` in the private folder, and nobody else sees it.

```
<workDir>/
  <project-slug>/
    0-project.md
    1-research-<slug>.md
    2-spec-<slug>.md
    3-task-<slug>.md
```

One folder for each project. Every artifact of the project sits flat in it, numbered in the
order it was created. `<slug>` is the title in kebab-case, five words at most.

A **reference** is `<project-slug>#<n>`, such as `export-csv#3`. The project itself is
`<project-slug>#0`. Use it wherever a mode writes `<ref>`.

## The file

Every artifact starts with this frontmatter, then its body:

```markdown
---
ref: export-csv#3
kind: task
title: "Task: Write the CSV writer"
status: open
parent: export-csv#2
assignee: octocat
milestone: v1
created: 2026-03-02
closed:
---

<the body that the mode writes>
```

- `kind` is `project`, `research`, `spec` or `task`.
- `status` is `open` or `done`. `closed` holds the date when it is `done`.
- `parent` is empty for the project. **The `parent` field is the link of the tree**, as a
  sub-issue is on GitHub: a task names its spec, and a spec or a research names the project.
- `assignee` is the GitHub login of the person who owns the artifact, or empty.
- `milestone` is optional. The project file holds the list of milestones (see **milestones**).

## Links between files

**Write each reference in a body as a relative link to its file:**
`[export-csv#2](2-spec-the-writer.md)`. A reader then clicks from a task to its spec, and from
the progress section of the project to every spec and task, in an editor or on GitHub. The
frontmatter `parent` stays the plain reference, because the modes read it.

## ready

Make sure that `workDir` exists, and create it when it does not. Nothing else needs to be
ready.

## find projects

Read the frontmatter of every `<workDir>/*/0-project.md`. Open and done projects are all
there.

## create

1. **Pick the number.** It is the highest number in the project folder, plus 1. A new project
   gets a new folder, and its project file is number 0. **Never reuse a number**, not even the
   number of a deleted file, because a pull request or a body can still name it.
2. **Write the file** with the frontmatter above and the body. Use the title of the kind:
   `Project: <Name>`, `Research: <Topic>`, `Spec: <Title>`, `Task: <what it delivers>`.
3. **Read it back**, and make sure that the frontmatter parses and the body is not empty.
4. Return its reference.

**For a team setup, pull before you create.** Two people who create in the same project at the
same time take the same number. When a pull brings in a second file with your number, give
your file the next free number, and correct every reference to it.

## read

Read the frontmatter for the title, the status, the parent and the assignee, and the rest of the file for
the body.

## replace body

Replace everything after the closing `---` of the frontmatter, and keep the frontmatter byte
for byte. Then read the file back, and compare the body with what you wrote. Never write an
empty body. The progress markers of `sync` are HTML comments, and a file keeps them.

## children

List the files in the same project folder whose `parent` is the reference. Include the done
ones, because a list that hides them gives a wrong count.

## milestones

The project file holds them in its frontmatter:

```yaml
milestones:
  - name: v1
    due: 2026-03-20
  - name: scheduled-exports
```

- **List** them from that field.
- **Create** one only after the user names it: add an entry, with `due` when the user gives a
  date.
- **Set** an artifact's milestone in its own `milestone` field, with the name.

## assign

Set `assignee: <login>` in the frontmatter. For the user who runs the mode, the login is
`gh api user --jq .login`.

## close

Set `status: done` and `closed: <today>`.

## link PR

**A pull request body carries one line for each task:** `Maestro-Task: <ref>`, such as
`Maestro-Task: export-csv#3`. GitHub does not know the files, so **merging the pull request
closes nothing.**

- **Close a task when its pull request merges.** `sync`, and `build` when it takes a task, look
  for the merged pull request of each open task. When one exists, **close** the task, and say
  so in the report.
- **From a pull request to its task:** read the `Maestro-Task:` lines of its body. The task's
  `parent` is its spec.
- **From a task to its pull requests:** search, then keep only the pull requests whose body
  holds the exact line, because GitHub search splits the reference into words:

```bash
gh pr list --state all --search "\"Maestro-Task\" \"<project-slug>\" in:body" \
  --json number,state,isDraft,mergedAt,body
```

## Commits

**For a team setup, the store commits nothing.** The mode lists the files it wrote, and the
user commits them: with the pull request of the work, or in a small pull request of their own.
Never commit them on the base branch. **For a private setup**, the folder is outside the
repository, and there is nothing to commit. Its backup is the user's.
