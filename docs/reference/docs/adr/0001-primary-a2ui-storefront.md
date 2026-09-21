# Use A2UI as the primary storefront interface

Lulu Speedworks will use agent-composed A2UI screens from an approved component catalog throughout browsing and purchasing, with natural-language requests and direct controls in the same interface. The user explicitly rejected a conventional storefront with a separate shopping-assistant feature; the agentic interface is the product experience, not an add-on.

The existing commerce API remains authoritative for products, prices, available colors, and orders. Customers must log in before buying and explicitly confirm the final purchase total; a natural-language purchase request only prepares checkout. The new storefront lives in a separate repository, with the existing store available as a reference.

Use AG-UI for agent events, shared-state updates, and delivery of A2UI messages to the React frontend. This adopts an existing agent interaction protocol instead of defining a custom event contract; A2UI remains responsible for describing the primary interface.

Provide predefined A2UI fallback screens for browsing, cart, and checkout when inference fails. These screens use the same commerce API without a model dependency, preserving purchase availability while natural-language requests display a retry message. Agent composition remains the normal experience; fallback screens address inference outages.

Routine clickable actions use deterministic handlers and commerce API responses to update A2UI without invoking the model. Reserve inference for natural-language requests and screen composition to avoid per-click model latency and expense. Both paths use the same authoritative commerce state.
