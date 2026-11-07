/**
 * Run with `node --test scripts/review/local.test.mjs`.
 *
 * A review posts as a person, so these cases hold the things that must not break: Maestro's
 * own output is never read as a person's reply, a pass rewrites only what its own login
 * posted, and the workflow gets the absolute install path of the plugin.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { isAbsolute, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import {
  isFromPerson,
  isLogin,
  isMaestroOutput,
  isOwnOutput,
  posterMarker,
  posterOf,
} from "./author.mjs"
import {
  isStrandedStandIn,
  PLUGIN_ROOT,
  readArgs,
  workflowArgs,
} from "./local.mjs"
import { statusLine } from "./mark.mjs"
import { VERDICT_REVIEW_MARKER } from "./post.mjs"
import { headMarker, openFindingThreads, personComments } from "./state.mjs"
import {
  isSummaryComment,
  statusSummaryBody,
  SUMMARY_MARKER,
  summaryBody,
} from "./summary.mjs"

const HEAD = "0123456789abcdef0123456789abcdef01234567"
const OLD = "fedcba9876543210fedcba9876543210fedcba98"

test("the workflow args carry the absolute install path of the plugin", () => {
  const args = workflowArgs({ prBase: "origin/main", effort: "medium" })
  assert.deepEqual(args, {
    base: "origin/main",
    prBase: "origin/main",
    effort: "medium",
    route: true,
    pluginRoot: PLUGIN_ROOT,
  })
  assert.ok(isAbsolute(args.pluginRoot))
  const here = fileURLToPath(new URL(".", import.meta.url))
  assert.equal(args.pluginRoot, resolve(here, "../.."))
  const workflow = join(args.pluginRoot, "workflows", "maestro-review.js")
  assert.ok(workflow.endsWith(`${sep}workflows${sep}maestro-review.js`))
  assert.ok(
    JSON.parse(JSON.stringify(args)).pluginRoot === args.pluginRoot,
    "the printed JSON keeps the path",
  )
})

test("prepare reads a pull request number and an effort", () => {
  assert.deepEqual(readArgs([]), { pr: null, effort: "medium" })
  assert.deepEqual(readArgs(["42", "--effort", "high"]), {
    pr: "42",
    effort: "high",
  })
})

test("a poster marker makes a person's comment Maestro's, and a bot is never a person", () => {
  assert.equal(isFromPerson({ type: "User" }, "Fine."), true)
  assert.equal(isFromPerson({ __typename: "Bot" }, "Fine."), false)
  assert.equal(
    isFromPerson({ type: "User" }, `Fixed.\n\n${posterMarker("alice")}`),
    false,
  )
  assert.equal(isMaestroOutput(posterMarker("alice")), true)
  assert.equal(posterOf(`x ${posterMarker("bob")}`), "bob")
  assert.equal(isLogin("alice"), true)
  assert.equal(isLogin("a b"), false)
})

test("a reply that a pass wrote in a thread is Maestro's, so the thread does not wait for an answer", () => {
  const status = "**Still open at `0123456789`:** The name still hides the unit."
  const [thread] = openFindingThreads([
    {
      id: "PRRT_1",
      isResolved: false,
      path: "a.ts",
      line: 11,
      comments: {
        nodes: [
          {
            id: "PRRC_1",
            author: { login: "alice", __typename: "User" },
            body: `**Suggestion: The name hides the unit.**\n\n<!-- maestro-finding severity=suggestion verification=confirmed -->\n\n${posterMarker("alice")}`,
            url: "u",
          },
          {
            id: "PRRC_2",
            author: { login: "alice", __typename: "User" },
            body: `${status}\n\n${posterMarker("alice")}`,
            url: "u2",
          },
        ],
      },
    },
  ])
  assert.equal(thread.replies[0].isBot, true)
  assert.equal(thread.isAwaitingAnswer, false)
})

test("a summary and a verdict review are never read as a person's comment", () => {
  const conversation = personComments(
    [
      {
        user: { login: "alice", type: "User" },
        body: `## Maestro review\n\n${SUMMARY_MARKER}\n\n${posterMarker("alice")}`,
      },
      { user: { login: "alice", type: "User" }, body: "B1 is on purpose." },
    ],
    [
      {
        user: { login: "alice", type: "User" },
        body: [
          "## Maestro review",
          VERDICT_REVIEW_MARKER,
          headMarker(HEAD),
          posterMarker("alice"),
        ].join("\n\n"),
      },
    ],
  )
  assert.deepEqual(
    conversation.map((comment) => comment.body),
    ["B1 is on purpose."],
  )
})

test("each login owns only the output it posted", () => {
  const review = {
    user: { login: "alice", type: "User" },
    body: `${VERDICT_REVIEW_MARKER}\n\n${posterMarker("alice")}`,
  }
  assert.equal(isOwnOutput(review, "alice"), true)
  assert.equal(isOwnOutput(review, "bob"), false)
  assert.equal(
    isOwnOutput({ ...review, user: { login: "mallory" } }, "alice"),
    false,
  )
})

test("a summary is found by its poster marker after the summary marker, and a quote of the marker is not", () => {
  const mark = posterMarker("alice")
  const started = statusSummaryBody(statusLine("started", HEAD, "alice"), null, {
    posterMark: mark,
  })
  assert.match(started, /Maestro is reviewing `0123456789`/)
  assert.ok(isSummaryComment(started))
  assert.ok(
    isSummaryComment(
      summaryBody({ heading: "Review", body: "B." }, started, {
        posterMark: posterMarker("bob"),
      }),
    ),
  )
  assert.equal(isSummaryComment(`A person quotes ${SUMMARY_MARKER}.`), false)
  assert.equal(
    isSummaryComment(`${mark} then ${SUMMARY_MARKER} and nothing after`),
    false,
  )
})

test("only the stand-in commit that prepare made is put back, never another commit with the same files", () => {
  const prepared = { headSha: HEAD, standInSha: OLD }
  assert.equal(isStrandedStandIn(prepared, OLD), true)
  assert.equal(
    isStrandedStandIn(prepared, "1111111111111111111111111111111111111111"),
    false,
  )
  assert.equal(
    isStrandedStandIn({ headSha: HEAD, standInSha: null }, HEAD),
    false,
  )
  assert.equal(isStrandedStandIn({ headSha: HEAD }, OLD), false)
})
