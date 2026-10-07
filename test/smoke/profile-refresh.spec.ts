import { checkLayout, expect, test } from "./fixtures";

for (const dirty of [false, true]) {
  test(`profile refresh preserves fresh untouched fields and explicit edits (${dirty})`, async ({
    page,
    api,
  }) => {
    await page.goto("/profile");
    await expect(page.getByLabel("Street address")).toHaveValue(
      "123 Example Avenue",
    );
    if (dirty)
      await page.getByLabel("Street address").fill("300 My Edited Street");
    const profile = {
      id: "admin",
      email: "smoke@example.test",
      firstName: "Smoke",
      lastName: "Admin",
      address: "200 New Street",
      city: "Portland",
      state: "OR",
      zipCode: "97201",
      country: "US",
      phone: "5035550100",
    };
    api.responses.set("GET /profile", { body: profile });
    const refresh = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/profile",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      window.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      window.dispatchEvent(new Event("visibilitychange"));
    });
    await refresh;
    await expect(page.getByLabel("Street address")).toHaveValue(
      dirty ? "300 My Edited Street" : profile.address,
    );
    if (dirty)
      await expect(
        page.getByText(/Saved street address: 200 New Street/),
      ).toBeVisible();
    await page.getByLabel("Phone").fill("5035550101");
    const saved = {
      ...profile,
      shippingAddress: dirty ? "300 My Edited Street" : profile.address,
      phone: "5035550101",
    };
    api.responses.set("POST /profile/admin", { body: saved });
    const write = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/profile/admin"),
    );
    await page.getByRole("button", { name: "Save profile" }).click();
    expect((await write).postDataJSON()).toMatchObject({
      shippingAddress: saved.shippingAddress,
      phone: saved.phone,
    });
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await page.keyboard.press("Escape");
    await checkLayout(page);
  });
}
