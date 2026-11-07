/**
 * Who wrote a piece of Maestro output. A review posts as the person who runs it, so each
 * comment, reply and review it writes carries `posterMarker`. A later pass reads the marker,
 * and never the author, to tell Maestro's output from a person's reply. A person can type
 * the marker: the review accepts that risk, because the marker only hides a reply from the
 * re-check, and the person can see it.
 */

const POSTER_PATTERN = /<!-- maestro-poster by=([A-Za-z0-9-]+) -->/

export function posterMarker(login) {
  return `<!-- maestro-poster by=${login} -->`
}

/** The login that a poster marker names, or null when the body holds none. */
export function posterOf(body) {
  return POSTER_PATTERN.exec(body ?? "")?.[1] ?? null
}

export function isMaestroOutput(body) {
  return posterOf(body) !== null
}

/** `author` is a REST `user` or a GraphQL `author`. A bot is never a person. */
function isBotAccount(author) {
  return author?.__typename === "Bot" || author?.type === "Bot"
}

/** A reply that the re-check reads as a person's: no bot, and no Maestro output. */
export function isFromPerson(author, body) {
  return !isBotAccount(author) && !isMaestroOutput(body)
}

/** A comment or a review that this login wrote as Maestro, and so may rewrite. */
export function isOwnOutput(item, login) {
  return item.user?.login === login && posterOf(item.body) === login
}

export function isLogin(login) {
  return /^[A-Za-z0-9-]+$/.test(login ?? "")
}
