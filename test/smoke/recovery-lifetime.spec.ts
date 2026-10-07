import { checkLayout, deferred, expect, test } from "./fixtures";

test("a lost reset response cannot replace a newer recovery visit", async ({
  page,
  api,
}) => {
  api.responses.set("GET /api/auth/get-session", { body: null });
  const pending = deferred<{ body: unknown }>();
  api.responses.set("POST /api/auth/reset-password", pending.promise);
  await page.goto("/reset-password?token=old");
  await page
    .getByLabel("New password", { exact: true })
    .fill("test password 123");
  await page.getByLabel("Confirm new password").fill("test password 123");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect
    .poll(
      () =>
        api.requests.filter((key) => key === "POST /api/auth/reset-password")
          .length,
    )
    .toBe(1);
  await page.getByRole("link", { name: "Request another email" }).click();
  await page.getByLabel("Email").fill("new-visit@example.test");
  pending.resolve({ body: { status: true } });
  await expect(page).toHaveURL(/\/forgot-password/);
  await expect(page.getByLabel("Email")).toHaveValue("new-visit@example.test");
  api.responses.set("POST /api/auth/request-password-reset", {
    body: { status: true },
  });
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText(
      "If this email exists in our system, check your email for the reset link.",
    ),
  ).toBeVisible();
  await checkLayout(page);
});
