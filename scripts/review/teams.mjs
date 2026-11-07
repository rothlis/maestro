/**
 * The teams of a review pass: the table at the top of the summary comment. The route pass
 * of the review names files and rules, and the blueprint map names the team of each file.
 * The pass requests no team itself: the table says which team a person must request.
 *
 * A team is at one of two levels. `review`: the team must review the change. `aware`: the
 * team must only know about it. A team that the author belongs to is mentioned, and never
 * marked for a request. A team that already has a member among the reviewers needs no new
 * request. The table gates nothing: the author decides when the pull request merges.
 *
 * The membership reads use the token of the person who runs the pass. A token that cannot
 * read the members of a team gives Unknown in the table, and never a failed pass.
 *
 * The section stores its routing in a marker, so it can be read back.
 */

import { posterOf } from "./author.mjs"
import { github, warn } from "./github.mjs"
import { teamPlan } from "./map.mjs"

const LEVEL_WORDS = { review: "Review", aware: "Be aware" }

const STATUS_WORDS = {
  "to-request": "Request a review",
  already: "Already requested",
  mentioned: "No review needed",
  "author-member": "Skipped: author in team",
}

/** `org/team` in the map, or a bare team of the organization that owns the repository. */
export function teamRef(team, repo) {
  const [org, slug] = team.includes("/")
    ? team.split("/")
    : [repo.split("/")[0], team]
  return { org, slug, full: `${org}/${slug}` }
}

const mention = (team, repo) => `@${teamRef(team, repo).full}`
const plainTeam = (team) => `\`${team}\``

/** `true`, `false`, or `null` when GitHub did not answer. A pending invitation is no membership. */
async function isMember(team, repo, login, token) {
  if (!token || !login) return null
  const { org, slug } = teamRef(team, repo)
  const response = await github(
    `/orgs/${org}/teams/${slug}/memberships/${login}`,
    { token },
  )
  if (response.ok) return response.data.state === "active"
  if (response.status === 404) return false
  warn(
    `Reading whether ${login} is in ${team} answered ${response.status}: ${response.text}. The table says Unknown.`,
  )
  return null
}

async function pullInfo(repo, pr) {
  const pull = await github(`/repos/${repo}/pulls/${pr}`)
  if (!pull.ok) {
    warn(
      `Reading the pull request answered ${pull.status}: ${pull.text}. The author and the requested teams are unknown.`,
    )
  }
  const author = pull.ok ? pull.data.user.login : null
  const requestedUsers = pull.ok ? pull.data.requested_reviewers : []
  const reviewers = await reviewerLogins(repo, pr)
  return {
    author,
    requestedSlugs: new Set(
      pull.ok ? pull.data.requested_teams.map((team) => team.slug) : [],
    ),
    reviewers: [
      ...new Set(
        [...requestedUsers, ...reviewers]
          .filter((user) => user?.type !== "Bot" && user?.login !== author)
          .map((user) => user.login),
      ),
    ],
  }
}

/**
 * The people who submitted a review. A Maestro pass is not a review by a person. A refusal
 * is a warning, and reads as nobody.
 */
async function reviewerLogins(repo, pr) {
  const users = []
  for (let page = 1; ; page++) {
    const response = await github(
      `/repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${page}`,
    )
    if (!response.ok) {
      warn(
        `Listing the reviews answered ${response.status}: ${response.text}. A team whose member already reviewed can be marked for a new request.`,
      )
      return users
    }
    users.push(
      ...response.data
        .filter((review) => posterOf(review.body) === null)
        .map((review) => review.user),
    )
    if (response.data.length < 100) return users
  }
}

/**
 * GitHub's auto assignment replaces a team request with one of its members, so a team with
 * a member among the reviewers is already requested, and a new request picks one more.
 */
async function hasMemberAmong(team, repo, logins, token) {
  for (const login of logins) {
    if (await isMember(team, repo, login, token)) return true
  }
  return false
}

/**
 * Gives each entry its status. A `review` team that the author is not in and that has no
 * request yet is `to-request`: the table asks a person to request it. An entry that already
 * knows whether the author is a member is not asked again.
 */
async function settle(repo, pr, entries, token) {
  if (!entries.length) return
  const { author, requestedSlugs, reviewers } = await pullInfo(repo, pr)
  for (const entry of entries) {
    if (typeof entry.isAuthorMember !== "boolean") {
      entry.isAuthorMember = await isMember(entry.team, repo, author, token)
    }
    if (entry.isAuthorMember) entry.status = "author-member"
    else if (entry.level === "aware") entry.status = "mentioned"
    else if (requestedSlugs.has(teamRef(entry.team, repo).slug)) {
      entry.status = "already"
    } else if (await hasMemberAmong(entry.team, repo, reviewers, token)) {
      entry.status = "already"
    } else entry.status = "to-request"
  }
}

/** The routing of the route pass: one entry for each team that a reason names. */
export async function routeTeams(repo, pr, decision, map, token) {
  const { teams, unowned } = teamPlan(decision.reasons ?? [], map)
  await settle(repo, pr, teams, token)
  return { teams, unowned }
}

const AMEND_RULE = "rule 15: a confirmed finding still needs a fix"

const isNeedingFix = (finding) =>
  finding.verification === "confirmed" && finding.severity !== "suggestion"

const withNewReasons = (reasons, added) => [
  ...reasons,
  ...added.filter(
    (reason) =>
      !reasons.some(
        (known) => known.file === reason.file && known.rule === reason.rule,
      ),
  ),
]

/**
 * The review amends the routing: each confirmed finding that still needs a fix puts the
 * team of its file at the `review` level (rule 15 of `review-risk.md`). Only a team that
 * this raises is settled again, so a membership the routing already read is not read
 * twice. `routing` is `null` when the route pass decided nothing.
 */
export async function amendTeams(repo, pr, routing, findings, map, token) {
  const reasons = findings.filter(isNeedingFix).map((finding) => ({
    file: finding.file,
    rule: AMEND_RULE,
    level: "review",
    why: finding.summary ?? finding.claim ?? "",
  }))
  if (!reasons.length) return { routing, isChanged: false }

  const plan = teamPlan(reasons, map)
  const amended = {
    isUndecided: routing === null || Boolean(routing.isUndecided),
    teams: (routing?.teams ?? []).map((entry) => ({ ...entry })),
    unowned: withNewReasons(routing?.unowned ?? [], plan.unowned),
  }
  const raised = []
  for (const planned of plan.teams) {
    const existing = amended.teams.find((entry) => entry.team === planned.team)
    if (!existing) {
      const entry = { ...planned, isAmended: true }
      amended.teams.push(entry)
      raised.push(entry)
      continue
    }
    existing.reasons = withNewReasons(existing.reasons, planned.reasons)
    if (existing.level !== "review") {
      existing.level = "review"
      existing.isAmended = true
      raised.push(existing)
    }
  }
  await settle(repo, pr, raised, token)
  amended.teams.sort(
    (a, b) =>
      (a.level === "review" ? 0 : 1) - (b.level === "review" ? 0 : 1) ||
      a.team.localeCompare(b.team),
  )
  return { routing: amended, isChanged: true }
}

const yesNo = (value) => (value === null ? "Unknown" : value ? "Yes" : "No")

function statusCell(entry) {
  const status = STATUS_WORDS[entry.status]
  return entry.isAmended ? `${status} · added by the review` : status
}

const ROUTING_PATTERN = /<!-- maestro-routing data=([A-Za-z0-9+/=]+) -->/

/**
 * The routing as the teams section stores it. `absent` when the section holds no marker,
 * and `corrupt` when the marker does not hold a routing.
 */
export function readRouting(teamsText) {
  const match = teamsText?.match(ROUTING_PATTERN)
  if (!match) return { state: "absent", routing: null }
  let routing
  try {
    routing = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"))
  } catch (error) {
    warn(`The stored routing is not readable JSON (${error.message}).`)
    return { state: "corrupt", routing: null }
  }
  if (Array.isArray(routing?.teams) && Array.isArray(routing?.unowned)) {
    return { state: "found", routing }
  }
  warn("The stored routing has no teams or no unowned list.")
  return { state: "corrupt", routing: null }
}

function routingMarker(routing) {
  return `<!-- maestro-routing data=${Buffer.from(JSON.stringify(routing)).toString("base64")} -->`
}

function filesCell(reasons) {
  return [...new Set(reasons.map((reason) => `\`${reason.file}\``))].join(
    "<br>",
  )
}

/** The route pass writes the rule, so a pipe or a line break in it must not end the cell. */
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\s+/g, " ")

function reasonRows(teamLabel, reasons) {
  return reasons.map(
    (reason) =>
      `| ${teamLabel} | ${LEVEL_WORDS[reason.level]} | ${cell(reason.rule)} | \`${reason.file}\` |`,
  )
}

/**
 * The teams section of the summary. A fixed layout, so a reader finds the same cells on
 * every pull request. The main table names every team as an `@` mention.
 */
export function teamsBlock(routing, repo) {
  if (!routing) return "**Teams:** ⚠️ not decided, the route pass did not run"
  const { teams, unowned } = routing
  if (!teams.length && !unowned.length) {
    return `**Teams:** none\n\n${routingMarker(routing)}`
  }
  const undecided = routing.isUndecided
    ? " · ⚠️ the route pass did not run, these teams come from the review"
    : ""

  const rows = [
    ...teams.map(
      (entry) =>
        `| ${mention(entry.team, repo)} | ${LEVEL_WORDS[entry.level]} | ${yesNo(entry.isAuthorMember)} | ${statusCell(entry)} |`,
    ),
    ...(unowned.length
      ? [
          `| No team: ${filesCell(unowned)} | ${LEVEL_WORDS[unowned.some((r) => r.level === "review") ? "review" : "aware"]} | — | Ask a person |`,
        ]
      : []),
  ]
  const why = [
    ...teams.flatMap((entry) =>
      reasonRows(plainTeam(entry.team), entry.reasons),
    ),
    ...reasonRows("No team", unowned),
  ]
  return [
    `**Teams**${undecided}`,
    [
      "| Team | Needs to | Author in team | Maestro |",
      "| --- | --- | --- | --- |",
      ...rows,
    ].join("\n"),
    [
      "<details>",
      "<summary>Why</summary>",
      "",
      "| Team | Needs to | Rule | File |",
      "| --- | --- | --- | --- |",
      ...why,
      "",
      "</details>",
    ].join("\n"),
    routingMarker(routing),
  ].join("\n\n")
}

/**
 * The teams section of a pass: the route pass of the same run, amended by its open
 * findings. A result with no route decision still amends, and the table says so.
 */
export async function passTeamsText({ repo, pr, result, findings, map, token }) {
  const decision = Array.isArray(result.humanReview?.reasons)
    ? result.humanReview
    : null
  if (!decision) {
    const cause =
      result.humanReview === undefined
        ? "result.json has no humanReview key"
        : "the route pass returned no decision, and the workflow log gives the reason"
    warn(`The run holds no route decision: ${cause}.`)
  }
  const routing = decision
    ? await routeTeams(repo, pr, decision, map, token)
    : null
  const amendment = await amendTeams(repo, pr, routing, findings, map, token)
  return teamsBlock(amendment.isChanged ? amendment.routing : routing, repo)
}
