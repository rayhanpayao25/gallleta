import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";

// --- approved local test credentials (see task) ---------------------------
export const ADMIN_URL = "/mouna1233";
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "coffeezz";
export const CASHIER_URL = "/sale1803";
export const CASHIER_USERNAME = "cashier";
export const CASHIER_PASSWORD = "coffeezz";

// --- unique test-data naming (shared/live Supabase project) --------------
// Every row this suite writes uses this prefix so it's trivially
// identifiable and never collides with real data or another run.
export function e2eId(label: string): string {
  return `e2e-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
export const E2E_NAME_PREFIX = "E2E ";

// --- direct Supabase client for DB-safe verification/cleanup -------------
function loadEnv(): Record<string, string> {
  const readFile = (name: string): Record<string, string> => {
    const envPath = path.join(process.cwd(), name);
    if (!fs.existsSync(envPath)) return {};
    return Object.fromEntries(
      fs
        .readFileSync(envPath, "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  };
  // The app itself reads .env.local; .env is kept as a fallback for
  // environments that use it instead.
  return { ...readFile(".env"), ...readFile(".env.local") };
}

let cachedEnv: Record<string, string> | null = null;
export function supabaseTestClient() {
  if (!cachedEnv) cachedEnv = loadEnv();
  return createClient(cachedEnv.SUPABASE_URL, cachedEnv.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// --- shared navigation helpers ---------------------------------------------
export async function loginAsAdmin(page: Page) {
  await page.goto(ADMIN_URL, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="username"]', ADMIN_USERNAME);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button:has-text("Enter Galleta Coffee")');
  await page.waitForURL("**/admin", { timeout: 15000 });
  await page.waitForSelector("text=Sales analysis", { timeout: 15000 });
}

export async function loginAsCashier(page: Page) {
  await page.goto(CASHIER_URL, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="username"]', CASHIER_USERNAME);
  await page.fill('input[name="password"]', CASHIER_PASSWORD);
  await page.click('button:has-text("Enter Galleta Coffee")');
  await page.waitForURL("**/pos", { timeout: 15000 });
}

/** Opens the admin hamburger menu and clicks a top-level nav item by its visible label. */
export async function openAdminPanel(page: Page, label: string) {
  await page.click('[aria-label="Open menu"]');
  await page.waitForSelector("aside nav button", { timeout: 10000 });
  await page.click(`aside nav button:has-text("${label}")`);
  await page.waitForTimeout(400);
}

const ADMIN_PANEL_VALUES: Record<string, string> = {
  Sales: "sales",
  Menu: "menu",
  Inventory: "transactions",
  Staff: "staff",
};

/**
 * Re-enters an admin panel after a reload without going through the
 * animated slide-out hamburger menu again - that animation is intermittently
 * still mid-transition immediately after page.reload() (before hydration
 * settles), which made re-clicking it flaky. AdminShell/SalePurchaseTransactions
 * persist the active panel/tab to localStorage themselves, so setting the
 * same keys directly and reloading lands on the right screen deterministically.
 */
export async function reloadIntoAdminPanel(page: Page, label: keyof typeof ADMIN_PANEL_VALUES, subTab?: string) {
  const panelValue = ADMIN_PANEL_VALUES[label];
  await page.evaluate(
    ({ panelValue, section, subTab }) => {
      window.localStorage.setItem("admin_activePanel", panelValue);
      window.localStorage.setItem("admin_section", section);
      if (subTab) window.localStorage.setItem("inventory-active-tab", subTab);
    },
    { panelValue, section: label === "Staff" ? "staff" : "admin", subTab },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
}

/** Opens the POS hamburger menu (same aria-label pattern as admin). */
export async function openPosMenu(page: Page) {
  await page.click('[aria-label="Open menu"]');
  await page.waitForTimeout(300);
}

export async function pollUntil<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 15000,
  intervalMs = 500,
): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
