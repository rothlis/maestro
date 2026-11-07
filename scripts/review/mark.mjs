/**
 * Writes the status of a review run at the top of the summary comment: "started" when the
 * run starts, so the pull request shows the run at once and the summary is the first
 * comment of the review, and "failed" when the review did not return. The post of a pass
 * rewrites the comment and drops the line.
 */

import { posterMarker } from "./author.mjs"
import {
  findSummaryComment,
  statusSummaryBody,
  upsertSummaryComment,
} from "./summary.mjs"

export function statusLine(status, headSha, login) {
  const sha = headSha ? `\`${headSha.slice(0, 10)}\`` : null
  const run = `Run by @${login}`
  if (status === "started") {
    return `⏳ **Maestro is reviewing${sha ? ` ${sha}` : ""}.** ${run}`
  }
  return `❌ **${sha ? `The review of ${sha} failed` : "The review failed"}.** ${run}`
}

/** Returns the line to report: where the status went. */
export async function markSummary(status, { repo, pr, headSha, login }) {
  const existing = await findSummaryComment(repo, pr)
  const summary = await upsertSummaryComment(
    repo,
    pr,
    existing,
    statusSummaryBody(statusLine(status, headSha, login), existing?.body, {
      posterMark: posterMarker(login),
    }),
  )
  return `Marked the review ${status} in ${summary.html_url}.`
}
