# Review risk

This file states when a person must read a pull request before it merges, and when a team
must only know about it. The `Route` phase of `/maestro:maestro review` reads it first, then
reads the `reviewRisk` file of each surface that the blueprint map names for a changed file.
A surface file adds the risky areas of one surface, and it never repeats a rule of this file.

`Route` is the first phase of the review. It runs before any finding exists, so the decision
can reach the pull request early. The review can then amend it, with rule 15.

The decision gates nothing. The author still decides when the pull request merges.

## Three outcomes for each changed file

Each file of a surface that has a `reviewTeam` in the map gets one of three outcomes:

- **`review`**: the change is dangerous, or it changes the architecture. A person of the
  team must read it. The summary marks the team "Request a review", and the author requests
  it: the review requests no team itself. A rule of the next section, or a
  risky area of a surface file, says so.
- **`aware`**: the change is well-scoped. It changes behavior that the team owns, and no
  rule of the next section fires, with one exception: on a user-facing change behind a
  feature flag that is off by default, rules 10, 11 and 13 can fire and the change stays
  `aware`. The team must know about the change, and no review is necessary. The team is
  mentioned in the summary, and nothing is requested.
- **No reason**: the change is one of the last section, so the team gets nothing.

When a team gets both levels, the `review` level wins. When the author is a member of a
team, the team is mentioned, and it is not requested.

Two examples of a well-scoped change, at the `aware` level:

- A new module that follows an existing precedent and touches no risky area of its surface.
- A user-facing change behind a feature flag that is off by default, with no test. A
  security rule (1 to 9), rule 12, rule 14 or rule 16 still raises it to `review`.

When a surface file says that a change "does not need a person", the change is at the
`aware` level. When the last section of this file also covers the change, it gets no reason.

## A change needs a person when it does one of these

Security:

1. It adds, moves or reads a secret, a credential, a token or a private key.
2. It changes how a caller signs in, or what a role, an ability or a token can do.
3. It changes how a query is scoped to a tenant, or it reads across tenants.
4. It deletes data, or it changes what a retention or a cleanup job deletes.
5. It reads, stores or sends personal data in a new place.
6. It adds an external endpoint, a webhook, a third-party script or a new outbound host.
7. It changes the permissions of a CI job, a cloud account or an access token.
8. It puts input from a user or an agent into a shell command, a SQL string or a file path.
9. It changes an area that the team's change policy marks as sensitive, such as billing, a
   database migration, authentication and permissions, or the infrastructure.

Code quality:

10. The pull request shape check gives `split`. [`pr-shape.md`](pr-shape.md) holds the
    numbers.
11. It changes behavior, and no test in the diff proves the new behavior.
12. It changes a shared package that more than one surface imports.
13. It adds a pattern, a package or a dependency that the codebase does not have yet.
14. It removes or weakens a test, a check, a lint rule or a type.
15. A confirmed finding of this review still needs a fix. `Route` cannot read this rule,
    because it runs before the review. It applies after the review: it raises the team of
    the file to `review`, and marks the row "added by the review".

Architecture:

16. It changes the architecture: a module boundary, a layer, a port, a data model shared
    by several modules, or a contract between two services or between a service and the
    frontend.

## A change needs no team when it does only these

- It changes documents, comments or copy, outside the documents that the team keeps as
  policy.
- It adds or changes tests, and no production code.
- It renames or moves code inside one module, with no change of behavior.
- It is a story, a prototype or a demo that ships to no user.

A change that does one of these and also another change gets the outcome of that other
change.

## A surface's own rules

A surface adds rules in the file that its `reviewRisk` field in the map names. That file
lists the **risky areas** of the surface: the paths or the kinds of change that always need a
person there, and the changes that never do. Write each area with a name, so that a reason
can cite it as `<surface> area: <name>`. Number any extra rule, so that a reason can cite it
as `<surface> rule <n>`.

A surface file adds to this file and never repeats it.

A surface with no `reviewRisk` file gets the rules of this file alone. A surface with no
`reviewTeam` leaves the team to a narrower surface that matches the same file.

## How the decision is written

- Name each file that gives a team a reason, and the number of the rule or the surface
  area that fired. A file that no rule names is not a reason.
- Give each reason its level, `review` or `aware`. A reason at the `aware` level names the
  rule "well-scoped change".
- Give one sentence of evidence for each reason, read from the diff.
- When no file gives a reason, say so in one sentence. Do not invent a reason to be safe.
