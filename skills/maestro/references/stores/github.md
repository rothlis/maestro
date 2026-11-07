# Store: GitHub Issues

Read this file when `store` in the config is `github`, or when the field is
missing. Each section below is one store operation, as the exact `gh` commands. The modes name
the operation in bold, and this file says how to run it. **Every GitHub-issue trap lives here,
and only here.**

An artifact is a labelled issue. A **reference** is `#<n>`, the issue number with a hash.
`gh` 2.100.0 or later is necessary for `--parent`. The fallback for an older `gh` is under
**create**.

| Kind     | Label              | Title                 |
| -------- | ------------------ | --------------------- |
| project  | `maestro:project`  | `Project: <Name>`     |
| research | `maestro:research` | `Research: <Topic>`   |
| spec     | `maestro:spec`     | `Spec: <Title>`       |
| task     | `maestro:task`     | `Task: <what it delivers>` |

The parent and the child are joined through the sub-issues API, and not by a body reference
alone. GitHub then shows the tree itself, and one query finds every project.

## ready

Make the four labels exist. Only `/maestro:maestro setup` creates a label. A mode that only
checks the store runs the list command below, and creates nothing.

```bash
gh label list --search "maestro:" --json name --jq '.[].name'
```

Create each label that the list does not show, and only those:

```bash
gh label create maestro:project  --color 5319E7 --description "Maestro: the root of a project"
gh label create maestro:research --color 0E8A16 --description "Maestro: a research issue"
gh label create maestro:spec     --color 1D76DB --description "Maestro: a spec issue"
gh label create maestro:task     --color FBCA04 --description "Maestro: a task a pull request closes"
```

Do not add `--force`. It overwrites the color and the description of a label that exists, and
the team can have chosen its own color.

## find projects

```bash
gh issue list --label maestro:project --state all --json number,title,state --limit 200
```

Add `--search "<project name>"` to find one project. **Keep `--state all`.** The default
shows open issues only, and a closed project then looks absent, so a second one gets created.

## create

Create the issue and attach it to its parent in the same call. A project has no parent, so
omit `--parent` for a project.

```bash
gh issue create --title "<title>" --label maestro:<kind> --parent <parent> \
  --milestone "<milestone title>" --body-file <path>
```

- Omit `--milestone` when the artifact has none.
- **Write the body to a file, and pass `--body-file`.** A here-string loses the line returns,
  and the fields then render as one line.
- The command prints the issue URL. The number at its end is the reference.
- Then do **read**, and compare the body with the file, as **replace body** shows.

`gh issue edit` carries `--add-sub-issue`, `--remove-sub-issue`, `--parent` and
`--remove-parent`, for a child that exists already.

**Fallback, for a direct REST call or a `gh` older than 2.100.0.** Create the issue without
`--parent`, then attach it:

```bash
child_id=$(gh api repos/{owner}/{repo}/issues/<child> --jq .id)
gh api -X POST repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id="$child_id"
```

The endpoint takes the child's numeric `id`, and never its issue number. `gh issue view
--json id` gives a node id, which is wrong too. **Send the id with `-F`**, which sends an
integer. `-f` sends a string, and the API answers `422 ... is not of type integer`.

## read

```bash
gh issue view <n> --json number,title,body,state,labels,milestone,url
gh api repos/{owner}/{repo}/issues/<n>/parent --jq .number
```

The kind is the `maestro:` label. The status is `state`: `OPEN` or `CLOSED`. The parent call
returns `404` for an issue that has no parent, such as a project.

## replace body

`gh issue edit --body-file` replaces the whole body. An edit that adds one line rewrites the
whole document. So start from the body you read, change only your part, and write it all.

**An empty body is accepted.** `gh` writes it, exits `0` and prints the issue URL. A script
inside a quoted command substitution that produces nothing empties the body, and nothing says
so. Exit `0` is not proof.

```bash
D=$(mktemp -d)
gh issue view <n> --json body --jq .body > "$D/before.md"
# write $D/after.md: before.md with only your part changed
test -s "$D/after.md" && gh issue edit <n> --body-file "$D/after.md"
gh issue view <n> --json body --jq .body > "$D/readback.md"
diff "$D/after.md" "$D/readback.md"
```

The diff must be empty. If it is not, put `before.md` back with `--body-file` and report it.

The two progress markers, `<!-- maestro:progress:start -->` and
`<!-- maestro:progress:end -->`, survive on GitHub. Keep them.

## children

```bash
gh api repos/{owner}/{repo}/issues/<parent>/sub_issues --paginate \
  --jq '.[] | {number, title, state, kind: ([.labels[].name | select(startswith("maestro:"))][0])}'
```

The endpoint returns closed children as well as open ones. **Walk the tree, and do not list by
label.** A label query such as `gh issue list --label maestro:task` returns every task in the
repository, across every project, and hides closed ones unless you add `--state all`.

## milestones

A milestone is a native GitHub milestone. Milestones are repository-wide, so the title is
`<project-slug>/<milestone-name>`, and the prefix ties it to one project. The name after the
prefix is the name a mode shows.

List the project's milestones. **Keep `state=all`**, or a closed milestone looks absent:

```bash
gh api repos/{owner}/{repo}/milestones --paginate -X GET -f state=all \
  --jq '.[] | select(.title | startswith("<project-slug>/")) | {title, due_on, state}'
```

Create one that is missing. Add `-f due_on=<ISO8601>` when the user gives a date:

```bash
gh api repos/{owner}/{repo}/milestones -f title="<project-slug>/<milestone-name>"
```

Set an artifact's milestone, on an issue that exists:

```bash
gh issue edit <n> --milestone "<project-slug>/<milestone-name>"
```

On a new issue, pass `--milestone` to **create**.

## close

```bash
gh issue close <n> --reason completed
```

A task closes on its own when a pull request that carries its **link PR** line merges. Close
one by hand only when no pull request will.

## link PR

The pull request body carries one line per task:

```
Closes #<task>
```

Merging the pull request into the default branch closes the task.

**GitHub does not make the link at once.** This was measured on two pull requests: both
bodies held the `Closes` line from `gh pr create`, and both showed no link for several
minutes. On one, the link came on its own after four and a half minutes.

```bash
gh pr view <pr> --json closingIssuesReferences --jq '.closingIssuesReferences[].number'
```

An empty list means "not yet", and not "failed". Wait about five minutes and read it again.
Only then apply the body again with `gh pr edit --body-file`. It was never measured whether an
edit makes the link come sooner, so do not say that an edit repairs it.

**From a pull request to its task:** read `closingIssuesReferences`. When it is empty, read
the `Closes #<n>` lines of the body. Then **read** each one, and keep only the issues labelled
`maestro:task`. Its spec is the task's parent.

**From a task to its pull requests:**

```bash
gh issue view <task> --json state,closedByPullRequestsReferences
gh pr view <pr> --json isDraft,state
```
