# Web blueprint

This is an example blueprint for an invented shop. Replace each section with the rules of your own surface.

## Owners

- Owner: `@web-lead-handle`
- Review team: `@your-org/web-team`

## Paths

Every file under `apps/web/`: the pages, the components and the API client of the shop's storefront.

## Rules

1. **A page reads data only through `api/`.** A component that calls `fetch` directly skips the error handling `api/` gives.
2. **A price comes from the API as cents and is formatted once, in `format/money.ts`.** Two formatters show two prices for one item.

## Traps

- A component that reads the cart from local storage shows the previous user's cart after a sign-out.

## Proof

- `npm test --workspace apps/web` passes.
- A new page has a test that renders it with an API error, and shows the error state.
