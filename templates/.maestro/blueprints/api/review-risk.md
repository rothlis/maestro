# Review risk: api

The risky areas of `services/api/`. The review reads this file after the plugin's general `review-risk.md`, which holds the rules of every surface. A change to one of these areas needs a person from the team that the blueprint map names for this surface.

- **Payments.** Any change under `services/api/payments/`, or to how an order total is computed.
- **A database migration.** A new file under `services/api/db/migrations/`.
- **Access to data.** A change to a query that reads orders, if it changes how the query limits its data to one shop.
- **A public contract.** A change to a route's request or response schema. The web app and outside clients call it directly.
- **A deletion of data**, or a job that deletes rows.

A change that stays inside one use case and touches none of the areas above does not need a person on account of this surface.
