/**
 * Reads what earlier Maestro reviews left on a pull request, and owns the hidden markers that
 * carry it from one pass to the next:
 *
 * - the head commit that the last pass read, in its review body;
 * - each finding posted as a line or a file comment, with its severity and verification,
 *   and the status that the last pass wrote under it;
 * - each finding with no review comment, encoded in the body of the last pass.
 *
 * It also reads what people wrote: the replies in each open thread, and, when a finding with
 * no review comment is open, the conversation comments and review bodies, where a reply to
 * that finding names its id.
 *
 * A pull request with no earlier review gets a first pass. Any later pass is a re-check of
 * the open findings and of the commits since that head.
 *
 * It also lists every finding that an earlier pass raised, resolved or not, for the passes
 * of the re-check.
 */

import { isFromPerson } from "./author.mjs"
import { fail, github, graphql } from "./github.mjs"

const HEAD_MARKER = /<!-- maestro-review head=([0-9a-f]{40}) -->/
const FINDING_MARKER =
  /<!-- maestro-finding severity=([a-z-]+)(?: verification=([a-z-]+))? -->/
const BODY_FINDINGS_MARKER = /<!-- maestro-body-findings ([A-Za-z0-9+/=]+) -->/
const STATUS_MARKER = /<!-- maestro-status at=(\d+) -->/g

export function headMarker(headSha) {
  return `<!-- maestro-review head=${headSha} -->`
}

/** A review that records a pass. */
export function isPassReview(review) {
  return HEAD_MARKER.test(review.body ?? "")
}

export function findingMarker(finding) {
  return `<!-- maestro-finding severity=${finding.severity} verification=${finding.verification ?? "unknown"} -->`
}

/**
 * The finding comment without the status that a pass wrote under it. The finding and the
 * status can both quote any marker, so the status marker records the length of the
 * finding, and only a marker that sits exactly at that length counts.
 */
export function withoutFindingStatus(body) {
  for (const match of body.matchAll(STATUS_MARKER)) {
    const length = Number(match[1])
    if (match.index === length + 2) return body.slice(0, length)
  }
  return body.trim()
}

/** A pass replaces the status that an earlier pass wrote under the finding. */
export function withFindingStatus(body, status) {
  const finding = withoutFindingStatus(body)
  return `${finding}\n\n<!-- maestro-status at=${finding.length} -->\n\n${status}`
}

/** Base64, so that no finding text can close the HTML comment that carries it. */
export function bodyFindingsMarker(findings) {
  if (!findings.length) return null
  const encoded = Buffer.from(JSON.stringify(findings)).toString("base64")
  return `<!-- maestro-body-findings ${encoded} -->`
}

/** The newest review that carries a head marker is the last pass. */
export function lastPass(reviews) {
  const body = reviews
    .map((review) => review.body ?? "")
    .filter((text) => HEAD_MARKER.test(text))
    .at(-1)
  if (!body) return { lastHead: null, bodyFindings: [] }

  const encoded = BODY_FINDINGS_MARKER.exec(body)?.[1]
  return {
    lastHead: HEAD_MARKER.exec(body)[1],
    bodyFindings: encoded
      ? JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
      : [],
  }
}

/** The finding that a pass started the thread with, or null for a thread of a person. */
function threadFinding(thread) {
  const comment = withoutFindingStatus(thread.comments.nodes[0]?.body ?? "")
  const marker = [...comment.matchAll(new RegExp(FINDING_MARKER, "g"))].at(-1)
  if (!marker) return null
  return {
    comment,
    severity: marker[1],
    verification: marker[2] ?? "unknown",
    finding: comment.slice(0, marker.index).trim(),
  }
}

/**
 * Every finding that an earlier pass raised, resolved or not, so that a re-check does not
 * raise one of them again. A resolved thread was fixed or justified.
 */
export function raisedFindings(threads, bodyFindings) {
  return [
    ...threads.flatMap((thread) => {
      const finding = threadFinding(thread)
      if (!finding) return []
      return [
        {
          file: thread.path,
          line: thread.line,
          severity: finding.severity,
          isResolved: thread.isResolved,
          finding: finding.finding,
        },
      ]
    }),
    ...bodyFindings.map((finding) => ({
      file: finding.file,
      line: finding.line,
      severity: finding.severity,
      isResolved: false,
      finding: finding.summary,
    })),
  ]
}

/**
 * Keeps the open threads that a pass started, with every reply since. A thread awaits an
 * answer when a person wrote its last comment, so the next pass replies in it.
 */
export function openFindingThreads(threads) {
  return threads.flatMap((thread) => {
    const [first, ...replies] = thread.comments.nodes
    const found = threadFinding(thread)
    if (thread.isResolved || !found) return []
    return [
      {
        id: thread.id,
        commentId: first.id,
        comment: found.comment,
        url: first.url,
        path: thread.path,
        line: thread.line,
        severity: found.severity,
        verification: found.verification,
        finding: found.finding,
        replies: replies.map((reply) => ({
          author: reply.author?.login ?? "ghost",
          isBot: !isFromPerson(reply.author, reply.body),
          body: reply.body,
        })),
        isAwaitingAnswer:
          replies.length > 0 &&
          isFromPerson(replies.at(-1).author, replies.at(-1).body),
      },
    ]
  })
}

/**
 * What people wrote on the pull request outside a thread: each conversation comment, and
 * the body of each review. A finding with no review comment has no thread, so a reply to it
 * can only sit here.
 */
export function personComments(issueComments, reviews) {
  return [
    ...issueComments.map((comment) => ({
      author: comment.user,
      body: comment.body,
      url: comment.html_url,
      at: comment.created_at,
    })),
    ...reviews.map((review) => ({
      author: review.user,
      body: review.body,
      url: review.html_url,
      at: review.submitted_at,
    })),
  ]
    .filter(
      (comment) =>
        isFromPerson(comment.author, comment.body) && comment.body?.trim(),
    )
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map(({ author, body, url }) => ({
      author: author?.login ?? "ghost",
      body,
      url,
    }))
}

const THREADS_QUERY = `
  query ($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            path
            line
            comments(first: 50) {
              nodes { id author { login __typename } body url }
            }
          }
        }
      }
    }
  }
`

async function allThreads(owner, name, number) {
  const threads = []
  let after = null
  for (;;) {
    const response = await graphql(THREADS_QUERY, {
      owner,
      name,
      number,
      after,
    })
    if (!response.ok) {
      fail(
        `Reading the review threads answered ${response.status}: ${response.text}`,
      )
    }
    const page = response.data.repository.pullRequest.reviewThreads
    threads.push(...page.nodes)
    if (!page.pageInfo.hasNextPage) return threads
    after = page.pageInfo.endCursor
  }
}

async function allPages(path, what) {
  const items = []
  for (let page = 1; ; page++) {
    const response = await github(`${path}?per_page=100&page=${page}`)
    if (!response.ok) {
      fail(`Listing ${what} answered ${response.status}: ${response.text}`)
    }
    items.push(...response.data)
    if (response.data.length < 100) return items
  }
}

export function allReviews(repo, pr) {
  return allPages(`/repos/${repo}/pulls/${pr}/reviews`, "the reviews")
}

function allIssueComments(repo, pr) {
  return allPages(
    `/repos/${repo}/issues/${pr}/comments`,
    "the conversation comments",
  )
}

/** The state that `prepare` writes to `state.json`, and a one-line account of it. */
export async function readState({ repo, pr }) {
  const [owner, name] = repo.split("/")
  const reviews = await allReviews(repo, pr)
  const { lastHead, bodyFindings } = lastPass(reviews)
  const allFindingThreads = lastHead
    ? await allThreads(owner, name, Number(pr))
    : []
  const threads = openFindingThreads(allFindingThreads)
  const conversation = bodyFindings.length
    ? personComments(await allIssueComments(repo, pr), reviews)
    : []
  const pass = lastHead ? "recheck" : "first"
  const replies = threads.flatMap((thread) =>
    thread.replies.filter((reply) => !reply.isBot),
  )
  return {
    state: {
      pass,
      lastHead,
      threads,
      bodyFindings,
      conversation,
      raisedFindings: raisedFindings(allFindingThreads, bodyFindings),
    },
    line: `Pass: ${pass}. Last reviewed head: ${lastHead ?? "none"}. Open threads: ${threads.length}, with ${replies.length} replies from people. Open findings outside the diff: ${bodyFindings.length}. Comments from people in the conversation: ${conversation.length}.`,
  }
}
