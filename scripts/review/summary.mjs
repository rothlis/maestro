/**
 * The one Maestro summary comment of a pull request. Each pass rewrites it: the pass on top,
 * and each earlier pass folded to its heading in one `<details>` block, newest first.
 *
 * A comment counts as the summary only while it holds a poster marker after
 * `SUMMARY_MARKER`, so a person's comment that quotes the marker is never rewritten.
 *
 * Each pass sits between two markers, and its heading is base64 in the opening one, so the
 * next pass reads the earlier passes back without parsing the rendered Markdown. A report
 * can quote a marker, so both markers carry a random id that only the pass itself knows.
 *
 * The comment has three sections: the run status (`prepare` and `failed`), the teams table
 * and the passes (`post`). Each writer rewrites its own section and keeps the others, except
 * that the post of a pass drops the status. The status and the teams sit above the first
 * pass, and only that part is read.
 */

import { randomBytes } from "node:crypto"

import { posterOf } from "./author.mjs"
import { fail, github, graphql, warn } from "./github.mjs"

/** Never `<!-- maestro-review head=`, which marks the review of a pass. */
export const SUMMARY_MARKER = "<!-- maestro-review-summary -->"

/** Read after `SUMMARY_MARKER` only, so a report that quotes the marker is never taken for it. */
export function isSummaryComment(body) {
  if (!body?.includes(SUMMARY_MARKER)) return false
  return posterOf(body.split(SUMMARY_MARKER).at(-1)) !== null
}

const VERDICT_PATTERN =
  /<!-- maestro-review: verdict=(approve|changes|comment) head=([0-9a-f]{40}) -->/

/**
 * The verdict of the last pass and the head it read, for a reader outside the review, such
 * as the announcement of the pull request. A person cannot approve their own pull request on
 * GitHub, so the summary carries what the review would have done.
 */
export function verdictMarker(verdict, headSha) {
  return `<!-- maestro-review: verdict=${verdict} head=${headSha} -->`
}

/** Read after `SUMMARY_MARKER` only, like the poster marker. */
export function readVerdict(body) {
  if (!body?.includes(SUMMARY_MARKER)) return null
  const match = VERDICT_PATTERN.exec(body.split(SUMMARY_MARKER).at(-1))
  return match ? { verdict: match[1], headSha: match[2] } : null
}

function keptVerdictMarker(previousBody) {
  const kept = readVerdict(previousBody)
  return kept ? verdictMarker(kept.verdict, kept.headSha) : null
}

const PASS_OPENING = "<!-- maestro-pass "

const PASS_PATTERN =
  /<!-- maestro-pass id=([0-9a-f]+) heading=([A-Za-z0-9+/=]+) -->([\s\S]*?)<!-- \/maestro-pass id=\1 -->/g

/** A GitHub comment holds at most 65,536 characters. The margin keeps the notice below. */
const MAX_LENGTH = 60_000

function encode(text) {
  return Buffer.from(text).toString("base64")
}

function decode(text) {
  return Buffer.from(text, "base64").toString("utf8")
}

/** A `<summary>` renders HTML and not Markdown, so the claim's code spans become `<code>`. */
export function toSummaryHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
}

/** The passes of an earlier summary, newest first. */
export function readPasses(body) {
  if (!body) return []
  return [...body.matchAll(PASS_PATTERN)].map((match) => ({
    id: match[1],
    heading: decode(match[2]),
    body: match[3].trim(),
  }))
}

function sectionPattern(name) {
  return new RegExp(
    `<!-- maestro-${name} id=([0-9a-f]+) -->([\\s\\S]*?)<!-- \\/maestro-${name} id=\\1 -->`,
  )
}

/** Read above the first pass only, so a report that quotes a marker is never taken for one. */
function readSection(name, body) {
  if (!body) return null
  const head = body.split(PASS_OPENING)[0]
  return head.match(sectionPattern(name))?.[2].trim() ?? null
}

function wrappedSection(name, text) {
  if (!text) return null
  const id = randomBytes(6).toString("hex")
  return [
    `<!-- maestro-${name} id=${id} -->`,
    text,
    `<!-- /maestro-${name} id=${id} -->`,
  ].join("\n\n")
}

export const readStatus = (body) => readSection("status", body)
export const readTeams = (body) => readSection("teams", body)

function wrapped(pass) {
  return [
    `<!-- maestro-pass id=${pass.id} heading=${encode(pass.heading)} -->`,
    pass.body,
    `<!-- /maestro-pass id=${pass.id} -->`,
  ].join("\n\n")
}

/** An earlier pass keeps its heading only. A summary in an older format folds the same way. */
function earlierBlock(earlier) {
  if (!earlier.length) return null
  return [
    "<details>",
    `<summary>${earlier.length === 1 ? "1 earlier pass" : `${earlier.length} earlier passes`}</summary>`,
    "",
    earlier
      .map((pass) => wrapped({ ...pass, body: pass.heading }))
      .join("\n\n"),
    "",
    "</details>",
  ].join("\n")
}

/**
 * A status line sits above the passes while a run works, or after it failed, and the post
 * of a pass drops it. The teams table stays until the next pass replaces it.
 */
function render(
  [current, ...earlier],
  droppedCount,
  { status, teams, posterMark, verdict },
) {
  return [
    "## Maestro review",
    wrappedSection("status", status),
    wrappedSection("teams", teams),
    current ? wrapped(current) : null,
    earlierBlock(earlier),
    droppedCount
      ? `${droppedCount} older ${droppedCount === 1 ? "pass is" : "passes are"} not shown, because a GitHub comment holds at most 65,536 characters.`
      : null,
    SUMMARY_MARKER,
    verdict,
    posterMark,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** The oldest passes go when the comment grows too long. */
function fit(passes, sections, maxLength) {
  let droppedCount = 0
  let body = render(passes, droppedCount, sections)
  while (body.length > maxLength && passes.length > 1) {
    passes.pop()
    droppedCount++
    body = render(passes, droppedCount, sections)
  }
  return body
}

/**
 * The new pass goes on top, every earlier pass folds, and the status line goes. `teams`
 * replaces the teams section when the pass gives one, and the earlier one stays otherwise.
 * `posterMark` is the poster marker of the person who runs the pass, and `verdict` the
 * verdict marker of the pass.
 */
export function summaryBody(
  pass,
  previousBody,
  {
    posterMark,
    verdict = keptVerdictMarker(previousBody),
    teams = readTeams(previousBody),
    maxLength = MAX_LENGTH,
  },
) {
  return fit(
    [
      { id: randomBytes(6).toString("hex"), ...pass },
      ...readPasses(previousBody),
    ],
    { status: null, teams, posterMark, verdict },
    maxLength,
  )
}

/**
 * The status line replaces the one an earlier run wrote, and the rest stays. The verdict of
 * the last pass stays too: it names the head it read, so a reader sees that it is older.
 */
export function statusSummaryBody(
  status,
  previousBody,
  { posterMark, maxLength = MAX_LENGTH },
) {
  return fit(
    readPasses(previousBody),
    {
      status,
      teams: readTeams(previousBody),
      posterMark,
      verdict: keptVerdictMarker(previousBody),
    },
    maxLength,
  )
}

/** Matched by its marker and a poster marker after it. The newest one holds every pass. */
export async function findSummaryComment(repo, pr) {
  let found = null
  for (let page = 1; ; page++) {
    const response = await github(
      `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,
    )
    if (!response.ok) {
      fail(`Listing the comments answered ${response.status}: ${response.text}`)
    }
    for (const comment of response.data) {
      if (isSummaryComment(comment.body)) found = comment
    }
    if (response.data.length < 100) return found
  }
}

const MINIMIZE = `
  mutation ($subject: ID!) {
    minimizeComment(input: { subjectId: $subject, classifier: OUTDATED }) {
      minimizedComment { isMinimized }
    }
  }
`

/**
 * Rewrites the summary in place. A person may not edit the summary that another person's
 * run posted, so the pass posts a new one instead, and the new one keeps the earlier
 * passes. The old one is then hidden as outdated.
 */
export async function upsertSummaryComment(repo, pr, existing, body) {
  if (existing) {
    const update = await github(
      `/repos/${repo}/issues/comments/${existing.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ body }),
      },
    )
    if (update.ok) return update.data
    if (![403, 404].includes(update.status)) {
      fail(
        `Updating the summary ${existing.html_url} answered ${update.status}: ${update.text}`,
      )
    }
    warn(
      `GitHub refused to update the summary ${existing.html_url} (${update.status}): ${update.text}. Posting a new one.`,
    )
  }
  const created = await github(`/repos/${repo}/issues/${pr}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  })
  if (!created.ok) {
    fail(`Posting the summary answered ${created.status}: ${created.text}`)
  }
  if (existing?.node_id) {
    const hidden = await graphql(MINIMIZE, { subject: existing.node_id })
    if (!hidden.ok) {
      warn(
        `GitHub refused to hide the old summary ${existing.html_url} (${hidden.status}): ${hidden.text}`,
      )
    }
  }
  return created.data
}
