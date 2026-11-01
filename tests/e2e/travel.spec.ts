import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Travel & Stay journeys. The flights provider mode comes from the running server (the runner
 * exports HEALTH_TOKEN), so the same spec asserts the honest deep-link fallback under
 * FLIGHTS_PROVIDER=deep-link and live mock results (timestamp + allowlisted hand-off) under mock.
 *
 * Signed-in themed travel UI and flight search live in guest-guide.spec.ts (NODE_ENV=test server).
 */
const ALLOWLIST =
  /^https:\/\/www\.google\.com\/travel\/|^https:\/\/(?:[a-z0-9-]+\.)*(?:skyscanner\.[a-z.]+|kayak\.com|booking\.com|hyatt\.com|chicagoathletichotel\.com|duffel\.com)\//;

async function flightsMode(request: APIRequestContext): Promise<string> {
  if (!process.env.HEALTH_TOKEN) return "unknown";
  const res = await request.get("/api/health", {
    headers: { authorization: `Bearer ${process.env.HEALTH_TOKEN}` },
  });
  const body = await res.json();
  return body.providers?.flights ?? "unknown";
}

const THEMES = ["botanical-deco", "gilded-hour", "conservatory"] as const;

test.describe("Travel & Stay", () => {
  for (const theme of THEMES) {
    test(`legacy /travel redirects anonymous visitors to sign-in (${theme})`, async ({ page }) => {
      await page.goto(`/travel?theme=${theme}`);
      await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Ftravel/);
    });
  }

  test("capability route answers search_travel_options anonymously with the ladder applied", async ({
    request,
  }) => {
    const mode = await flightsMode(request);
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
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.handoffs[0].url).toMatch(ALLOWLIST);
    if (mode === "mock") {
      expect(body.data.mode).toBe("sample");
      expect(body.data.mode).not.toBe("live");
      expect(body.data.notice).toMatch(/not connected yet/i);
      expect(body.retrievedAt).toBe(body.data.snapshot.retrievedAt);
      expect(body.data.snapshot.refreshBeforeBooking).toBe(true);
    } else if (mode === "deep-link") {
      expect(body.data.mode).toBe("deep-link");
      expect(body.data.snapshot).toBeUndefined();
      expect(body.data.notice).toMatch(/not available/);
    }
    const bad = await request.post("/api/capabilities/search_travel_options", {
      data: {
        input: { kind: "flights", origin: "ORD", departDate: "2027-07-15" },
      },
    });
    expect(bad.status()).toBe(422);
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
