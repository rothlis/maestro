/**
 * Posts one `/maestro:maestro review` pass on a pull request, as the person who runs it: one
 * summary comment that each pass rewrites, and one short verdict review on the head commit
 * it read.
 *
 * The verdict has four outcomes, and this header is the only place that states the rule.
 * A Blocking or a Should-fix finding needs a fix. Only a Blocking finding blocks:
 *
 * - approve, when no finding that needs a fix is open and every pass ran. A suggestion
 *   never holds a pull request back, because it can wait for a later one;
 * - changes, when a confirmed Blocking finding is open;
 * - unsure, when a pass did not run or a finding that needs a fix is unverified. A person
 *   decides. An unverified finding is one the refutation pass could not check, so asking
 *   for changes on it would block on a claim nobody proved;
 * - fixes, when a confirmed Should-fix finding is open and nothing blocks. The finding
 *   still needs a fix, and it does not block the merge.
 *
 * The review always comments, because GitHub refuses an approval and a change request from
 * the author of a pull request. The outcome goes in the review text, and in a verdict marker
 * of the summary, which a reader outside the review reads.
 *
 * GitHub can rewrite the body of a submitted review, and never its state. So a pass
 * rewrites its own last verdict review when the pass adds no inline comment, and posts a
 * new review otherwise.
 *
 * A re-check writes its judgement of each earlier inline finding under the finding, in the
 * same comment, and resolves the thread of each finding that is fixed or justified. When a
 * person wrote the last comment of a thread, it also answers there with the judgement.
 *
 * The teams come from the route pass of the same run, and the blueprint map names the team
 * of each file. A confirmed finding that still needs a fix raises the team of its file to
 * `review`. The pass requests no team: the table says which team a person must request.
 * The verdict above does not read the teams.
 *
 * Every comment is written for a person first: the claim, then one paragraph, and the
 * evidence behind a closed `<details>`. Each finding gets a review comment that a person can
 * reply to, wherever GitHub allows one:
 *
 * - a line comment in the verdict review, when its line is inside a hunk of the diff.
 *   GitHub rejects the whole review with a 422 when one comment sits outside a hunk;
 * - a file comment, posted on its own after the verdict review, when its file is in the
 *   diff and its line is not. An open finding that an earlier pass carried in its body
 *   moves to a file comment too;
 * - no comment, when its file is not in the diff, because GitHub accepts a review comment
 *   only on a file of the diff. The summary carries it, with an id that a reply in the
 *   conversation names.
 */

import { existsSync, readFileSync } from "node:fs"

import { isOwnOutput, posterMarker } from "./author.mjs"
import { fail, github, graphql, warn } from "./github.mjs"
import { readMap } from "./map.mjs"
import {
  allReviews,
  bodyFindingsMarker,
  findingMarker,
  headMarker,
  withFindingStatus,
} from "./state.mjs"
import {
  findSummaryComment,
  summaryBody,
  toSummaryHtml,
  upsertSummaryComment,
  verdictMarker,
} from "./summary.mjs"
import { passTeamsText } from "./teams.mjs"

export const VERDICT_REVIEW_MARKER = "<!-- maestro-verdict-review -->"

const SEVERITY_LABELS = {
  blocking: "Blocking",
  "should-fix": "Should fix",
  suggestion: "Suggestion",
}

const NEEDS_FIX = new Set(["blocking", "should-fix"])

const VERDICT_WORDS = {
  approve: "ready to approve",
  changes: "changes needed",
  fixes: "fixes needed, none blocking",
  unsure: "a person decides",
}

/** The verdict of the summary marker: what GitHub would have recorded, had it allowed it. */
const MARKER_VERDICTS = {
  approve: "approve",
  changes: "changes",
  fixes: "comment",
  unsure: "comment",
}

export function markerVerdict(outcome) {
  return MARKER_VERDICTS[outcome]
}

/** The lines of the new file that a review comment can target: each added or context line. */
export function commentableLines(patch) {
  const lines = new Set()
  if (!patch) return lines

  let line = 0
  for (const row of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (row.startsWith("-") || row.startsWith("\\")) continue
    lines.add(line)
    line++
  }
  return lines
}

/**
 * `inline` findings sit on a line of a hunk, `fileLevel` findings sit in a file of the diff
 * but on no line of a hunk, and `unplaced` findings sit in a file outside the diff.
 */
export function placeFindings(findings, files) {
  const linesByFile = new Map(
    files.map((file) => [file.filename, commentableLines(file.patch)]),
  )
  const inline = []
  const fileLevel = []
  const unplaced = []
  for (const finding of findings) {
    const lines = linesByFile.get(finding.file)
    if (!lines) unplaced.push(finding)
    else if (Number.isInteger(finding.line) && lines.has(finding.line))
      inline.push(finding)
    else fileLevel.push(finding)
  }
  return { inline, fileLevel, unplaced }
}

/**
 * A carried finding that the re-check did not judge stays in the body, because the judge
 * matches a reply in the conversation by its body id only.
 */
export function fileCommentCandidates(findings, files, judged = []) {
  const filesInDiff = new Set(files.map((file) => file.filename))
  return [
    ...placeFindings(findings, files).fileLevel,
    ...judged.filter(
      (item) =>
        item.kind === "body" &&
        item.status === "open" &&
        item.isJudged &&
        filesInDiff.has(item.file),
    ),
  ]
}

function withoutPosted(items, fileComments) {
  const posted = new Set(fileComments.map((comment) => comment.item))
  return items.filter((item) => !posted.has(item))
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** The session prefixes subagent output with a safety notice, and the notice is not part of the report. */
export function withoutHarnessNotice(report) {
  return report.replace(/^\[harness:[^\]]*\]\s*/, "").trim()
}

/** The first sentence of a summary is the claim. The rest explains it. */
export function splitClaim(summary) {
  const match = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(summary.trim())
  return match
    ? { claim: match[1], rest: match[2].trim() }
    : { claim: summary.trim(), rest: "" }
}

function severityLabel(finding) {
  const label = SEVERITY_LABELS[finding.severity] ?? finding.severity
  return finding.verification === "confirmed" ? label : `${label}, unverified`
}

function needsFix(item) {
  return NEEDS_FIX.has(item.severity)
}

function isConfirmedFix(item) {
  return needsFix(item) && item.verification === "confirmed"
}

function isConfirmedBlocking(item) {
  return item.severity === "blocking" && item.verification === "confirmed"
}

function evidenceBlock(finding) {
  const detail = [
    finding.evidence,
    finding.authority ? `Authority: ${finding.authority}` : null,
  ].filter(Boolean)
  if (!detail.length) return null
  return [
    "<details>",
    "<summary>Evidence</summary>",
    "",
    detail.join("\n\n"),
    "",
    "</details>",
  ].join("\n")
}

/** `marker` names the poster, and sits after the finding marker so the claim never holds it. */
export function inlineCommentBody(finding, marker = null) {
  const { claim, rest } = splitClaim(finding.summary)
  return [
    `**${severityLabel(finding)}: ${claim}**`,
    rest || null,
    evidenceBlock(finding),
    findingMarker(finding),
    marker,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/**
 * A file comment names the line it cannot sit on. A finding that an earlier pass carried in
 * its body keeps its judgement, and names the id that a reply in the conversation quoted.
 */
export function fileCommentBody(item, headSha, marker = null) {
  const { claim, rest } = splitClaim(item.summary)
  const isCarried = item.kind === "body"
  const body = [
    `**${severityLabel(item)}: ${claim}**`,
    rest || null,
    item.line ? `The finding is at line ${item.line} of this file.` : null,
    evidenceBlock(item),
    isCarried
      ? `Earlier passes listed this finding in the summary as \`${item.id}\`.`
      : null,
    findingMarker(item),
    marker,
  ]
    .filter(Boolean)
    .join("\n\n")
  return isCarried
    ? withFindingStatus(body, findingStatus(item, headSha))
    : body
}

function location(item) {
  return `${item.file}${item.line ? `:${item.line}` : ""}`
}

/**
 * A finding with no review comment: the summary carries the claim, and the block holds the
 * rest. It has no thread, so the block names the id that a reply in the conversation quotes.
 */
function findingBlock(finding) {
  const { claim, rest } = splitClaim(finding.summary)
  const replyHint = `To justify it, reply in the conversation of this pull request and name \`${finding.id}\`.`
  return [
    "<details>",
    `<summary><strong>${severityLabel(finding)}:</strong> ${toSummaryHtml(claim)} <code>${location(finding)}</code></summary>`,
    "",
    [rest, evidenceBlock(finding), replyHint].filter(Boolean).join("\n\n"),
    "",
    "</details>",
  ].join("\n")
}

function unplacedBlocks(unplaced, headSha) {
  return unplaced.map((finding, index) =>
    findingBlock({
      ...finding,
      id: carriedFinding(finding, headSha, index).id,
    }),
  )
}

/** One open finding in the summary. The thread it links to holds the detail. */
function openLine(item, claim, url) {
  const text = url ? `[${claim}](${url})` : `${claim} \`${location(item)}\``
  return `- **${severityLabel(item)}:** ${text}`
}

/**
 * A finding on a line of the diff, linked to its comment once the review is posted. Two
 * findings can share a line, so each posted comment links one finding only.
 */
function inlineLines(inline, postedComments = []) {
  const unused = [...postedComments]
  return inline.map((finding) => {
    const index = unused.findIndex(
      (comment) =>
        comment.path === finding.file && comment.line === finding.line,
    )
    const url = index === -1 ? null : unused.splice(index, 1)[0].html_url
    return openLine(finding, splitClaim(finding.summary).claim, url)
  })
}

function fileCommentLines(fileComments) {
  return fileComments.map(({ item, url }) =>
    openLine(item, splitClaim(item.summary).claim, url),
  )
}

function openList(lines) {
  return lines.length ? lines.join("\n") : null
}

function reportBlock(result) {
  return [
    "<details>",
    "<summary>Full report</summary>",
    "",
    withoutHarnessNotice(result.report),
    "",
    "</details>",
  ].join("\n")
}

function failedPassesLine(result) {
  const failedPasses = result.failedPasses ?? []
  if (!failedPasses.length) return null
  return `**${plural(failedPasses.length, "pass")} did not run**, so their part of the diff is unreviewed: ${failedPasses.map((pass) => `\`${pass}\``).join(", ")}.`
}

export function verdictFor(findings, openItems, failedPasses) {
  const items = [...openItems, ...findings]
  const toFix = items.filter(isConfirmedFix).length
  const unverified = items.filter(
    (item) => needsFix(item) && !isConfirmedFix(item),
  ).length
  const blocking = items.filter(isConfirmedBlocking).length
  const counts = { toFix, blocking, unverified }
  if (blocking) return { outcome: "changes", ...counts }
  if (unverified || failedPasses.length) return { outcome: "unsure", ...counts }
  if (toFix) return { outcome: "fixes", ...counts }
  return { outcome: "approve", ...counts }
}

function verdictLead(verdict, headSha) {
  const at = `at \`${headSha.slice(0, 10)}\``
  if (verdict.outcome === "changes") {
    return `**Changes needed** ${at}: ${plural(verdict.blocking, "blocking finding")} to fix.`
  }
  if (verdict.outcome === "fixes") {
    return `**Fixes needed** ${at}: ${plural(verdict.toFix, "finding")} to fix, and none blocks the merge.`
  }
  if (verdict.outcome === "unsure") {
    return verdict.unverified
      ? `**A person decides** ${at}: ${plural(verdict.unverified, "finding")} that would need a fix ${verdict.unverified === 1 ? "is" : "are"} unverified.`
      : `**A person decides** ${at}: part of the diff is unreviewed.`
  }
  return `**Ready to approve** ${at}.`
}

/** The line that an earlier pass folds to: its verdict and its counts. */
function passHeading(kind, headSha, verdict, openCount, resolvedCount) {
  return [
    `${kind} of \`${headSha.slice(0, 10)}\`: ${VERDICT_WORDS[verdict.outcome]}`,
    `${openCount} open`,
    resolvedCount === null ? null : `${resolvedCount} resolved`,
  ]
    .filter((part) => part !== null)
    .join(", ")
}

/** A finding with no review comment has no thread, so the next pass reads it from this body. */
export function carriedFinding(finding, headSha, index) {
  return {
    id: `B${index + 1}@${headSha.slice(0, 10)}`,
    file: finding.file,
    line: finding.line ?? null,
    severity: finding.severity,
    verification: finding.verification ?? "unknown",
    summary: finding.summary,
  }
}

function inlineComments(inline, login) {
  return inline.map((finding) => ({
    path: finding.file,
    line: finding.line,
    side: "RIGHT",
    body: inlineCommentBody(finding, posterMarker(login)),
  }))
}

/** What the next pass reads back: the head this pass read, and its findings with no review comment. */
function stateMarkers(headSha, carried, login) {
  return [
    VERDICT_REVIEW_MARKER,
    headMarker(headSha),
    bodyFindingsMarker(carried),
    posterMarker(login),
  ]
    .filter(Boolean)
    .join("\n\n")
}

function headlineFor(verdict, headSha, login) {
  const lead = verdictLead(verdict, headSha)
  const where = `This pass ran as @${login}, so it only comments.`
  return verdict.outcome === "approve"
    ? `${lead} ${where} A person approves.`
    : `${lead} ${where}`
}

/**
 * Both builders return the pass for the summary (`heading` and `body`), the line that the
 * verdict review repeats (`headline`), and the review itself (`event`, `comments`, `markers`).
 */
export function firstPassReview(result, files, headSha, options = {}) {
  const { login } = options
  const findings = result.findings ?? []
  const fileComments = options.fileComments ?? []
  const { inline, fileLevel, unplaced } = placeFindings(
    withoutPosted(findings, fileComments),
    files,
  )
  const outside = [...fileLevel, ...unplaced]
  const verdict = verdictFor(findings, [], result.failedPasses ?? [])
  const headline = headlineFor(verdict, headSha, login)

  return {
    commit_id: headSha,
    event: "COMMENT",
    verdict,
    heading: passHeading("Review", headSha, verdict, findings.length, null),
    headline,
    body: [
      headline,
      failedPassesLine(result),
      openList([
        ...inlineLines(inline, options.postedComments),
        ...fileCommentLines(fileComments),
      ]),
      ...unplacedBlocks(outside, headSha),
      reportBlock(result),
    ]
      .filter(Boolean)
      .join("\n\n"),
    markers: stateMarkers(
      headSha,
      outside.map((finding, index) => carriedFinding(finding, headSha, index)),
      login,
    ),
    comments: inlineComments(inline, login),
  }
}

/** The first line of a posted finding is `**<label>: <claim>**`. */
export function threadClaim(finding) {
  const firstLine = finding.split("\n")[0].replace(/\*\*/g, "")
  return firstLine.replace(/^[^:]+:\s*/, "")
}

/**
 * The earlier findings that are still open: each thread, and each finding the last pass
 * carried in its body. Both are judged the same way, by their id.
 */
export function earlierFindings(state) {
  return [
    ...(state.threads ?? []).map((thread) => ({
      ...thread,
      kind: "thread",
      file: thread.path,
      claim: threadClaim(thread.finding),
    })),
    ...(state.bodyFindings ?? []).map((finding) => ({
      ...finding,
      kind: "body",
      claim: splitClaim(finding.summary).claim,
    })),
  ]
}

/** Joins the session's judgement to each earlier finding. A finding it did not judge stays open. */
export function judgeFindings(items, recheck) {
  const verdicts = new Map(
    recheck.map((entry) => [entry.id ?? entry.threadId, entry]),
  )
  const judged = items.map((item) => {
    const verdict = verdicts.get(item.id)
    const isJudged = ["fixed", "justified", "open"].includes(verdict?.status)
    return isJudged && verdict.status !== "open"
      ? { ...item, status: verdict.status, reason: verdict.reason, isJudged }
      : {
          ...item,
          status: "open",
          reason: verdict?.reason ?? "The re-check did not judge it.",
          isJudged,
        }
  })
  const ids = new Set(items.map((item) => item.id))
  const unmatched = [...verdicts.keys()].filter((id) => !ids.has(id))
  const unknownStatuses = recheck
    .filter((entry) => !["fixed", "justified", "open"].includes(entry.status))
    .map((entry) => `${entry.id ?? entry.threadId}: ${entry.status}`)
  return { judged, unmatched, unknownStatuses }
}

/**
 * The resolved findings fold to their count. A thread holds the reason under its finding,
 * so the reason stays here only for a finding with no thread, or a thread GitHub refused.
 */
function resolvedBlock(resolved) {
  if (!resolved.length) return null
  const lines = resolved.map((item) => {
    const isThread = item.kind === "thread"
    const claim = isThread
      ? `[${item.claim}](${item.url})`
      : `${item.claim} \`${location(item)}\``
    return isThread && !item.isRefused
      ? `- ${claim}`
      : `- ${claim} — ${item.reason}`
  })
  return [
    "<details>",
    `<summary>${resolved.length} resolved</summary>`,
    "",
    ...lines,
    "",
    "</details>",
  ].join("\n")
}

export function recheckReview(result, files, headSha, judged, options = {}) {
  const { login } = options
  const findings = result.findings ?? []
  const fileComments = options.fileComments ?? []
  const { inline, fileLevel, unplaced } = placeFindings(
    withoutPosted(findings, fileComments),
    files,
  )
  const outside = [...fileLevel, ...unplaced]
  const resolved = judged.filter((item) => item.status !== "open")
  const open = judged.filter((item) => item.status === "open")
  const verdict = verdictFor(findings, open, result.failedPasses ?? [])
  const headline = headlineFor(verdict, headSha, login)
  const openThreads = open.filter((item) => item.kind === "thread")
  const openBody = withoutPosted(
    open.filter((item) => item.kind === "body"),
    fileComments,
  )
  const carried = [
    ...openBody.map(({ id, file, line, severity, verification, summary }) => ({
      id,
      file,
      line,
      severity,
      verification,
      summary,
    })),
    ...outside.map((finding, index) => carriedFinding(finding, headSha, index)),
  ]

  return {
    commit_id: headSha,
    event: "COMMENT",
    verdict,
    heading: passHeading(
      "Re-check",
      headSha,
      verdict,
      open.length + findings.length,
      resolved.length,
    ),
    headline,
    body: [
      headline,
      failedPassesLine(result),
      openList([
        ...openThreads.map((item) => openLine(item, item.claim, item.url)),
        ...inlineLines(inline, options.postedComments),
        ...fileCommentLines(fileComments),
      ]),
      ...openBody.map(findingBlock),
      ...unplacedBlocks(outside, headSha),
      resolvedBlock(resolved),
      reportBlock(result),
    ]
      .filter(Boolean)
      .join("\n\n"),
    markers: stateMarkers(headSha, carried, login),
    comments: inlineComments(inline, login),
  }
}

/** The review holds the verdict and the state markers. The summary comment holds the rest. */
export function verdictReviewBody(review, summaryUrl) {
  const pointer = summaryUrl
    ? `[The Maestro summary](${summaryUrl}) holds the findings and the earlier passes.`
    : "The Maestro summary comment on this pull request holds the findings and the earlier passes."
  return ["## Maestro review", review.headline, pointer, review.markers].join(
    "\n\n",
  )
}

/**
 * The verdict review that a pass can rewrite: the newest Maestro review, when this login
 * posted it and the pass adds no inline comment. A review of another person stays theirs.
 */
export function reviewToRewrite(reviews, review, login) {
  if (review.comments.length) return null
  const latest = reviews
    .filter((candidate) => candidate.body?.includes(VERDICT_REVIEW_MARKER))
    .at(-1)
  if (!latest || !isOwnOutput(latest, login)) return null
  return latest.state === "COMMENTED" ? latest : null
}

/**
 * The summary of a pass: the pass on top, with a link to its verdict review, the teams, and
 * the verdict marker that names the head the pass read.
 */
export function passSummaryBody({
  review,
  previousBody,
  login,
  headSha,
  teams,
  reviewUrl,
}) {
  return summaryBody(
    {
      heading: `${review.heading} (run by @${login})`,
      body: `${review.body}\n\nRun by @${login} · [Verdict review](${reviewUrl})`,
    },
    previousBody,
    {
      posterMark: posterMarker(login),
      verdict: verdictMarker(markerVerdict(review.verdict.outcome), headSha),
      teams,
    },
  )
}

async function pullRequestFiles(repo, pr) {
  const files = []
  for (let page = 1; ; page++) {
    const response = await github(
      `/repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`,
    )
    if (!response.ok) {
      fail(`Listing the files answered ${response.status}: ${response.text}`)
    }
    files.push(...response.data)
    if (response.data.length < 100) return files
  }
}

const UPDATE_COMMENT = `
  mutation ($comment: ID!, $body: String!) {
    updatePullRequestReviewComment(
      input: { pullRequestReviewCommentId: $comment, body: $body }
    ) {
      pullRequestReviewComment { id }
    }
  }
`
const REPLY = `
  mutation ($thread: ID!, $body: String!) {
    addPullRequestReviewThreadReply(
      input: { pullRequestReviewThreadId: $thread, body: $body }
    ) {
      comment { id }
    }
  }
`
const RESOLVE = `
  mutation ($thread: ID!) {
    resolveReviewThread(input: { threadId: $thread }) { thread { isResolved } }
  }
`

/**
 * GitHub keeps one pending review per user on a pull request, and a new review cannot
 * start while one is open. The pending review of a person can hold their own comments, so
 * the pass stops and never deletes it.
 */
function stopOnPendingReview(reviews, login) {
  const pending = reviews.find((review) => review.state === "PENDING")
  if (pending) {
    fail(
      `@${login} has a pending review on this pull request: ${pending.html_url}. Submit it or delete it, then post the pass again.`,
    )
  }
}

function withRefusal(item, what) {
  return {
    ...item,
    isRefused: true,
    reason: `${item.reason} GitHub refused to ${what}, so a person must resolve the thread.`,
  }
}

export function findingStatus(item, headSha) {
  const sha = `\`${headSha.slice(0, 10)}\``
  if (item.status === "fixed") return `**Fixed in ${sha}:** ${item.reason}`
  if (item.status === "justified")
    return `**Justified in ${sha}:** ${item.reason}`
  return `**Still open at ${sha}:** ${item.reason}`
}

/**
 * An edit of the finding notifies nobody, and it sits above the replies. So a pass also
 * answers in the thread when a person wrote its last comment, and when the edit failed on
 * a finding it settles. A finding the judge did not judge gets no answer, because the
 * answer would end the wait and the next real judgement would notify nobody.
 */
export function needsThreadReply(item, isEdited) {
  return (
    Boolean(item.isAwaitingAnswer && item.isJudged) ||
    (item.status !== "open" && !isEdited)
  )
}

/**
 * Writes the judgement under each earlier inline finding, then resolves the thread of each
 * settled one. A thread is never resolved without its reason written in it. Another
 * person's finding comment cannot be edited, so the reply carries the judgement then.
 */
async function settleThreads(judged, headSha, login) {
  const marker = posterMarker(login)
  const settled = []
  for (const item of judged) {
    if (item.kind !== "thread") {
      settled.push(item)
      continue
    }
    const status = findingStatus(item, headSha)
    const edit = await graphql(UPDATE_COMMENT, {
      comment: item.commentId,
      body: withFindingStatus(item.comment, status),
    })
    if (!edit.ok) {
      warn(`GitHub refused to update ${item.url} (${edit.status}): ${edit.text}`)
    }
    let isAnswered = false
    if (needsThreadReply(item, edit.ok)) {
      const reply = await graphql(REPLY, {
        thread: item.id,
        body: `${status}\n\n${marker}`,
      })
      isAnswered = reply.ok
      if (!reply.ok) {
        warn(
          `GitHub refused to answer ${item.url} (${reply.status}): ${reply.text}`,
        )
      }
    }
    if (item.status === "open") {
      settled.push(item)
      continue
    }
    if (!edit.ok && !isAnswered) {
      settled.push(withRefusal(item, "answer"))
      continue
    }
    const resolution = await graphql(RESOLVE, { thread: item.id })
    if (resolution.ok) {
      settled.push(item)
      continue
    }
    warn(
      `GitHub refused to resolve ${item.url} (${resolution.status}): ${resolution.text}`,
    )
    settled.push(withRefusal(item, "resolve"))
  }
  return settled
}

/**
 * Rewrites the verdict review when GitHub allows it, and posts a new one otherwise. A new
 * review falls back to findings in the summary when GitHub refuses an inline comment.
 */
async function postVerdictReview(path, reviews, build, summaryUrl, login) {
  const rewritable = reviewToRewrite(reviews, build(true), login)
  if (rewritable) {
    const review = build(true)
    const update = await github(`${path}/${rewritable.id}`, {
      method: "PUT",
      body: JSON.stringify({ body: verdictReviewBody(review, summaryUrl) }),
    })
    if (update.ok) {
      return { review, posted: update.data, isInline: true, isNew: false }
    }
    warn(
      `GitHub refused to update the review ${rewritable.html_url} (${update.status}): ${update.text}. Posting a new one.`,
    )
  }

  let isInline = true
  for (;;) {
    const review = build(isInline)
    const response = await github(path, {
      method: "POST",
      body: JSON.stringify({
        commit_id: review.commit_id,
        event: review.event,
        body: verdictReviewBody(review, summaryUrl),
        comments: review.comments,
      }),
    })
    if (response.ok) {
      return { review, posted: response.data, isInline, isNew: true }
    }
    if (response.status === 422 && isInline && review.comments.length) {
      warn(
        `GitHub refused the inline comments (${response.text}). Posting the findings in the summary.`,
      )
      isInline = false
      continue
    }
    fail(`Posting the review answered ${response.status}: ${response.text}`)
  }
}

/** The comments of one review come without their `line`, so they are read from the pull request. */
async function postedComments(repo, pr, reviewId) {
  const comments = []
  for (let page = 1; ; page++) {
    const response = await github(
      `/repos/${repo}/pulls/${pr}/comments?per_page=100&page=${page}`,
    )
    if (!response.ok) {
      warn(
        `Listing the inline comments answered ${response.status}: ${response.text}. The summary names them without links.`,
      )
      return []
    }
    comments.push(
      ...response.data.filter(
        (comment) => comment.pull_request_review_id === reviewId,
      ),
    )
    if (response.data.length < 100) return comments
  }
}

/**
 * The review endpoint takes no file comment, so each one is posted on its own, after the
 * verdict review. A pass that fails before then leaves no comment that no review records.
 * A comment that GitHub refuses leaves its finding in the summary.
 */
async function postFileComments(repo, pr, headSha, items, login) {
  const posted = []
  for (const item of items) {
    const response = await github(`/repos/${repo}/pulls/${pr}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: fileCommentBody(item, headSha, posterMarker(login)),
        commit_id: headSha,
        path: item.file,
        subject_type: "file",
      }),
    })
    if (response.ok) {
      posted.push({ item, url: response.data.html_url })
      continue
    }
    warn(
      `GitHub refused a file comment on ${item.file} (${response.status}): ${response.text}. The summary carries the finding.`,
    )
  }
  return posted
}

function readJsonOrFail(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    fail(`${what} at ${path} is not readable JSON: ${error.message}`)
  }
}

/** The session writes this file, so a missing or malformed one is reported and read as no judgement. */
function readRecheck(path, items) {
  if (!items.length) return []
  if (!existsSync(path)) {
    warn(
      `The session wrote no re-check at ${path}, so every earlier finding stays open.`,
    )
    return []
  }
  try {
    const recheck = JSON.parse(readFileSync(path, "utf8"))
    if (Array.isArray(recheck)) return recheck
  } catch (error) {
    warn(
      `The re-check at ${path} is not readable JSON (${error.message}), so every earlier finding stays open.`,
    )
    return []
  }
  warn(
    `The re-check at ${path} is not an array, so every earlier finding stays open.`,
  )
  return []
}

/**
 * Posts the pass that `resultPath` holds. Prints one line that says what it posted, then
 * `outcome`, `review-url` and `summary-url`.
 */
export async function postPass({
  repo,
  pr,
  headSha,
  login,
  resultPath,
  statePath,
  recheckPath,
}) {
  const result = readJsonOrFail(resultPath, "The review result")
  if (result.error) fail(`The review did not complete: ${result.error}`)
  if (!Array.isArray(result.findings) || !result.report?.trim()) {
    fail(
      "The review result holds no findings array or no report, so it is not a workflow result.",
    )
  }

  const state = readJsonOrFail(statePath, "The state of the earlier passes")
  const files = await pullRequestFiles(repo, pr)
  const path = `/repos/${repo}/pulls/${pr}/reviews`

  let judged = []
  if (state.pass === "recheck") {
    const items = earlierFindings(state)
    const judgement = judgeFindings(items, readRecheck(recheckPath, items))
    judged = judgement.judged
    for (const id of judgement.unmatched) {
      warn(`The re-check judged ${id}, which is no open earlier finding.`)
    }
    for (const entry of judgement.unknownStatuses) {
      warn(
        `The re-check gave an unknown status (${entry}), so the finding stays open.`,
      )
    }
  }

  const reviews = await allReviews(repo, pr)
  stopOnPendingReview(reviews, login)
  const settled = await settleThreads(judged, headSha, login)
  let fileComments = []
  const build = (isInline, extra = {}) => {
    const options = { ...extra, fileComments, login }
    return state.pass === "recheck"
      ? recheckReview(result, isInline ? files : [], headSha, settled, options)
      : firstPassReview(result, isInline ? files : [], headSha, options)
  }

  const existingSummary = await findSummaryComment(repo, pr)
  const { review, posted, isInline, isNew } = await postVerdictReview(
    path,
    reviews,
    build,
    existingSummary?.html_url,
    login,
  )

  fileComments = await postFileComments(
    repo,
    pr,
    headSha,
    fileCommentCandidates(result.findings, files, settled),
    login,
  )
  if (fileComments.length) {
    const update = await github(`${path}/${posted.id}`, {
      method: "PUT",
      body: JSON.stringify({
        body: verdictReviewBody(build(isInline), existingSummary?.html_url),
      }),
    })
    if (!update.ok) {
      warn(
        `GitHub refused to drop the findings that now have a file comment from the review ${posted.html_url} (${update.status}): ${update.text}. The next pass reads each of them twice.`,
      )
    }
  }

  const comments =
    isNew && review.comments.length
      ? await postedComments(repo, pr, posted.id)
      : []
  const final = build(isInline, { postedComments: comments })
  const teams = await passTeamsText({
    repo,
    pr,
    result,
    findings: [
      ...result.findings,
      ...settled.filter((item) => item.status === "open"),
    ],
    map: readMap(),
    token: process.env.GH_TOKEN,
  })
  const summary = await upsertSummaryComment(
    repo,
    pr,
    existingSummary,
    passSummaryBody({
      review: final,
      previousBody: existingSummary?.body,
      login,
      headSha,
      teams,
      reviewUrl: posted.html_url,
    }),
  )

  if (summary.html_url !== existingSummary?.html_url) {
    const update = await github(`${path}/${posted.id}`, {
      method: "PUT",
      body: JSON.stringify({ body: verdictReviewBody(final, summary.html_url) }),
    })
    if (!update.ok) {
      warn(
        `GitHub refused to link the review to the summary (${update.status}): ${update.text}`,
      )
    }
  }
  console.log(
    `${isNew ? "Posted a new" : "Rewrote the"} ${review.event} review ${posted.html_url} with ${plural(review.comments.length, "inline comment")}, ${plural(fileComments.length, "file comment")}, and the summary ${summary.html_url}.`,
  )
  console.log(`outcome=${review.verdict.outcome}`)
  console.log(`review-url=${posted.html_url}`)
  console.log(`summary-url=${summary.html_url}`)
}
