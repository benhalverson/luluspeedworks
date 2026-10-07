import { checkLayout, expect, test } from "./fixtures";

for (const route of ["signin", "signup", "profile"]) {
  test(`trailing-slash ${route} supports closing and browser history`, async ({
    page,
    api,
  }) => {
    if (route !== "profile")
      api.responses.set("GET /api/auth/get-session", { body: null });
    await page.goto(`/${route}/`);
    await expect(
      page.getByRole("dialog", { name: "Your account" }),
    ).toBeVisible();
    if (route === "profile")
      await expect(
        page.getByRole("form", { name: "Shipping profile" }),
      ).toBeVisible();
    else
      await expect(
        page.getByRole("button", {
          name: route === "signup" ? "Create account" : "Sign in with password",
        }),
      ).toBeVisible();
    await expect(page.getByText("Product not found")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL("/");
    await page.goBack();
    await expect(
      page.getByRole("dialog", { name: "Your account" }),
    ).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await checkLayout(page);
  });
}

test("sign-in resumes a trailing-slash profile destination", async ({
  page,
  api,
}) => {
  api.responses.set("GET /api/auth/get-session", { body: null });
  await page.goto("/signin/?returnTo=%2Fprofile%2F");
  await page.getByLabel("Email", { exact: true }).fill("smoke@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test password 123");
  const user = {
    id: "admin",
    name: "Smoke admin",
    email: "smoke@example.test",
    emailVerified: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  api.responses.set("POST /api/auth/sign-in/email", {
    body: { user, token: "fixture", redirect: false },
  });
  api.responses.delete("GET /api/auth/get-session");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page).toHaveURL("/profile/");
  await expect(
    page.getByRole("form", { name: "Shipping profile" }),
  ).toBeVisible();
  await expect(page.getByText("Product not found")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await checkLayout(page);
});
