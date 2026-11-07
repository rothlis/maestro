/**
 * Run with `node --test scripts/review/map.test.mjs`.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { EMPTY_MAP, readMap, teamFor, teamPlan } from "./map.mjs"

const MAP = {
  surfaces: [
    { id: "code", paths: ["*.ts", "*.mjs"] },
    { id: "api", reviewTeam: "acme/api-team", paths: ["services/*/"] },
    {
      id: "payments",
      reviewTeam: "acme/payments-team",
      paths: ["services/payments/"],
    },
    { id: "writing", paths: ["docs/", "SKILL.md"] },
    {
      id: "infra",
      reviewTeam: "acme/platform-team",
      rootOnly: true,
      paths: [".github/", "infra/"],
    },
  ],
  uncovered: ["libs/", "data/"],
  uncoveredReviewTeams: {
    "libs/": "acme/api-team",
    "data/": "acme/data-team",
  },
}

test("the narrower surface wins over the broader one", () => {
  assert.equal(
    teamFor("services/payments/src/a.ts", MAP),
    "acme/payments-team",
  )
  assert.equal(teamFor("services/orders/src/a.ts", MAP), "acme/api-team")
})

test("a root-only surface does not match the same name inside a service", () => {
  assert.equal(teamFor("infra/terraform/main.tf", MAP), "acme/platform-team")
  assert.equal(teamFor("services/orders/src/infra/a.ts", MAP), "acme/api-team")
})

test("an uncovered path gets its team, at the root only", () => {
  assert.equal(teamFor("libs/auth/src/a.ts", MAP), "acme/api-team")
  assert.equal(teamFor("data/x/y.sql", MAP), "acme/data-team")
  assert.equal(teamFor("apps/x/libs/a.ts", MAP), null)
})

test("a file on a surface with no team is unowned", () => {
  const { teams, unowned } = teamPlan(
    [
      { file: "docs/a.md", rule: "r" },
      { file: "services/payments/a.ts", rule: "r" },
    ],
    MAP,
  )
  assert.deepEqual(
    teams.map((entry) => entry.team),
    ["acme/payments-team"],
  )
  assert.deepEqual(
    unowned.map((reason) => reason.file),
    ["docs/a.md"],
  )
})

test("one review reason puts its team at the review level, and review teams come first", () => {
  const { teams } = teamPlan(
    [
      { file: ".github/a.yml", rule: "r", level: "aware" },
      { file: "services/payments/a.ts", rule: "r", level: "aware" },
      { file: "services/payments/b.ts", rule: "r", level: "review" },
    ],
    MAP,
  )
  assert.deepEqual(
    teams.map((entry) => [entry.team, entry.level, entry.reasons.length]),
    [
      ["acme/payments-team", "review", 2],
      ["acme/platform-team", "aware", 1],
    ],
  )
})

test("a reason with no level is a review reason", () => {
  const { teams } = teamPlan([{ file: "services/payments/a.ts", rule: "r" }], MAP)
  assert.equal(teams[0].level, "review")
})

const repository = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "maestro-map-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  return dir
}

test("the map comes from the default path at the root of the repository", (t) => {
  const root = repository(t)
  mkdirSync(join(root, ".maestro/blueprints"), { recursive: true })
  writeFileSync(join(root, ".maestro/blueprints/map.json"), JSON.stringify(MAP))
  assert.equal(teamFor("data/a.sql", readMap(root)), "acme/data-team")
})

test("blueprintMap in the config moves the map", (t) => {
  const root = repository(t)
  mkdirSync(join(root, ".maestro"), { recursive: true })
  mkdirSync(join(root, "standards"), { recursive: true })
  writeFileSync(
    join(root, ".maestro/config.json"),
    JSON.stringify({ blueprintMap: "standards/map.json" }),
  )
  writeFileSync(join(root, "standards/map.json"), JSON.stringify(MAP))
  assert.equal(teamFor("data/a.sql", readMap(root)), "acme/data-team")
})

test("a repository with no map has no teams, and no error", (t) => {
  const root = repository(t)
  const map = readMap(root)
  assert.deepEqual(map, EMPTY_MAP)
  const { teams, unowned } = teamPlan([{ file: "a.ts", rule: "r" }], map)
  assert.deepEqual(teams, [])
  assert.equal(unowned.length, 1)
})
