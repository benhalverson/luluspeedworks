export const order = {
  id: 1,
  orderNumber: "LULU-001",
  createdAt: "2026-09-21T00:00:00Z",
  updatedAt: "2026-09-21T00:00:00Z",
  status: "processing",
  slantStatus: "PROCESSING",
  totalAmountCents: 3299,
  currency: "USD",
  items: [{ name: "RC stand", quantity: 2, color: "red", filamentType: "PLA" }],
  fulfillment: {
    trackingNumber: "TRACK-001",
    trackingUrl: "https://carrier.example/track/001",
    carrier: "Example carrier",
    estimatedArrival: "2026-09-25",
    shippedAt: "2026-09-22",
    deliveredAt: "2026-09-25",
  },
  cancellation: null,
};

export const orderPage = {
  orders: [order],
  pagination: { limit: 10, offset: 0, count: 1 },
};
