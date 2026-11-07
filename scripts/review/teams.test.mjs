/**
 * Run with `node --test scripts/review/teams.test.mjs`.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { posterMarker } from "./author.mjs"
import {
  amendTeams,
  passTeamsText,
  readRouting,
  routeTeams,
  teamRef,
  teamsBlock,
} from "./teams.mjs"

const MAP = {
  surfaces: [
    { id: "api", reviewTeam: "acme/api-team", paths: ["services/*/"] },
    { id: "web", reviewTeam: "acme/web-team", paths: ["apps/web/"] },
    {
      id: "jobs",
      reviewTeam: "acme/jobs-team",
      paths: ["services/jobs/"],
    },
  ],
}

const API_FILE = "services/orders/src/config/a.ts"
const WEB_FILE = "apps/web/src/a.tsx"
const JOBS_FILE = "services/jobs/src/new-job.ts"

const reason = (file, level, rule = "api rule 2") => ({
  file,
  level,
  rule,
  why: "W.",
})

const DECISION = {
  isNeeded: true,
  summary: "S.",
  reasons: [
    reason(API_FILE, "review"),
    reason(WEB_FILE, "review", "web area: routing"),
    reason(JOBS_FILE, "aware", "jobs awareness: a new job"),
  ],
}

/** Answers each GitHub call from the first route whose pattern matches its URL. */
function stubFetch(routes) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init })
    const route = [...routes, reviewsRoute()].find(({ match }) =>
      match.test(url),
    )
    if (!route) throw new Error(`No stub for ${url}`)
    const { status, body } =
      typeof route.answer === "function" ? route.answer(url) : route.answer
    const text = JSON.stringify(body)
    return {
      ok: status < 300,
      status,
      json: async () => body,
      text: async () => text,
    }
  }
  return { calls, restore: () => (globalThis.fetch = original) }
}

const pullRoute = (requested = [], requestedUsers = []) => ({
  match: /\/pulls\/1$/,
  answer: {
    status: 200,
    body: {
      user: { login: "alice" },
      requested_teams: requested.map((slug) => ({ slug })),
      requested_reviewers: requestedUsers.map((login) => ({
        login,
        type: "User",
      })),
    },
  },
})

const reviewsRoute = (reviewers = []) => ({
  match: /\/pulls\/1\/reviews\?/,
  answer: {
    status: 200,
    body: reviewers.map(([login, type = "User", body = ""]) => ({
      user: { login, type },
      body,
    })),
  },
})

/** Alice is in the teams listed, and in no other. */
const membershipRoute = (teams) => ({
  match: /\/memberships\/alice$/,
  answer: (url) =>
    teams.some((team) => url.includes(`/teams/${team}/`))
      ? { status: 200, body: { state: "active" } }
      : { status: 404, body: { message: "Not Found" } },
})

/** Answers each membership call from a map of team slug to member logins. */
const membersRoute = (members) => ({
  match: /\/memberships\/[^/]+$/,
  answer: (url) => {
    const [, team, login] = url.match(/\/teams\/([^/]+)\/memberships\/(.+)$/)
    return members[team]?.includes(login)
      ? { status: 200, body: { state: "active" } }
      : { status: 404, body: { message: "Not Found" } }
  },
})

const statusOf = (routing) =>
  Object.fromEntries(routing.teams.map((entry) => [entry.team, entry.status]))

const isRequestCall = (call) =>
  call.url.endsWith("/requested_reviewers") || call.init.method === "POST"

test("a team is an org/team slug, and a bare team belongs to the owner of the repository", () => {
  assert.deepEqual(teamRef("acme/api-team", "o/r"), {
    org: "acme",
    slug: "api-team",
    full: "acme/api-team",
  })
  assert.equal(teamRef("api-team", "o/r").full, "o/api-team")
})

test("a review team the author is in is skipped, the other is marked to request, an aware team is mentioned, and nothing is requested", async () => {
  const stub = stubFetch([pullRoute(), membershipRoute(["api-team"])])
  try {
    const routing = await routeTeams("o/r", 1, DECISION, MAP, "t")
    assert.deepEqual(statusOf(routing), {
      "acme/api-team": "author-member",
      "acme/web-team": "to-request",
      "acme/jobs-team": "mentioned",
    })
    const membership = stub.calls.find((call) =>
      call.url.includes("/orgs/acme/teams/api-team/memberships/alice"),
    )
    assert.equal(membership.init.headers.Authorization, "Bearer t")
    assert.ok(!stub.calls.some(isRequestCall))
  } finally {
    stub.restore()
  }
})

test("an aware team the author is in is mentioned", async () => {
  const stub = stubFetch([pullRoute(), membershipRoute(["jobs-team"])])
  try {
    const routing = await routeTeams(
      "o/r",
      1,
      { ...DECISION, reasons: [reason(JOBS_FILE, "aware")] },
      MAP,
      "t",
    )
    assert.deepEqual(statusOf(routing), { "acme/jobs-team": "author-member" })
    assert.ok(
      teamsBlock(routing, "o/r").includes(
        "| @acme/jobs-team | Be aware | Yes | Skipped: author in team |",
      ),
    )
  } finally {
    stub.restore()
  }
})

const WEB_ONLY = { ...DECISION, reasons: [reason(WEB_FILE, "review")] }

test("a team that GitHub replaced with one of its members needs no new request", async () => {
  const stub = stubFetch([
    pullRoute([], ["bob"]),
    membersRoute({ "web-team": ["bob"] }),
  ])
  try {
    const routing = await routeTeams("o/r", 1, WEB_ONLY, MAP, "t")
    assert.equal(statusOf(routing)["acme/web-team"], "already")
  } finally {
    stub.restore()
  }
})

test("a team whose member already reviewed needs no new request, and a bot review or a Maestro pass does not count", async () => {
  const stub = stubFetch([
    pullRoute(),
    reviewsRoute([
      ["ci-bot[bot]", "Bot"],
      ["dave", "User", `Pass.\n\n${posterMarker("dave")}`],
      ["carol"],
    ]),
    membersRoute({ "web-team": ["carol", "ci-bot[bot]", "dave"] }),
  ])
  try {
    const routing = await routeTeams("o/r", 1, WEB_ONLY, MAP, "t")
    assert.equal(statusOf(routing)["acme/web-team"], "already")
    assert.ok(
      !stub.calls.some((call) => call.url.endsWith("/memberships/ci-bot[bot]")),
    )
    assert.ok(!stub.calls.some((call) => call.url.endsWith("/memberships/dave")))
  } finally {
    stub.restore()
  }
})

test("a reviewer from another team does not cancel the mark", async () => {
  const stub = stubFetch([
    pullRoute([], ["dave"]),
    membersRoute({ "api-team": ["dave"] }),
  ])
  try {
    const routing = await routeTeams("o/r", 1, WEB_ONLY, MAP, "t")
    assert.equal(statusOf(routing)["acme/web-team"], "to-request")
  } finally {
    stub.restore()
  }
})

test("a team that already has the request is not marked again", async () => {
  const stub = stubFetch([
    pullRoute(["api-team", "web-team"]),
    membershipRoute([]),
  ])
  try {
    const routing = await routeTeams("o/r", 1, DECISION, MAP, "t")
    assert.equal(statusOf(routing)["acme/api-team"], "already")
    assert.equal(statusOf(routing)["acme/web-team"], "already")
  } finally {
    stub.restore()
  }
})

test("a token that cannot read a team gives Unknown, and the pass goes on", async () => {
  const stub = stubFetch([
    pullRoute(),
    { match: /\/memberships\//, answer: { status: 403, body: { message: "No" } } },
  ])
  try {
    const routing = await routeTeams("o/r", 1, WEB_ONLY, MAP, "t")
    assert.equal(routing.teams[0].isAuthorMember, null)
    assert.equal(routing.teams[0].status, "to-request")
    assert.ok(teamsBlock(routing, "o/r").includes("| Unknown |"))
  } finally {
    stub.restore()
  }
})

test("the table has one fixed row for each team, review teams first, and one row for unowned files", () => {
  const block = teamsBlock(
    {
      teams: [
        {
          team: "acme/web-team",
          level: "review",
          isAuthorMember: false,
          status: "to-request",
          reasons: [reason(WEB_FILE, "review", "a | b")],
        },
        {
          team: "acme/api-team",
          level: "review",
          isAuthorMember: true,
          status: "author-member",
          reasons: [reason(API_FILE, "review")],
        },
        {
          team: "acme/jobs-team",
          level: "aware",
          isAuthorMember: false,
          status: "mentioned",
          reasons: [reason(JOBS_FILE, "aware")],
        },
      ],
      unowned: [reason("docs/a.md", "review")],
    },
    "o/r",
  )
  assert.equal(
    block.split("\n\n<details>")[0],
    [
      "**Teams**",
      "",
      "| Team | Needs to | Author in team | Maestro |",
      "| --- | --- | --- | --- |",
      "| @acme/web-team | Review | No | Request a review |",
      "| @acme/api-team | Review | Yes | Skipped: author in team |",
      "| @acme/jobs-team | Be aware | No | No review needed |",
      "| No team: `docs/a.md` | Review | — | Ask a person |",
    ].join("\n"),
  )
  assert.ok(block.includes("| `acme/web-team` | Review | a \\| b |"))
  assert.ok(block.includes("| No team | Review | api rule 2 | `docs/a.md` |"))
})

test("no team and no decision each give one fixed line", () => {
  const none = teamsBlock({ teams: [], unowned: [] }, "o/r")
  assert.ok(none.startsWith("**Teams:** none\n\n<!-- maestro-routing"))
  assert.deepEqual(readRouting(none), {
    state: "found",
    routing: { teams: [], unowned: [] },
  })
  assert.equal(
    teamsBlock(null, "o/r"),
    "**Teams:** ⚠️ not decided, the route pass did not run",
  )
  assert.equal(readRouting(teamsBlock(null, "o/r")).state, "absent")
})

const AWARE_JOBS = {
  teams: [
    {
      team: "acme/jobs-team",
      level: "aware",
      isAuthorMember: false,
      status: "mentioned",
      reasons: [reason(JOBS_FILE, "aware", "well-scoped change")],
    },
    {
      team: "acme/web-team",
      level: "review",
      isAuthorMember: false,
      status: "to-request",
      reasons: [reason(WEB_FILE, "review")],
    },
  ],
  unowned: [],
}

const finding = (file, overrides = {}) => ({
  file,
  severity: "should-fix",
  verification: "confirmed",
  summary: "S.",
  ...overrides,
})

test("the table stores its routing, and reads it back", () => {
  assert.deepEqual(
    readRouting(teamsBlock(AWARE_JOBS, "o/r")).routing,
    AWARE_JOBS,
  )
})

test("a marker that holds no routing is corrupt", () => {
  const notJson = "<!-- maestro-routing data=bm90IGpzb24= -->"
  const noTeams = `<!-- maestro-routing data=${Buffer.from("{}").toString("base64")} -->`
  assert.equal(readRouting(notJson).state, "corrupt")
  assert.equal(readRouting(noTeams).state, "corrupt")
})

test("a confirmed finding to fix raises an aware team to review", async () => {
  const stub = stubFetch([pullRoute()])
  try {
    const { routing, isChanged } = await amendTeams(
      "o/r",
      1,
      AWARE_JOBS,
      [finding(JOBS_FILE), finding(WEB_FILE)],
      MAP,
      "t",
    )
    assert.equal(isChanged, true)
    const jobs = routing.teams.find((entry) => entry.team === "acme/jobs-team")
    assert.equal(jobs.level, "review")
    assert.equal(jobs.status, "to-request")
    assert.equal(jobs.isAmended, true)
    assert.ok(
      !stub.calls.some((call) => call.url.includes("/memberships/")),
      "the stored membership is reused",
    )
    assert.ok(!stub.calls.some(isRequestCall))
    const web = routing.teams.find((entry) => entry.team === "acme/web-team")
    assert.equal(web.isAmended, undefined)
    const block = teamsBlock(routing, "o/r")
    assert.ok(
      block.includes(
        "| @acme/jobs-team | Review | No | Request a review · added by the review |",
      ),
    )
    assert.ok(block.includes("| rule 15: a confirmed finding still needs a fix |"))
  } finally {
    stub.restore()
  }
})

test("a new team that a finding names is skipped when the author is in it", async () => {
  const stub = stubFetch([pullRoute(), membershipRoute(["api-team"])])
  try {
    const { routing } = await amendTeams(
      "o/r",
      1,
      AWARE_JOBS,
      [finding(API_FILE)],
      MAP,
      "t",
    )
    const api = routing.teams.find((entry) => entry.team === "acme/api-team")
    assert.equal(api.status, "author-member")
  } finally {
    stub.restore()
  }
})

test("a suggestion, a refuted finding or an unverified one amends nothing", async () => {
  const { isChanged } = await amendTeams(
    "o/r",
    1,
    AWARE_JOBS,
    [
      finding(JOBS_FILE, { severity: "suggestion" }),
      finding(JOBS_FILE, { verification: "refuted" }),
      finding(JOBS_FILE, { verification: "failed" }),
    ],
    MAP,
    "t",
  )
  assert.equal(isChanged, false)
})

test("with no route decision, the teams come from the review, and the table says so", async () => {
  const stub = stubFetch([pullRoute(), membershipRoute([])])
  try {
    const text = await passTeamsText({
      repo: "o/r",
      pr: 1,
      result: {},
      findings: [finding(JOBS_FILE)],
      map: MAP,
      token: "t",
    })
    assert.ok(
      text.startsWith(
        "**Teams** · ⚠️ the route pass did not run, these teams come from the review",
      ),
    )
  } finally {
    stub.restore()
  }
})

test("a pass with a decision and nothing to amend writes the routing as it is", async () => {
  const stub = stubFetch([pullRoute(), membershipRoute([])])
  try {
    const text = await passTeamsText({
      repo: "o/r",
      pr: 1,
      result: { humanReview: WEB_ONLY },
      findings: [],
      map: MAP,
      token: "t",
    })
    assert.ok(text.includes("| @acme/web-team | Review | No | Request a review |"))
  } finally {
    stub.restore()
  }
})

test("a repository with no map writes no team, only the files", async () => {
  const text = await passTeamsText({
    repo: "o/r",
    pr: 1,
    result: { humanReview: WEB_ONLY },
    findings: [],
    map: { surfaces: [] },
    token: "t",
  })
  assert.ok(text.includes("| No team: `apps/web/src/a.tsx` | Review | — | Ask a person |"))
  assert.ok(!text.includes("@acme"))
})
