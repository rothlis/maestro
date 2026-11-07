/**
 * Run with `node --test scripts/review/post.test.mjs`.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { posterMarker } from "./author.mjs"
import { statusLine } from "./mark.mjs"
import {
  VERDICT_REVIEW_MARKER,
  commentableLines,
  earlierFindings,
  fileCommentBody,
  fileCommentCandidates,
  findingStatus,
  firstPassReview,
  inlineCommentBody,
  judgeFindings,
  markerVerdict,
  needsThreadReply,
  passSummaryBody,
  placeFindings,
  recheckReview,
  reviewToRewrite,
  splitClaim,
  threadClaim,
  verdictFor,
  verdictReviewBody,
  withoutHarnessNotice,
} from "./post.mjs"
import {
  bodyFindingsMarker,
  lastPass,
  openFindingThreads,
  personComments,
  raisedFindings,
  withFindingStatus,
} from "./state.mjs"
import {
  readPasses,
  readStatus,
  readTeams,
  readVerdict,
  statusSummaryBody,
  SUMMARY_MARKER,
  summaryBody,
  toSummaryHtml,
} from "./summary.mjs"

const PATCH = [
  "@@ -10,4 +10,5 @@ export function a() {",
  " context",
  "-removed",
  "+added one",
  "+added two",
  " context",
  "@@ -40,2 +41,2 @@",
  " far context",
  "\\ No newline at end of file",
].join("\n")
const FILES = [{ filename: "a.ts", patch: PATCH }]
const HEAD = "0123456789abcdef0123456789abcdef01234567"
const LAST = "fedcba9876543210fedcba9876543210fedcba98"
const LOGIN = "alice"
const MARK = posterMarker(LOGIN)

function finding(overrides) {
  return {
    file: "a.ts",
    line: 12,
    severity: "should-fix",
    summary: "The retry drops the body. A reader then sees a wrong count.",
    evidence: "Line 12 reuses the old body.",
    authority: "Code blueprint",
    verification: "confirmed",
    ...overrides,
  }
}

function earlierThread(overrides) {
  return {
    kind: "thread",
    id: "T1",
    url: "u1",
    file: "a.ts",
    line: 12,
    severity: "should-fix",
    verification: "confirmed",
    claim: "Old claim.",
    status: "open",
    reason: "Unchanged.",
    ...overrides,
  }
}

const first = (result, files, options = {}) =>
  firstPassReview(result, files, HEAD, { login: LOGIN, ...options })
const recheck = (result, files, judged, options = {}) =>
  recheckReview(result, files, HEAD, judged, { login: LOGIN, ...options })
const summary = (pass, previous, options = {}) =>
  summaryBody(pass, previous, { posterMark: MARK, ...options })

test("a hunk gives its added and context lines, and never a removed one", () => {
  assert.deepEqual([...commentableLines(PATCH)], [10, 11, 12, 13, 41])
})

test("a finding sits on a line of a hunk, on a file of the diff, or outside the diff", () => {
  const findings = [
    { file: "a.ts", line: 11 },
    { file: "a.ts", line: 30 },
    { file: "a.ts" },
    { file: "b.ts", line: 11 },
  ]
  const { inline, fileLevel, unplaced } = placeFindings(findings, FILES)
  assert.deepEqual(inline, [{ file: "a.ts", line: 11 }])
  assert.deepEqual(fileLevel, [{ file: "a.ts", line: 30 }, { file: "a.ts" }])
  assert.deepEqual(unplaced, [{ file: "b.ts", line: 11 }])
})

test("the first sentence is the claim, and the rest explains it", () => {
  assert.deepEqual(splitClaim("One claim. Then why."), {
    claim: "One claim.",
    rest: "Then why.",
  })
  assert.deepEqual(splitClaim("Only a claim"), {
    claim: "Only a claim",
    rest: "",
  })
})

test("a summary line renders code spans as HTML and escapes the rest", () => {
  assert.equal(
    toSummaryHtml("Use `a<b>` **now**"),
    "Use <code>a&lt;b&gt;</code> <strong>now</strong>",
  )
})

test("an inline comment leads with the claim, hides the evidence and marks the finding", () => {
  assert.equal(
    inlineCommentBody(finding()),
    [
      "**Should fix: The retry drops the body.**",
      "A reader then sees a wrong count.",
      "<details>\n<summary>Evidence</summary>\n\nLine 12 reuses the old body.\n\nAuthority: Code blueprint\n\n</details>",
      "<!-- maestro-finding severity=should-fix verification=confirmed -->",
    ].join("\n\n"),
  )
  assert.ok(
    inlineCommentBody(finding({ verification: "not-attempted" })).startsWith(
      "**Should fix, unverified:",
    ),
  )
  assert.ok(inlineCommentBody(finding(), MARK).endsWith(MARK))
})

test("only suggestions approve, a confirmed blocker blocks, a confirmed Should-fix asks for a fix, and an unverified fix or a failed pass asks a person", () => {
  const suggestion = finding({ severity: "suggestion" })
  assert.equal(verdictFor([suggestion], [], []).outcome, "approve")
  assert.equal(
    verdictFor([finding({ severity: "blocking" })], [], []).outcome,
    "changes",
  )
  assert.equal(verdictFor([finding()], [], []).outcome, "fixes")
  assert.equal(verdictFor([finding()], [], ["correctness"]).outcome, "unsure")
  assert.equal(
    verdictFor([finding({ verification: "failed" })], [], []).outcome,
    "unsure",
  )
  assert.equal(verdictFor([suggestion], [], ["correctness"]).outcome, "unsure")
  assert.equal(
    verdictFor([], [earlierThread({ verification: "not-attempted" })], [])
      .outcome,
    "unsure",
  )
})

test("a pass always comments, whatever its verdict, because GitHub refuses an approval from the author", () => {
  for (const severity of ["suggestion", "should-fix", "blocking"]) {
    const review = first({ report: "r", findings: [finding({ severity })] }, FILES)
    assert.equal(review.event, "COMMENT", severity)
  }
})

test("a first pass with only suggestions is ready to approve, and says a person approves", () => {
  const review = first(
    { report: "r", findings: [finding({ severity: "suggestion" })] },
    FILES,
  )
  assert.equal(review.verdict.outcome, "approve")
  assert.ok(review.body.startsWith("**Ready to approve** at `0123456789`."))
  assert.match(review.headline, /ran as @alice, so it only comments\. A person approves\./)
  assert.equal(
    review.heading,
    "Review of `0123456789`: ready to approve, 1 open",
  )
})

test("a first pass with a blocking finding asks for changes, folds the report and carries the findings outside the diff", () => {
  const outside = finding({ line: 30, severity: "suggestion" })
  const review = first(
    {
      report: "[harness: a notice.]\n\n# Report",
      findings: [finding({ severity: "blocking" }), outside],
    },
    FILES,
  )
  assert.equal(review.verdict.outcome, "changes")
  assert.equal(review.commit_id, HEAD)
  assert.equal(review.comments.length, 1)
  assert.ok(review.comments[0].body.endsWith(MARK))
  assert.ok(
    review.body.startsWith(
      "**Changes needed** at `0123456789`: 1 blocking finding to fix.",
    ),
  )
  assert.ok(
    review.body.endsWith(
      "<summary>Full report</summary>\n\n# Report\n\n</details>",
    ),
  )
  assert.ok(!review.body.includes("[harness:"))
  assert.ok(!review.body.includes(VERDICT_REVIEW_MARKER))
  assert.ok(
    review.body.includes(
      "- **Blocking:** The retry drops the body. `a.ts:12`\n\n<details>\n<summary><strong>Suggestion:</strong> The retry drops the body. <code>a.ts:30</code></summary>",
    ),
  )
  assert.equal(review.heading, "Review of `0123456789`: changes needed, 2 open")
  assert.deepEqual(lastPass([{ body: verdictReviewBody(review, "s") }]), {
    lastHead: HEAD,
    bodyFindings: [
      {
        id: "B1@0123456789",
        file: "a.ts",
        line: 30,
        severity: "suggestion",
        verification: "confirmed",
        summary: outside.summary,
      },
    ],
  })
})

test("only a confirmed Blocking finding asks for changes", () => {
  const check = (findings) =>
    first({ report: "r", findings }, FILES).verdict.outcome
  assert.equal(check([finding({ severity: "blocking" })]), "changes")
  assert.equal(check([finding({ severity: "should-fix" })]), "fixes")
  assert.equal(
    check([
      finding({ severity: "should-fix" }),
      finding({ severity: "blocking" }),
    ]),
    "changes",
  )
  assert.equal(
    check([finding({ severity: "blocking", verification: "failed" })]),
    "unsure",
  )
  assert.equal(check([finding({ severity: "suggestion" })]), "approve")
})

test("a confirmed Should-fix finding asks for a fix, and neither blocks nor approves", () => {
  const review = first({ report: "r", findings: [finding()] }, FILES)
  assert.equal(review.verdict.outcome, "fixes")
  assert.ok(
    review.body.startsWith(
      "**Fixes needed** at `0123456789`: 1 finding to fix, and none blocks the merge.",
    ),
  )
  assert.equal(
    review.heading,
    "Review of `0123456789`: fixes needed, none blocking, 1 open",
  )
})

test("a pass that did not run is named, and holds the approval back", () => {
  const review = first(
    { report: "r", findings: [], failedPasses: ["correctness"] },
    [],
  )
  assert.equal(review.verdict.outcome, "unsure")
  assert.ok(
    review.body.includes(
      "**A person decides** at `0123456789`: part of the diff is unreviewed.",
    ),
  )
  assert.ok(review.body.includes("**1 pass did not run**"))
  assert.ok(review.body.includes("`correctness`"))
})

test("a session's safety notice is not posted", () => {
  assert.equal(withoutHarnessNotice("[harness: x.]\n\n# R"), "# R")
})

test("the claim of a posted finding is its first line, without the label", () => {
  assert.equal(
    threadClaim("**Should fix, unverified: The retry: drops it.**\n\nMore."),
    "The retry: drops it.",
  )
})

test("earlier threads and body findings are judged by id, and an unjudged one stays open", () => {
  const items = earlierFindings({
    threads: [
      {
        id: "T1",
        url: "u",
        path: "a.ts",
        line: 1,
        severity: "blocking",
        verification: "confirmed",
        finding: "**Blocking: Bad.**",
      },
    ],
    bodyFindings: [
      {
        id: "B1@x",
        file: "b.ts",
        line: null,
        severity: "suggestion",
        summary: "Nit. Why.",
      },
    ],
  })
  assert.deepEqual(
    items.map((item) => [item.kind, item.claim]),
    [
      ["thread", "Bad."],
      ["body", "Nit."],
    ],
  )
  const { judged, unmatched, unknownStatuses } = judgeFindings(items, [
    { id: "T1", status: "fixed", reason: "Done." },
    { threadId: "B1@x", status: "maybe", reason: "?" },
    { id: "T9", status: "fixed", reason: "Ghost." },
  ])
  assert.deepEqual(
    judged.map((item) => item.status),
    ["fixed", "open"],
  )
  assert.deepEqual(unmatched, ["T9"])
  assert.deepEqual(unknownStatuses, ["B1@x: maybe"])
})

test("a re-check is ready to approve when nothing that needs a fix stays open", () => {
  const review = recheck({ report: "r", findings: [] }, FILES, [
    earlierThread({ status: "fixed", reason: "The body is rebuilt." }),
    earlierThread({
      id: "T2",
      url: "u2",
      severity: "suggestion",
      claim: "A nit.",
    }),
  ])
  assert.equal(review.verdict.outcome, "approve")
  assert.equal(
    review.heading,
    "Re-check of `0123456789`: ready to approve, 1 open, 1 resolved",
  )
  assert.ok(review.body.startsWith("**Ready to approve** at `0123456789`."))
  assert.ok(
    review.body.includes(
      "<details>\n<summary>1 resolved</summary>\n\n- [Old claim.](u1)\n\n</details>",
    ),
  )
  assert.ok(!review.body.includes("The body is rebuilt."))
  assert.ok(review.body.includes("- **Suggestion:** [A nit.](u2)"))
  assert.ok(!review.body.includes("Unchanged."))
})

test("a re-check asks for changes for an open confirmed Blocking finding or a new one", () => {
  const check = (findings, judged) =>
    recheck({ report: "r", findings }, FILES, judged).verdict.outcome
  const blocking = { severity: "blocking" }
  assert.equal(check([], [earlierThread(blocking)]), "changes")
  assert.equal(check([finding(blocking)], []), "changes")
  assert.equal(check([], [earlierThread()]), "fixes")
  assert.equal(check([finding()], []), "fixes")
  assert.equal(
    check([finding({ verification: "not-attempted" })], []),
    "unsure",
  )
})

test("a re-check carries the open body findings and the new ones outside the diff", () => {
  const openBody = earlierThread({
    kind: "body",
    id: "B1@old",
    severity: "suggestion",
    claim: "Old nit.",
    summary: "Old nit.",
    url: undefined,
  })
  const review = recheck(
    { report: "r", findings: [finding({ line: 30, severity: "suggestion" })] },
    FILES,
    [openBody],
  )
  assert.ok(
    review.body.includes(
      "<summary><strong>Suggestion:</strong> Old nit. <code>a.ts:12</code></summary>",
    ),
  )
  for (const id of ["B1@old", "B1@0123456789"]) {
    assert.ok(
      review.body.includes(
        `reply in the conversation of this pull request and name \`${id}\`.`,
      ),
    )
  }
  assert.deepEqual(
    lastPass([{ body: verdictReviewBody(review) }]).bodyFindings.map(
      (item) => item.id,
    ),
    ["B1@old", "B1@0123456789"],
  )
})

test("the last pass is the newest review with a head marker", () => {
  assert.deepEqual(
    lastPass([
      { body: `<!-- maestro-review head=${LAST} -->` },
      { body: "a person's review" },
      { body: `<!-- maestro-review head=${HEAD} -->` },
    ]),
    { lastHead: HEAD, bodyFindings: [] },
  )
  assert.deepEqual(lastPass([{ body: "none" }]), {
    lastHead: null,
    bodyFindings: [],
  })
  assert.equal(bodyFindingsMarker([]), null)
})

test("only open threads that a pass started are re-checked", () => {
  const comment = (body, login = "alice") => ({
    id: `C-${login}`,
    author: { login },
    body,
    url: "u",
  })
  const threads = openFindingThreads([
    {
      id: "T1",
      isResolved: false,
      path: "a.ts",
      line: 12,
      comments: {
        nodes: [
          comment(
            withFindingStatus(
              "**Should fix: X.**\n\n<!-- maestro-finding severity=should-fix verification=failed -->",
              "**Still open at `abc`:** Unchanged.",
            ),
          ),
          comment("I disagree, because Y.", "bob"),
        ],
      },
    },
    {
      id: "T2",
      isResolved: true,
      path: "a.ts",
      line: 1,
      comments: {
        nodes: [comment("<!-- maestro-finding severity=blocking -->")],
      },
    },
    {
      id: "T3",
      isResolved: false,
      path: "a.ts",
      line: 2,
      comments: { nodes: [comment("A person's comment.", "carol")] },
    },
    {
      id: "T4",
      isResolved: false,
      path: "a.ts",
      line: 3,
      comments: {
        nodes: [
          comment(
            "**Blocking: Old.**\n\n<!-- maestro-finding severity=blocking -->",
          ),
        ],
      },
    },
  ])
  assert.deepEqual(threads, [
    {
      id: "T1",
      commentId: "C-alice",
      comment:
        "**Should fix: X.**\n\n<!-- maestro-finding severity=should-fix verification=failed -->",
      url: "u",
      path: "a.ts",
      line: 12,
      severity: "should-fix",
      verification: "failed",
      finding: "**Should fix: X.**",
      replies: [{ author: "bob", isBot: false, body: "I disagree, because Y." }],
      isAwaitingAnswer: true,
    },
    {
      id: "T4",
      commentId: "C-alice",
      comment:
        "**Blocking: Old.**\n\n<!-- maestro-finding severity=blocking -->",
      url: "u",
      path: "a.ts",
      line: 3,
      severity: "blocking",
      verification: "unknown",
      finding: "**Blocking: Old.**",
      replies: [],
      isAwaitingAnswer: false,
    },
  ])
})

test("a re-check knows every earlier finding, resolved or not", () => {
  const thread = (id, isResolved, body) => ({
    id,
    isResolved,
    path: "a.ts",
    line: 7,
    comments: {
      nodes: [{ id: "C", author: { login: "alice" }, body, url: "u" }],
    },
  })
  const findings = raisedFindings(
    [
      thread(
        "T1",
        true,
        withFindingStatus(
          "**Suggestion: Rename.**\n\n<!-- maestro-finding severity=suggestion verification=confirmed -->",
          "**Justified at `abc`:** A person gave a reason.",
        ),
      ),
      thread(
        "T2",
        false,
        "**Should fix: Y.**\n\n<!-- maestro-finding severity=should-fix -->",
      ),
      thread("T3", false, "A person's comment."),
    ],
    [{ file: "b.md", line: null, severity: "should-fix", summary: "Z." }],
  )
  assert.deepEqual(findings, [
    {
      file: "a.ts",
      line: 7,
      severity: "suggestion",
      isResolved: true,
      finding: "**Suggestion: Rename.**",
    },
    {
      file: "a.ts",
      line: 7,
      severity: "should-fix",
      isResolved: false,
      finding: "**Should fix: Y.**",
    },
    {
      file: "b.md",
      line: null,
      severity: "should-fix",
      isResolved: false,
      finding: "Z.",
    },
  ])
})

test("a new status replaces the one an earlier pass wrote under the finding", () => {
  const original = inlineCommentBody(finding({ evidence: null }))
  const once = withFindingStatus(original, "**Still open at `a`:** No.")
  assert.equal(
    withFindingStatus(
      once,
      findingStatus({ status: "fixed", reason: "Done." }, HEAD),
    ),
    `${original}\n\n<!-- maestro-status at=${original.length} -->\n\n**Fixed in \`0123456789\`:** Done.`,
  )
})

test("the summary links each inline finding to the comment that GitHub posted", () => {
  const review = first(
    {
      report: "r",
      findings: [finding(), finding({ summary: "Second. Why." })],
    },
    FILES,
    { postedComments: [{ path: "a.ts", line: 12, html_url: "c1" }] },
  )
  assert.ok(
    review.body.includes(
      "- **Should fix:** [The retry drops the body.](c1)\n- **Should fix:** Second. `a.ts:12`",
    ),
  )
})

test("the verdict review points at the summary and carries the state and its poster", () => {
  const review = first({ report: "r", findings: [] }, [])
  const body = verdictReviewBody(review, "https://s")
  assert.ok(
    body.startsWith(
      "## Maestro review\n\n**Ready to approve** at `0123456789`.",
    ),
  )
  assert.ok(body.includes("[The Maestro summary](https://s)"))
  assert.ok(body.includes(VERDICT_REVIEW_MARKER))
  assert.ok(body.endsWith(MARK))
  assert.equal(lastPass([{ body }]).lastHead, HEAD)
})

test("a pass rewrites the newest Maestro review only when it posted it and adds no inline comment", () => {
  const maestro = (state, login = LOGIN) => ({
    id: `${state}-${login}`,
    state,
    user: { login, type: "User" },
    body: `${VERDICT_REVIEW_MARKER}\n\n${posterMarker(login)}`,
  })
  const comment = { event: "COMMENT", comments: [] }
  assert.equal(
    reviewToRewrite([maestro("COMMENTED")], comment, LOGIN).id,
    "COMMENTED-alice",
  )
  assert.equal(
    reviewToRewrite([maestro("COMMENTED"), maestro("COMMENTED", "bob")], comment, LOGIN),
    null,
  )
  assert.equal(
    reviewToRewrite([maestro("COMMENTED")], { event: "COMMENT", comments: [{}] }, LOGIN),
    null,
  )
  assert.equal(reviewToRewrite([maestro("APPROVED")], comment, LOGIN), null)
  assert.equal(
    reviewToRewrite(
      [{ ...maestro("COMMENTED"), body: VERDICT_REVIEW_MARKER }],
      comment,
      LOGIN,
    ),
    null,
  )
  assert.equal(
    reviewToRewrite(
      [{ ...maestro("COMMENTED"), user: { login: "mallory", type: "User" } }],
      comment,
      LOGIN,
    ),
    null,
  )
})

test("the summary keeps the new pass on top and folds each earlier pass to its heading", () => {
  const one = summary({
    heading: "Review of `a`: changes needed, 2 open",
    body: "One.",
  })
  assert.ok(one.startsWith("## Maestro review\n\n<!-- maestro-pass id="))
  assert.ok(one.includes("\n\nOne.\n\n"))
  assert.ok(one.endsWith(`${SUMMARY_MARKER}\n\n${MARK}`))
  assert.ok(!one.includes("<!-- maestro-review head="))
  assert.ok(!one.includes("<details>"))

  const two = summary(
    {
      heading: "Re-check of `b`: ready to approve, 0 open, 2 resolved",
      body: "Two.",
    },
    one,
  )
  assert.ok(two.includes("<details>\n<summary>1 earlier pass</summary>\n\n"))
  assert.ok(!two.includes("One."))
  const three = summary({ heading: "Third", body: "Three." }, two)
  assert.ok(three.includes("<summary>2 earlier passes</summary>"))
  assert.deepEqual(
    readPasses(three).map((pass) => [pass.heading, pass.body]),
    [
      ["Third", "Three."],
      [
        "Re-check of `b`: ready to approve, 0 open, 2 resolved",
        "Re-check of `b`: ready to approve, 0 open, 2 resolved",
      ],
      [
        "Review of `a`: changes needed, 2 open",
        "Review of `a`: changes needed, 2 open",
      ],
    ],
  )
})

test("a summary in an older format folds each of its passes to its heading", () => {
  const old = [
    "## Maestro review",
    "### Re-check of `b`: changes needed",
    "<!-- maestro-pass id=bbb heading=UmUtY2hlY2sgb2YgYGJgOiBjaGFuZ2VzIG5lZWRlZA== -->",
    "A long re-check.",
    "<!-- /maestro-pass id=bbb -->",
    "### Earlier passes",
    "<details>\n<summary>Review of <code>a</code>: changes needed</summary>\n\n<!-- maestro-pass id=aaa heading=UmV2aWV3IG9mIGBhYDogY2hhbmdlcyBuZWVkZWQ= -->\n\nA long review.\n\n<!-- /maestro-pass id=aaa -->\n\n</details>",
    SUMMARY_MARKER,
  ].join("\n\n")
  const body = summary({ heading: "New", body: "Now." }, old)
  assert.ok(!body.includes("A long"))
  assert.ok(!body.includes("### "))
  assert.deepEqual(
    readPasses(body).map((pass) => [pass.id, pass.heading]),
    [
      [readPasses(body)[0].id, "New"],
      ["bbb", "Re-check of `b`: changes needed"],
      ["aaa", "Review of `a`: changes needed"],
    ],
  )
})

test("the summary drops the oldest passes when the comment grows too long", () => {
  let body
  for (const heading of ["A", "B", "C"]) {
    body = summary({ heading: heading.repeat(300), body: "x" }, body, {
      maxLength: 1600,
    })
  }
  assert.deepEqual(
    readPasses(body).map((pass) => pass.heading[0]),
    ["C", "B"],
  )
  assert.ok(body.includes("1 older pass is not shown"))
})

test("a pass that quotes the pass markers is read back whole", () => {
  const quoting =
    "The report quotes `<!-- /maestro-pass -->` and `<!-- /maestro-pass id=abc -->`. End."
  const one = summary({ heading: "First", body: quoting })
  assert.deepEqual(
    readPasses(one).map((pass) => pass.body),
    [quoting],
  )
  assert.deepEqual(
    readPasses(summary({ heading: "Second", body: "Two." }, one)).map(
      (pass) => pass.heading,
    ),
    ["Second", "First"],
  )
})

test("a finding and a status that quote the markers keep the finding whole", () => {
  const original =
    "**Should fix: The cut at `<!-- maestro-status at=0 -->` is early.**\n\n<!-- maestro-finding severity=should-fix verification=confirmed -->"
  const quoting = withFindingStatus(
    original,
    "**Still open at `a`:** It quotes `<!-- maestro-finding severity=blocking -->` and `<!-- maestro-status at=1 -->`.",
  )
  const updated = withFindingStatus(quoting, "**Fixed in `b`:** Yes.")
  assert.equal(
    updated,
    `${original}\n\n<!-- maestro-status at=${original.length} -->\n\n**Fixed in \`b\`:** Yes.`,
  )
  const [thread] = openFindingThreads([
    {
      id: "T1",
      isResolved: false,
      path: "a.ts",
      line: 1,
      comments: { nodes: [{ id: "C", author: null, body: quoting, url: "u" }] },
    },
  ])
  assert.equal(thread.comment, original)
  assert.equal(
    thread.finding,
    "**Should fix: The cut at `<!-- maestro-status at=0 -->` is early.**",
  )
  assert.equal(thread.severity, "should-fix")
})

test("a resolved finding keeps its reason only when it has no thread, or GitHub refused its thread", () => {
  const review = recheck({ report: "r", findings: [] }, [], [
    earlierThread({ status: "fixed", reason: "Quiet." }),
    earlierThread({
      id: "T2",
      url: "u2",
      status: "fixed",
      isRefused: true,
      reason: "Loud.",
    }),
    earlierThread({
      kind: "body",
      id: "B1@x",
      status: "justified",
      claim: "Body.",
      reason: "Kept.",
    }),
  ])
  assert.ok(
    review.body.includes(
      "<summary>3 resolved</summary>\n\n- [Old claim.](u1)\n- [Old claim.](u2) — Loud.\n- Body. `a.ts:12` — Kept.",
    ),
  )
})

test("a started run shows its status above the last pass, and the next pass drops it", () => {
  const started = statusLine("started", HEAD, LOGIN)
  assert.equal(
    started,
    "⏳ **Maestro is reviewing `0123456789`.** Run by @alice",
  )
  const one = statusSummaryBody(started, undefined, { posterMark: MARK })
  assert.match(
    one,
    /^## Maestro review\n\n<!-- maestro-status id=[0-9a-f]+ -->\n\n⏳/,
  )
  assert.ok(one.endsWith(MARK))
  assert.equal(readStatus(one), started)
  assert.deepEqual(readPasses(one), [])

  const posted = summary({ heading: "One", body: "Pass one." }, one)
  assert.ok(!posted.includes("Maestro is reviewing"))

  const again = statusSummaryBody(started, posted, { posterMark: MARK })
  assert.equal(readStatus(again), started)
  assert.ok(again.indexOf(started) < again.indexOf("<!-- maestro-pass"))
  assert.ok(again.includes("Pass one."))

  const failed = statusSummaryBody(statusLine("failed", HEAD, LOGIN), again, {
    posterMark: MARK,
  })
  assert.ok(!failed.includes("Maestro is reviewing"))
  assert.ok(failed.includes("❌ **The review of `0123456789` failed.**"))
  assert.equal(
    statusLine("failed", null, LOGIN),
    "❌ **The review failed.** Run by @alice",
  )
  assert.deepEqual(
    readPasses(summary({ heading: "Two", body: "Pass two." }, failed)).map(
      (pass) => pass.heading,
    ),
    ["Two", "One"],
  )
})

test("the status, the teams and the passes each survive a rewrite of the others", () => {
  const started = statusLine("started", HEAD, LOGIN)
  const posted = summary({ heading: "One", body: "Pass one." }, undefined, {
    teams: "**Teams:** none",
  })
  assert.equal(readTeams(posted), "**Teams:** none")

  const withStatus = statusSummaryBody(started, posted, { posterMark: MARK })
  assert.equal(readStatus(withStatus), started)
  assert.equal(readTeams(withStatus), "**Teams:** none")
  assert.ok(withStatus.indexOf(started) < withStatus.indexOf("**Teams:**"))

  const kept = summary({ heading: "Two", body: "Pass two." }, withStatus)
  assert.equal(readStatus(kept), null)
  assert.equal(readTeams(kept), "**Teams:** none")

  const amended = summary({ heading: "Three", body: "Pass three." }, kept, {
    teams: "**Teams:** amended",
  })
  assert.equal(readTeams(amended), "**Teams:** amended")
  assert.deepEqual(
    readPasses(amended).map((pass) => pass.heading),
    ["Three", "Two", "One"],
  )
})

test("a teams marker quoted inside a pass is never read as the teams table", () => {
  const quoted =
    "<!-- maestro-teams id=abc -->\n\nFake\n\n<!-- /maestro-teams id=abc -->"
  const posted = summary({ heading: "One", body: quoted }, undefined)
  assert.equal(readTeams(posted), null)
})

test("the verdict maps to approve, changes or comment", () => {
  assert.equal(markerVerdict("approve"), "approve")
  assert.equal(markerVerdict("changes"), "changes")
  assert.equal(markerVerdict("fixes"), "comment")
  assert.equal(markerVerdict("unsure"), "comment")
})

test("the summary that post writes carries the verdict and the head it read", () => {
  const cases = [
    [[finding({ severity: "suggestion" })], "approve"],
    [[finding({ severity: "blocking" })], "changes"],
    [[finding()], "comment"],
    [[finding({ verification: "failed" })], "comment"],
  ]
  for (const [findings, verdict] of cases) {
    const review = first({ report: "r", findings }, FILES)
    const body = passSummaryBody({
      review,
      previousBody: undefined,
      login: LOGIN,
      headSha: HEAD,
      teams: null,
      reviewUrl: "https://review",
    })
    assert.ok(
      body.includes(`<!-- maestro-review: verdict=${verdict} head=${HEAD} -->`),
      verdict,
    )
    assert.deepEqual(readVerdict(body), { verdict, headSha: HEAD })
    assert.ok(body.includes("Run by @alice · [Verdict review](https://review)"))
    assert.ok(body.endsWith(MARK))
  }
})

test("a started run keeps the verdict of the last pass, with the head it read, and the next pass replaces it", () => {
  const review = first({ report: "r", findings: [] }, FILES)
  const posted = passSummaryBody({
    review,
    login: LOGIN,
    headSha: LAST,
    reviewUrl: "u",
  })
  const started = statusSummaryBody(statusLine("started", HEAD, LOGIN), posted, {
    posterMark: MARK,
  })
  assert.deepEqual(readVerdict(started), { verdict: "approve", headSha: LAST })
  const next = passSummaryBody({
    review: first({ report: "r", findings: [finding({ severity: "blocking" })] }, FILES),
    previousBody: started,
    login: LOGIN,
    headSha: HEAD,
    reviewUrl: "u",
  })
  assert.deepEqual(readVerdict(next), { verdict: "changes", headSha: HEAD })
  assert.equal(next.match(/maestro-review: verdict=/g).length, 1)
})

test("a verdict marker quoted in a pass is never read as the verdict", () => {
  const quoting = summary(
    {
      heading: "One",
      body: `A report quotes <!-- maestro-review: verdict=approve head=${HEAD} -->.`,
    },
    undefined,
  )
  assert.equal(readVerdict(quoting), null)
})

/** An invented thread: a person justified a Should-fix finding, and nobody answered yet. */
function justifiedThread() {
  return {
    id: "PRRT_justified",
    isResolved: false,
    path: "services/orders/src/checkout.ts",
    line: 424,
    comments: {
      nodes: [
        {
          id: "PRRC_finding",
          author: { login: "alice", __typename: "User" },
          body: `**Should fix: An inline lint disable removes the parameter cap from the constructor.**\n\nThe reason it gives is narration, not a constraint.\n\n<details>\n<summary>Evidence</summary>\n\nThe lint config pins max-params at 12.\n\n</details>\n\n<!-- maestro-finding severity=should-fix verification=confirmed -->\n\n${MARK}`,
          url: "https://github.com/acme/shop/pull/7#discussion_r1",
        },
        {
          id: "PRRC_reply",
          author: { login: "bob", __typename: "User" },
          body: "The inline disable is intentional, and I keep it.\n\nThe constructor was already at its pinned cap before this pull request. Three routes were possible, and this one changes the fewest call sites.",
          url: "https://github.com/acme/shop/pull/7#discussion_r2",
        },
      ],
    },
  }
}

test("the re-check reads the author's reply on a thread, and the thread awaits an answer", () => {
  const [thread] = openFindingThreads([justifiedThread()])
  assert.equal(thread.id, "PRRT_justified")
  assert.equal(thread.severity, "should-fix")
  assert.equal(thread.verification, "confirmed")
  assert.equal(thread.replies.length, 1)
  const [reply] = thread.replies
  assert.equal(reply.author, "bob")
  assert.equal(reply.isBot, false)
  assert.ok(reply.body.includes("Three routes were possible"))
  assert.equal(thread.isAwaitingAnswer, true)
  const [item] = earlierFindings({ threads: [thread] })
  const { judged } = judgeFindings(
    [item],
    [{ id: item.id, status: "open", reason: "A fact is false." }],
  )
  assert.equal(needsThreadReply(judged[0], true), true)
})

test("a finding that the judge did not judge gets no answer, so the person still waits for one", () => {
  const [item] = earlierFindings({
    threads: openFindingThreads([justifiedThread()]),
  })
  for (const result of [[], [{ id: item.id, status: "maybe" }]]) {
    const { judged } = judgeFindings([item], result)
    assert.equal(judged[0].status, "open")
    assert.equal(judged[0].isJudged, false)
    assert.equal(needsThreadReply(judged[0], true), false)
  }
})

test("a thread where Maestro answered last awaits no answer, whoever ran the pass", () => {
  const raw = justifiedThread()
  raw.comments.nodes.push({
    id: "C-answer",
    author: { login: "carol", __typename: "User" },
    body: `**Justified in \`aac04fd557\`:** The reply holds.\n\n${posterMarker("carol")}`,
    url: "u",
  })
  const [thread] = openFindingThreads([raw])
  assert.equal(thread.replies.at(-1).isBot, true)
  assert.equal(thread.isAwaitingAnswer, false)
  assert.equal(needsThreadReply({ ...thread, status: "open" }, true), false)
  assert.equal(needsThreadReply({ ...thread, status: "fixed" }, true), false)
  assert.equal(needsThreadReply({ ...thread, status: "fixed" }, false), true)
})

test("a justified thread and a justified body finding make the re-check ready to approve", () => {
  const items = earlierFindings({
    threads: openFindingThreads([justifiedThread()]),
    bodyFindings: [
      {
        id: "B1@00c27459b8",
        file: "checkout.ts",
        line: 520,
        severity: "should-fix",
        verification: "confirmed",
        summary: "No test covers the discount cap. Why.",
      },
    ],
  })
  const { judged } = judgeFindings(items, [
    {
      id: "PRRT_justified",
      status: "justified",
      reason: "The constructor sat at its pinned cap.",
    },
    { id: "B1@00c27459b8", status: "justified", reason: "Out of scope." },
  ])
  assert.deepEqual(
    judged.map((item) => item.status),
    ["justified", "justified"],
  )
  assert.equal(
    findingStatus(judged[0], HEAD),
    "**Justified in `0123456789`:** The constructor sat at its pinned cap.",
  )
  const review = recheck({ report: "r", findings: [] }, [], judged)
  assert.equal(review.verdict.outcome, "approve")
  assert.ok(review.heading.endsWith("ready to approve, 0 open, 2 resolved"))
})

test("the conversation keeps what people wrote, oldest first, and drops bots, Maestro output and empty bodies", () => {
  const conversation = personComments(
    [
      {
        user: { login: "alice", type: "User" },
        body: `## Maestro review\n\n${SUMMARY_MARKER}\n\n${MARK}`,
        html_url: "c0",
        created_at: "2026-11-03T14:00:00Z",
      },
      {
        user: { login: "ci-bot[bot]", type: "Bot" },
        body: "Build passed.",
        html_url: "c1",
        created_at: "2026-11-03T14:07:43Z",
      },
      {
        user: { login: "bob", type: "User" },
        body: "B1@00c27459b8 is out of scope, because a later pull request adds the test.",
        html_url: "c2",
        created_at: "2026-11-03T18:00:00Z",
      },
    ],
    [
      {
        user: { login: "alice", type: "User" },
        body: `## Maestro review\n\n${MARK}`,
        html_url: "r1",
        submitted_at: "2026-11-03T15:04:44Z",
      },
      {
        user: { login: "carol", type: "User" },
        body: "",
        html_url: "r2",
        submitted_at: "2026-11-03T16:00:00Z",
      },
      {
        user: { login: "carol", type: "User" },
        body: "Fine by me.",
        html_url: "r3",
        submitted_at: "2026-11-03T17:00:00Z",
      },
    ],
  )
  assert.deepEqual(conversation, [
    { author: "carol", body: "Fine by me.", url: "r3" },
    {
      author: "bob",
      body: "B1@00c27459b8 is out of scope, because a later pull request adds the test.",
      url: "c2",
    },
  ])
})

/** A changed context line, so a hunk covers lines `start` to `start + count - 1` of the new file. */
function hunk(oldStart, newStart, count) {
  return [
    `@@ -${oldStart},${count} +${newStart},${count} @@`,
    ...Array.from({ length: count }, (_, index) => ` line ${newStart + index}`),
  ].join("\n")
}

const LONG_FILE = "services/orders/src/turn-setup.ts"

/** An invented finding at line 520, outside every hunk of its file, and that file's patch. */
function findingOutsideHunk() {
  const summary =
    "No test covers the cap on the checkout path. Nothing checks that the setup merges the role into the request context. Removing either change leaves every suite green."
  return {
    finding: {
      file: LONG_FILE,
      line: 520,
      severity: "should-fix",
      verification: "confirmed",
      summary,
    },
    carried: {
      id: "B1@00c27459b8",
      file: LONG_FILE,
      line: 520,
      severity: "should-fix",
      verification: "confirmed",
      summary,
    },
    files: [
      {
        filename: LONG_FILE,
        patch: [hunk(21, 21, 7), hunk(77, 78, 7), hunk(158, 160, 41)].join(
          "\n",
        ),
      },
    ],
  }
}

/** The review thread that GitHub makes from a file comment: it has a path and no line. */
function fileThread(path, body) {
  return {
    id: "PRRT_file",
    isResolved: false,
    path,
    line: null,
    comments: {
      nodes: [
        {
          id: "PRRC_file",
          author: { login: "alice", __typename: "User" },
          body,
          url: "https://github.com/acme/shop/pull/7#discussion_r3",
        },
      ],
    },
  }
}

test("a finding outside every hunk gets a file comment, and the summary links it instead of carrying it", () => {
  const { finding: real, files } = findingOutsideHunk()
  assert.deepEqual(placeFindings([real], files).fileLevel, [real])
  assert.deepEqual(fileCommentCandidates([real], files), [real])

  const body = fileCommentBody(real, HEAD, MARK)
  assert.ok(
    body.startsWith(
      "**Should fix: No test covers the cap on the checkout path.**\n\nNothing checks",
    ),
  )
  assert.ok(body.includes("The finding is at line 520 of this file."))
  assert.ok(
    body.endsWith(
      `<!-- maestro-finding severity=should-fix verification=confirmed -->\n\n${MARK}`,
    ),
  )

  const url = "https://github.com/acme/shop/pull/7#discussion_r3"
  const review = first({ report: "r", findings: [real] }, files, {
    fileComments: [{ item: real, url }],
  })
  assert.equal(review.comments.length, 0)
  assert.ok(
    review.body.includes(
      `- **Should fix:** [No test covers the cap on the checkout path.](${url})`,
    ),
  )
  assert.ok(!review.body.includes("reply in the conversation"))
  assert.deepEqual(
    lastPass([{ body: verdictReviewBody(review, "s") }]).bodyFindings,
    [],
  )
})

test("a reply on a file comment is judged on the re-check, and a justified one resolves its thread", () => {
  const { finding: real } = findingOutsideHunk()
  const thread = fileThread(real.file, fileCommentBody(real, HEAD, MARK))
  thread.comments.nodes.push({
    id: "PRRC_reply",
    author: { login: "bob", __typename: "User" },
    body: "A later pull request adds the test, so this one keeps the checkout path out of scope.",
    url: "u",
  })
  const [read] = openFindingThreads([thread])
  assert.equal(read.severity, "should-fix")
  assert.equal(read.verification, "confirmed")
  assert.equal(read.line, null)
  assert.equal(read.isAwaitingAnswer, true)

  const items = earlierFindings({ threads: [read] })
  assert.equal(items[0].kind, "thread")
  assert.equal(items[0].claim, "No test covers the cap on the checkout path.")
  const { judged } = judgeFindings(items, [
    { id: "PRRT_file", status: "justified", reason: "Out of scope." },
  ])
  assert.equal(needsThreadReply(judged[0], true), true)
  const review = recheck({ report: "r", findings: [] }, [], judged)
  assert.equal(review.verdict.outcome, "approve")
  assert.ok(review.heading.endsWith("ready to approve, 0 open, 1 resolved"))
})

test("a finding on a line of a hunk stays a line comment of the verdict review", () => {
  const { finding: real, files } = findingOutsideHunk()
  const onHunk = { ...real, line: 160 }
  assert.deepEqual(fileCommentCandidates([onHunk], files), [])
  const review = first({ report: "r", findings: [onHunk] }, files)
  assert.deepEqual(
    review.comments.map(({ path, line, side }) => ({ path, line, side })),
    [{ path: real.file, line: 160, side: "RIGHT" }],
  )
  assert.deepEqual(
    lastPass([{ body: verdictReviewBody(review, "s") }]).bodyFindings,
    [],
  )
})

test("a finding in a file outside the diff gets no review comment, and the summary carries it with an id to reply to", () => {
  const { finding: real, files } = findingOutsideHunk()
  const elsewhere = { ...real, file: "services/orders/src/context.ts", line: 88 }
  assert.deepEqual(fileCommentCandidates([elsewhere], files), [])
  const review = first({ report: "r", findings: [elsewhere] }, files)
  assert.equal(review.comments.length, 0)
  assert.ok(
    review.body.includes(
      "reply in the conversation of this pull request and name `B1@0123456789`.",
    ),
  )
  assert.deepEqual(
    lastPass([{ body: verdictReviewBody(review, "s") }]).bodyFindings.map(
      ({ id, file, line }) => ({ id, file, line }),
    ),
    [{ id: "B1@0123456789", file: elsewhere.file, line: 88 }],
  )
})

test("a file comment that GitHub refused leaves its finding in the summary", () => {
  const { finding: real, files } = findingOutsideHunk()
  const review = first({ report: "r", findings: [real] }, files, {
    fileComments: [],
  })
  assert.deepEqual(
    lastPass([{ body: verdictReviewBody(review, "s") }]).bodyFindings.map(
      (item) => item.id,
    ),
    ["B1@0123456789"],
  )
})

test("an open body finding moves to a file comment on the re-check, with its judgement and its old id", () => {
  const { carried, files } = findingOutsideHunk()
  const [item] = earlierFindings({ bodyFindings: [carried] })
  const { judged } = judgeFindings(
    [item],
    [{ id: carried.id, status: "open", reason: "No test was added." }],
  )
  const [open] = judged
  assert.deepEqual(fileCommentCandidates([], files, judged), [open])

  const body = fileCommentBody(open, HEAD)
  assert.ok(
    body.includes(
      "Earlier passes listed this finding in the summary as `B1@00c27459b8`.",
    ),
  )
  assert.ok(body.endsWith("**Still open at `0123456789`:** No test was added."))
  const [read] = openFindingThreads([fileThread(carried.file, body)])
  assert.equal(read.severity, "should-fix")
  assert.ok(!read.comment.includes("Still open at"))

  const url = "https://github.com/acme/shop/pull/7#discussion_r4"
  const review = recheck({ report: "r", findings: [] }, files, judged, {
    fileComments: [{ item: open, url }],
  })
  assert.equal(review.verdict.outcome, "fixes")
  assert.ok(
    review.body.includes(
      `- **Should fix:** [No test covers the cap on the checkout path.](${url})`,
    ),
  )
  assert.deepEqual(
    lastPass([{ body: verdictReviewBody(review, "s") }]).bodyFindings,
    [],
  )
})

test("a settled body finding, or one whose file left the diff, stays where it is", () => {
  const { carried, files } = findingOutsideHunk()
  const [item] = earlierFindings({ bodyFindings: [carried] })
  const { judged: justified } = judgeFindings(
    [item],
    [{ id: carried.id, status: "justified", reason: "Out of scope." }],
  )
  assert.deepEqual(fileCommentCandidates([], files, justified), [])
  const { judged: open } = judgeFindings(
    [item],
    [{ id: carried.id, status: "open", reason: "No test was added." }],
  )
  assert.deepEqual(fileCommentCandidates([], [], open), [])
})

test("a body finding that the re-check did not judge stays in the body, so a reply that names its id is still read", () => {
  const { carried, files } = findingOutsideHunk()
  const [item] = earlierFindings({ bodyFindings: [carried] })
  const { judged } = judgeFindings([item], [])
  assert.equal(judged[0].isJudged, false)
  assert.deepEqual(fileCommentCandidates([], files, judged), [])
})
