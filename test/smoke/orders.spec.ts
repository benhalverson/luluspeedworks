import { order, orderPage } from "../order-fixtures";
import { checkLayout, expect, test } from "./fixtures";

test("owned order history separates paid evidence from failed fulfillment and supports retry and reload", async ({
  page,
  api,
}) => {
  const paid = {
    ...order,
    status: "paid_fulfillment_failed",
    paymentStatus: "paid",
    fulfillmentState: "process_unknown",
  };
  api.responses.set("GET /orders", { body: { ...orderPage, orders: [paid] } });
  api.responses.set("GET /orders/1", {
    status: 503,
    body: { error: "Unavailable" },
  });
  await page.goto("/profile");
  await page.getByRole("link", { name: "Your orders", exact: true }).click();
  await page.getByRole("link", { name: "Order LULU-001" }).click();
  await expect(page.getByText(/Orders unavailable/)).toBeVisible();
  api.responses.set("GET /orders/1", { body: paid });
  await page.getByRole("button", { name: "Retry orders" }).click();
  await expect(page.getByText("Payment: paid")).toBeVisible();
  await expect(
    page.getByText(/Payment received; fulfillment needs attention/),
  ).toBeVisible();
  await expect(
    page.getByText("Fulfillment: Production submission needs verification"),
  ).toBeVisible();
  await expect(page.getByText("$32.99")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Order LULU-001" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Track shipment" }),
  ).toHaveAttribute("href", order.fulfillment.trackingUrl);
  await page.getByRole("link", { name: "Back to orders" }).click();
  await expect(
    page.getByRole("link", { name: "Order LULU-001" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await checkLayout(page);
  api.responses.set("GET /api/auth/get-session", { body: null });
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Sign in to view your orders" }),
  ).toBeVisible();
  await expect(page.getByText("$32.99")).toHaveCount(0);
});
