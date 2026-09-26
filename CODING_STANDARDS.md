# Review standards

Review changes against the user's current acceptance criteria and [engineering guidance](AGENTS.md). Tooling owns formatting, types and coverage; review focuses on behavior across modules.

## Request ordering

For a change crossing session, query-cache or mutation boundaries, identify which account and mounted visit owns each pending operation. Require tests that deliberately control response order at the existing UI/request boundary for the relevant cases:

- A request finishes after sign-out, an account change or route re-entry.
- A protected request is denied while a write or verification is pending.
- A late success arrives after denial, followed by a temporary failure and fresh verification.
- A recoverable failure retains unsaved input and requires the appropriate explicit retry.
- Strict Mode teardown disposes reads/subscriptions without cancelling server mutations.

Check that success in a cache, transfer provider or mutation cannot grant administrator access. Distinguish an external upload rejection from a protected draft rejection. Review which recovery requests and queued uploads can still run after denial.

Use [admin workspace regressions](test/admin-workspace.test.tsx), [bag UI regressions](test/cart-ui.test.tsx) and [account regressions](test/account.test.tsx) as examples. Add missing scenarios for the changed behavior; avoid duplicating existing cases just to populate a checklist. Coverage counts executed code, not possible request orderings.

## Scope and completion

Confirm that the selected storefront/admin interaction remains consistent with surrounding UI, including modal ownership, current selection, branding and unsaved input.

Evaluate each requested capability separately from backend integration, deployment and provider outcomes. A rendered attachment or successful mocked reset request does not establish durable provider storage or email receipt. Review the evidence using the [delivery workflow](README.md#delivery-workflow).
