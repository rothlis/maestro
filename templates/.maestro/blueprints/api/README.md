# API blueprint

This is an example blueprint for an invented shop. Replace each section with the rules of your own surface.

## Owners

- Owner: `@api-lead-handle`
- Review team: `@your-org/api-team`

## Paths

Every file under `services/api/`. The HTTP routes, the use cases, the database access and the migrations of the orders API are in scope.

## Structure

A request goes through three layers, in this order:

1. `routes/` reads the request, checks its schema, and calls one use case.
2. `use-cases/` holds the business rules. A use case gets its dependencies through its constructor.
3. `db/` holds the queries. Only a use case calls it.

A new feature adds one use case and the route that calls it. It does not add a fourth layer.

## Rules

1. **A route never calls `db/`.** The use case owns each rule, so a test of the use case covers it.
2. **Each query limits its data to one shop.** Pass `shopId` to each query that reads orders. A query without it reads the orders of every shop.
3. **A money amount is an integer number of cents.** A float loses cents when it adds amounts.
4. **A migration only adds.** Drop a column in a second migration, after no code reads it.

## Traps

- An `undefined` in a query filter matches every row. Check that `shopId` has a value before the query runs.
- The test database keeps rows between tests. Each test creates its own shop, and never reads a shop that another test made.

## Proof

- `npm test --workspace services/api` passes.
- A new use case has a test that calls it with a second shop, and gets none of the first shop's data.
- A new migration runs on a copy of the production schema before the pull request merges.
