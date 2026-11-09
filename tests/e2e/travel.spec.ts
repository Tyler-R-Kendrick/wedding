import { test, expect } from "@playwright/test";

/**
 * Travel & Stay, as a signed-out visitor on the production build: the page, the trip and the
 * travel capabilities are all behind sign-in, and each one refuses without saying anything about
 * the wedding.
 *
 * Signed-in themed travel UI, flight search and the capability's own answer (the provider ladder,
 * allowlisted hand-offs) live in guest-guide.spec.ts (NODE_ENV=test server).
 */

const THEMES = ["botanical-deco", "gilded-hour", "conservatory"] as const;

test.describe("Travel & Stay", () => {
  for (const theme of THEMES) {
    test(`legacy /travel redirects anonymous visitors to sign-in (${theme})`, async ({ page }) => {
      // The old address is a permanent redirect; the page it leads to asks for a session.
      const moved = await page.request.get(`/travel?theme=${theme}`, { maxRedirects: 0 });
      expect(moved.status()).toBe(308);
      expect(moved.headers().location).toMatch(/\/guests\/travel(?:\?|$)/);
      await page.goto(`/travel?theme=${theme}`);
      await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Ftravel/);
      // Nothing of the page was rendered on the way: no hotel, no block, no address.
      await expect(page.locator("body")).not.toContainText(/Chicago Athletic|Michigan Ave|room block|Group rate/i);
    });

    test(`/guests/travel sends anonymous visitors to sign-in (${theme})`, async ({ page }) => {
      await page.goto(`/guests/travel?theme=${theme}`);
      await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Ftravel/);
      await expect(page.locator("body")).not.toContainText(/Chicago Athletic|Michigan Ave|room block|Group rate/i);
    });
  }

  test("capability route refuses an anonymous search_travel_options call before reading it", async ({
    request,
  }) => {
    // Travel search is the invited guests': a signed-out caller is refused, with nothing about
    // flights, hotels or the venue in the answer. A guest's search, with the ladder applied, is
    // asserted in guest-guide.spec.ts on the test server, where a session exists.
    const res = await request.post("/api/capabilities/search_travel_options", {
      data: {
        input: {
          kind: "flights",
          origin: "LAX",
          departDate: "2027-07-15",
          adults: 2,
        },
      },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unauthenticated");
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/handoffs|skyscanner|Chicago Athletic|Michigan Ave/i);
    // The refusal comes before the input is read: a request that would be invalid for a guest
    // (the origin is the destination) gets the same answer, not a validation message.
    const bad = await request.post("/api/capabilities/search_travel_options", {
      data: {
        input: { kind: "flights", origin: "ORD", departDate: "2027-07-15" },
      },
    });
    expect(bad.status()).toBe(401);
    expect((await bad.json()).error.code).toBe("unauthenticated");
    // The hotel list carries the room block's rate, dates and booking link: guests only.
    const hotels = await request.post("/api/capabilities/list_hotel_recommendations", { data: { input: {} } });
    expect(hotels.status()).toBe(401);
    const hotelsBody = await hotels.json();
    expect(hotelsBody.error.code).toBe("unauthenticated");
    expect(JSON.stringify(hotelsBody)).not.toMatch(/block|rate|Chicago Athletic|Michigan Ave/i);
  });

  test("guest and admin surfaces gate anonymous visitors, and the webhook answers uniformly", async ({
    page,
    request,
  }) => {
    await page.goto("/trip");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Your trip",
    );
    await expect(
      page.getByText(/with the email on your invitation to see and plan your trip/),
    ).toBeVisible();
    await expect(
      page.locator("#main").getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/sign-in?next=%2Ftrip");
    await page.goto("/admin/travel");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Administrator sign-in required",
    );
    await expect(page.locator("#main")).toContainText(
      "is part of the admin console",
    );
    await expect(page.locator("#main")).not.toContainText("room block");
    const hook = await request.post("/travel/webhooks/duffel", {
      data: { id: "evt", type: "order.created", data: { object: { id: "o" } } },
    });
    expect([401, 404]).toContain(hook.status());
    expect(await hook.text()).toBe('{"ok":false}');
  });
});
