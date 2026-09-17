import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId, pollUntil } from "../e2e/utils";

// Cross-instance cache freshness regression. The app process keeps a
// short-lived in-memory copy of the store (STORE_CACHE_TTL_MS in
// src/lib/store.ts) - before that TTL existed it was returned forever, so a
// row committed by another server instance never appeared until restart.
// This spec treats the running app as one instance and a second Supabase
// client as another instance's write path: an externally committed row must
// stay invisible while the cache is warm and become visible once the TTL
// expires, with no app restart.

test("externally-inserted menu item is cached inside the TTL, then visible without restart", async ({ request }) => {
  const supabase = supabaseTestClient();
  const category = (await supabase.from("menu_categories").select("id").limit(1).single()).data!;
  const id = e2eId("menu");
  const name = `E2E Freshness ${id}`;

  // Warm the app process's in-memory store before the row exists.
  const warm = await request.get("/drinks");
  expect(warm.ok()).toBeTruthy();

  await supabase.from("menu_items").insert({
    id,
    name,
    price: 1,
    category_id: category.id,
    available: true,
  });

  try {
    // Still inside the TTL window: serving the cached snapshot is expected.
    const stillCached = await request.get("/drinks");
    expect(
      await stillCached.text(),
      "inside the TTL the app may serve its cached snapshot",
    ).not.toContain(name);

    // Past the TTL the next read must re-hit Supabase.
    const becameVisible = await pollUntil(async () => {
      const res = await request.get("/drinks");
      return res.ok() && (await res.text()).includes(name) ? true : null;
    }, 25_000, 1_000);
    expect(
      becameVisible,
      "externally-written menu item becomes visible after the TTL expires",
    ).toBe(true);
  } finally {
    await supabase.from("menu_items").delete().eq("id", id);
  }
});
