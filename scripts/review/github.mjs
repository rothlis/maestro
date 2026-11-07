/**
 * The two GitHub calls the review makes, with the token in GH_TOKEN. Each returns
 * `{ ok, status, data | text }`, so a caller decides what a refusal means instead of
 * catching an exception.
 */

const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
}

export async function github(path, { token, ...init } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...HEADERS,
      Authorization: `Bearer ${token ?? process.env.GH_TOKEN}`,
      ...init.headers,
    },
  })
  if (!response.ok) {
    return { ok: false, status: response.status, text: await response.text() }
  }
  return { ok: true, status: response.status, data: await response.json() }
}

/** GraphQL answers 200 with an `errors` array, so a refusal is read from the body too. */
export async function graphql(query, variables) {
  const response = await github("/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) return response
  if (response.data.errors?.length) {
    return {
      ok: false,
      status: response.status,
      text: JSON.stringify(response.data.errors),
    }
  }
  return { ok: true, status: response.status, data: response.data.data }
}

export function warn(line) {
  console.error(`maestro-review: warning: ${line}`)
}

export function fail(line) {
  console.error(`maestro-review: ${line}`)
  process.exit(1)
}
