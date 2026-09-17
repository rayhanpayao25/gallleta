import { createClient } from "@supabase/supabase-js";
import type {
  CostingItem,
  LoginActivity,
  MenuItem,
  OffRequest,
  Order,
  PrintJob,
  Promotion,
  RecipeCosting,
  RecipeIngredient,
  Role,
  StaffUser,
  StoreData,
} from "@/lib/types";
import { roundQty } from "@/lib/inventory";
import { DEFAULT_MENU, MENU_CATEGORIES, normalizeMenuAddons, normalizeMenuStyles } from "@/lib/menu";
import { parsePayment } from "@/lib/payments";
import { DEFAULT_LOGIN_GATES, normalizeLoginGates } from "@/lib/staff-gates";
import { DEFAULT_PROMOS } from "@/lib/promos";
import { DEFAULT_USERS, parseRole } from "@/lib/users";

const POS_STATE_ID = "commune-coffee";

let queue: Promise<unknown> = Promise.resolve();
let memoryStore: StoreData | null = null;


function env(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function supabaseAdmin() {
  const url = env( 
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "commume_coffee_SUPABASE_URL",
    "NEXT_PUBLIC_commume_coffee_SUPABASE_URL",
  );
  // Prefer the current service-role key. The older secret-key aliases may contain
  // a stale JWT whose `iat` is ahead of the runtime clock, causing every query to fail.
  const key = env(
    "SUPABASE_SERVICE_ROLE_KEY",
    "commume_coffee_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY_2",
    "SUPABASE_SECRET_KEY",
    "commume_coffee_SUPABASE_SECRET_KEY",
  );

  if (!url || !key) {
    throw new Error(
      "Supabase credentials are missing. Add the real SUPABASE_URL and SUPABASE_SECRET_KEY to .env.local, then restart Next.js.",
    );
  }

  if (!/^https:\/\/[^/]+\.supabase\.co$/.test(url)) {
    throw new Error("SUPABASE_URL must be the full https://<project-ref>.supabase.co URL.");
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const DEFAULT_RECIPES: Record<string, RecipeIngredient[]> = {};

function emptyStore(): StoreData {
  return {
    pos: { isOpen: false, openedAt: null, openedBy: null },
    orders: [],
    printJobs: [],
    menu: DEFAULT_MENU.map((item) => ({ ...item })),
    categories: [...MENU_CATEGORIES],
    promotions: DEFAULT_PROMOS.map((item) => ({ ...item })),
    users: DEFAULT_USERS.map((item) => ({ ...item })),
    inventory: [],
  recipes: structuredClone(DEFAULT_RECIPES),
  recipeCostings: [],
  usageLogs: [],
    restocks: [],
    costings: [],
    loginActivity: [],
    offRequests: [],
    voidRequests: [],
    loginGates: { ...DEFAULT_LOGIN_GATES },
  };
}


function uniqueCategories(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const name = value.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function normalizeStore(store: StoreData): StoreData {
  const categoryByProduct = new Map(
    (Array.isArray(store.menu) ? store.menu : []).map((item) => [
      item.id,
      item.category,
    ]),
  );
  if (!Array.isArray(store.orders)) {
    store.orders = [];
  } else {
    store.orders = store.orders
      .filter(
        (order): order is Order =>
          Boolean(order && typeof order === "object" && typeof order.id === "string"),
      )
      .map((order: Order) => ({
        ...order,
        items: Array.isArray(order.items)
          ? order.items.filter((item) => item && typeof item === "object")
          : [],
        paymentMethod: parsePayment(order.paymentMethod),
        voided: Boolean(order.voided),
        voidReason: typeof order.voidReason === "string" ? order.voidReason : "",
      }))
      .map((order: Order) => ({
        ...order,
        items: order.items.map((item) => ({
          ...item,
          category: item.category ?? categoryByProduct.get(item.productId),
        })),
      }));
  }
  if (!Array.isArray(store.printJobs)) {
    store.printJobs = [];
  } else {
    store.printJobs = store.printJobs.filter(
      (job) =>
        job &&
        typeof job.id === "string" &&
        typeof job.orderId === "string" &&
        (job.type === "cup-label" || job.type === "customer-receipt"),
    );
  }
  if (!Array.isArray(store.menu) || store.menu.length === 0) {
    store.menu = DEFAULT_MENU.map((item) => ({ ...item }));
  } else {
    store.menu = store.menu
      .filter(
        (item): item is MenuItem =>
          Boolean(item && typeof item === "object" && typeof item.id === "string"),
      )
      .map((item: MenuItem) => ({
        ...item,
        available: item.available !== false,
        image: item.image || "/images/drinks.jpg",
        styles: normalizeMenuStyles(item),
        addons: normalizeMenuAddons(item),
      }));
    if (store.menu.length === 0) {
      store.menu = DEFAULT_MENU.map((item) => ({ ...item }));
    }
  }
  store.categories = uniqueCategories([
    ...(Array.isArray(store.categories) ? store.categories : []),
    ...store.menu.map((item) => item.category),
  ]);
  if (store.categories.length === 0) {
    store.categories = [...MENU_CATEGORIES];
  }
  if (!Array.isArray(store.promotions) || store.promotions.length === 0) {
    store.promotions = DEFAULT_PROMOS.map((item) => ({ ...item }));
  } else {
    store.promotions = store.promotions.map((item: Promotion) => ({
      ...item,
      active: item.active !== false,
      type: item.type === "amount" ? "amount" : "percent",
      value: Number(item.value) || 0,
    }));
  }
  if (!Array.isArray(store.inventory)) {
    store.inventory = [];
  } else {
    store.inventory = store.inventory.map((item) => ({
      ...item,
      stock: Number(item.stock) || 0,
      maxStock: Number(item.maxStock) || 0,
      cost: Number(item.cost) || 0,
      unit: item.unit || "pcs",
    }));

  }
  if (!Array.isArray(store.recipeCostings)) {
    store.recipeCostings = [];
  } else {
    store.recipeCostings = store.recipeCostings
      .filter((costing) => costing && typeof costing.name === "string" && Array.isArray(costing.menuItems) && Array.isArray(costing.ingredients))
      .map((costing, index) => ({
        ...costing,
        id: typeof costing.id === "string" && costing.id ? costing.id : `recipe-costing-${index}`,
      }));
  }
  if (!store.recipes || typeof store.recipes !== "object") {
    store.recipes = structuredClone(DEFAULT_RECIPES);
  } else {
    const menuIds = new Set(store.menu.map((item) => item.id));
    const isLegacyDefaultRecipe = (ingredients: RecipeIngredient[]) => {
      const legacyIds = new Set(["coffee-beans", "milk", "sugar", "cups-peta", "cups-daba", "cups-hot", "matcha-powder"]);
      return ingredients.length > 0 && ingredients.every((ingredient) => legacyIds.has(ingredient.inventoryItemId));
    };
    store.recipes = Object.fromEntries(
      Object.entries(store.recipes)
        .filter(([recipeKey, ingredients]) => !menuIds.has(recipeKey) && !(Array.isArray(ingredients) && isLegacyDefaultRecipe(ingredients)))
        .map(([recipeName, ingredients]) => [
          recipeName,
          Array.isArray(ingredients)
            ? ingredients.map((ingredient) =>
                ingredient.inventoryItemId === "milk" && Number(ingredient.amount) >= 100
                  ? { ...ingredient, amount: 13.33, unit: "ml" }
                  : ingredient,
              )
            : [],
        ]),
    );
  }
  if (!Array.isArray(store.usageLogs)) {
    store.usageLogs = [];
  } else {
    const configuredRecipeKeys = new Set(Object.keys(store.recipes));
    const menuNameById = new Map(store.menu.map((item) => [item.id, item.name]));
    store.usageLogs = store.usageLogs
      .filter((usage) => {
        if (!usage.orderId || !usage.orderItemId) return true;
        const recipeName = menuNameById.get(usage.orderItemId);
        return configuredRecipeKeys.has(usage.orderItemId) || (recipeName ? configuredRecipeKeys.has(recipeName) : false);
      })
      .map((usage) =>
        /milk/i.test(usage.itemName) && Number(usage.usedAmount) >= 100
          ? { ...usage, usedAmount: Number((Number(usage.usedAmount) / 10).toFixed(2)), unit: "ml" }
          : usage,
      );
  }
  if (!Array.isArray(store.restocks)) {
    store.restocks = [];
  }
  if (!Array.isArray(store.costings)) {
    store.costings = [];
  } else {
    store.costings = store.costings.map((costing) =>
      /milk/i.test(costing.productName) && costing.ingredients.some((ingredient) => /milk/i.test(ingredient.name))
        ? {
            ...costing,
            ingredients: costing.ingredients.map((ingredient) =>
              /milk/i.test(ingredient.name) ? { ...ingredient, amount: 1000, unit: "ml", outputCups: 75 } : ingredient,
            ),
          }
        : costing,
    );
  }
  if (!Array.isArray(store.loginActivity)) {
    store.loginActivity = [];
  } else {
    store.loginActivity = store.loginActivity.filter(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.userId === "string" &&
        typeof entry.at === "string" &&
        (entry.type === "login" || entry.type === "logout"),
    );
  }
  if (!Array.isArray(store.offRequests)) {
    store.offRequests = [];
  }
  if (!Array.isArray(store.voidRequests)) {
    store.voidRequests = [];
  } else {
    store.voidRequests = store.voidRequests.filter(
      (request) =>
        request &&
        typeof request.id === "string" &&
        (request.status === "pending" ||
          request.status === "approved" ||
          request.status === "denied") &&
        Array.isArray(request.items),
    );
  }
  store.loginGates = normalizeLoginGates(store.loginGates);


  if (!Array.isArray(store.users) || store.users.length === 0) {
    store.users = DEFAULT_USERS.map((item) => ({ ...item }));
  } else {
    const normalizedUsers = store.users.map((item: StaffUser) => ({
      ...item,
      username: String(item.username ?? "").toLowerCase(),
      name: item.name || item.username,
      title: item.title || (item.role === "admin" ? "Owner" : item.role === "manager" ? "Manager" : item.role === "cashier" ? "Cashier" : "Barista"),
      role: parseRole(String(item.title ?? item.role ?? "barista")),
      password: String(item.password ?? ""),
    }));

    store.users = Array.from(
      new Map(normalizedUsers.map((user) => [user.id, user])).values(),
    );
    if (!store.users.some((user) => user.role === "manager" && user.password)) {
      const managerUsernameTaken = store.users.some((user) => user.username === "manager");
      store.users.push({
        id: "manager-1",
        username: managerUsernameTaken ? `manager-${Date.now().toString(36)}` : "manager",
        password: "commune",
        name: "Manager",
        role: "manager",
        title: "Manager",
      });
    }
    if (!store.users.some((user) => user.role === "barista" && user.password)) {
      const baristaUsernameTaken = store.users.some((user) => user.username === "barista");
      store.users.push({
        id: "barista-1",
        username: baristaUsernameTaken ? `barista-${Date.now().toString(36)}` : "barista",
        password: "commune",
        name: "Barista",
        role: "barista",
        title: "Barista",
      });
    }
  }
  return store;
}

const MENU_PHOTO_BUCKET = "menu-photos";

export async function uploadPublicMenuPhoto(
  filename: string,
  bytes: Buffer,
  contentType: string,
) {
  const supabase = supabaseAdmin();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Unable to list storage buckets: ${listError.message}`);
  }

  if (!buckets?.some((bucket) => bucket.name === MENU_PHOTO_BUCKET)) {
    const { error } = await supabase.storage.createBucket(MENU_PHOTO_BUCKET, {
      public: true,
    });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Unable to create photo bucket: ${error.message}`);
    }
  }

  const { error } = await supabase.storage
    .from(MENU_PHOTO_BUCKET)
    .upload(filename, bytes, { contentType, upsert: false });
  if (error) {
    throw new Error(`Unable to upload photo: ${error.message}`);
  }

  const { data } = supabase.storage.from(MENU_PHOTO_BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

async function readStore(): Promise<StoreData> {
  if (memoryStore) return memoryStore;
  const supabase = supabaseAdmin();
  const [pos, users, categories, menu, promotions, inventory, orders, orderItems, usageLogs, restocks, costings, costingIngredients, recipes, recipeCostings, recipeCostingMenuItems, recipeCostingIngredients, loginActivity, offRequests] = await Promise.all([
    supabase.from("pos_state").select("*").eq("id", POS_STATE_ID).maybeSingle(),
    supabase.from("staff_users").select("*").order("created_at"),
    supabase.from("menu_categories").select("*").order("name"),
    supabase.from("menu_items").select("*").order("created_at"),
    supabase.from("promotions").select("*").order("created_at"),
    supabase.from("inventory_items").select("*").order("created_at"),
    supabase.from("orders").select("*").order("created_at", { ascending: false }),
    supabase.from("order_items").select("*").order("created_at"),
    supabase.from("usage_logs").select("*").order("created_at"),
    supabase.from("restocks").select("*").order("created_at"),
    supabase.from("costings").select("*").order("created_at"),
    supabase.from("costing_ingredients").select("*").order("created_at"),
    supabase.from("recipes").select("*").order("created_at"),
    supabase.from("recipe_costings").select("*").order("created_at"),
    supabase.from("recipe_costing_menu_items").select("*").order("created_at"),
    supabase.from("recipe_costing_ingredients").select("*").order("created_at"),
    supabase.from("login_activity").select("*").order("at"),
    supabase.from("off_requests").select("*").order("created_at"),
  ]);
  const firstError = [pos, users, categories, menu, promotions, inventory, orders, orderItems, usageLogs, restocks, costings, costingIngredients, recipes, recipeCostings, recipeCostingMenuItems, recipeCostingIngredients, loginActivity, offRequests].find((result) => result.error)?.error;
  if (firstError) {
    const message = firstError.message;
    if (/JWT issued at future/i.test(message)) {
      throw new Error(
        "Unable to read store data: Supabase rejected the configured server key because its JWT timestamp is in the future. Refresh SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY in the project Vars, confirm the key belongs to this Supabase project, then restart the preview.",
      );
    }
    throw new Error(`Unable to read store data: ${message}`);
  }

  const base = emptyStore();
  const rows = orders.data ?? [];
  const items = orderItems.data ?? [];
  const store = normalizeStore({
    ...base,
    pos: pos.data ? { isOpen: Boolean(pos.data.is_open), openedAt: pos.data.opened_at, openedBy: pos.data.opened_by_name ?? pos.data.opened_by } : base.pos,
    users: Array.from(
      new Map(
        (users.data ?? []).map((row) => [
          row.id,
          {
            id: row.id,
            username: row.username,
            password: row.password,
            name: row.name,
            role: parseRole(
              row.role === "admin" || /admin|owner/i.test(row.title ?? "")
                ? "admin"
                : row.username === "cashier" || /cashier|sale\s+in\s+charge/i.test(row.title ?? "")
                  ? "cashier"
                  : row.username === "manager" || /manager/i.test(row.title ?? "")
                    ? "manager"
                    : "barista",
            ),
            title: row.title,
          },
        ]),
      ).values(),
    ),
    categories: (categories.data ?? []).map((row) => row.name),
    menu: (menu.data ?? []).map((row) => ({ id: row.id, name: row.name, price: row.price, category: (categories.data ?? []).find((category) => category.id === row.category_id)?.name ?? "Other", image: row.image, available: row.available })),
    promotions: (promotions.data ?? []).map((row) => ({ id: row.id, label: row.label, type: row.type, value: row.value, active: row.active })),
    inventory: (inventory.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      cost: Number(row.cost),
      stock: Number(row.stock),
      maxStock: Number(row.max_stock),
      openingStock: row.opening_stock != null ? Number(row.opening_stock) : undefined,
      purchaseUnitSize: row.purchase_unit_size != null ? Number(row.purchase_unit_size) : undefined,
      cupUsageAmount: row.cup_usage_amount != null ? Number(row.cup_usage_amount) : undefined,
      cupsMake: row.cups_make != null ? Number(row.cups_make) : undefined,
    })),
    orders: rows.map((row) => ({ id: row.id, createdAt: row.created_at, baristaName: row.barista_name, items: items.filter((item) => item.order_id === row.id).map((item) => ({ productId: item.product_id_snapshot, name: item.name_snapshot, qty: item.qty, price: item.price_snapshot })), subtotal: row.subtotal, discount: row.discount, promoLabel: row.promo_label ?? undefined, total: row.total, paymentMethod: parsePayment(row.payment_method), ticketNo: row.ticket_no, paid: row.paid, change: row.change, voided: row.voided, voidReason: row.void_reason ?? undefined })),
    usageLogs: (usageLogs.data ?? []).map((row) => ({ id: row.id, orderId: row.order_id ?? "", orderItemId: row.order_item_id ?? "", date: row.created_at, itemName: row.item_name_snapshot, usedAmount: Number(row.used_amount), unit: row.unit })),
    restocks: (restocks.data ?? []).map((row) => ({ id: row.id, itemName: row.item_name_snapshot, quantityAdded: Number(row.quantity_added), date: row.created_at })),
    costings: (costings.data ?? []).map((row) => ({ id: row.id, productName: row.product_name, ingredients: (costingIngredients.data ?? []).filter((ingredient) => ingredient.costing_id === row.id).map((ingredient) => ({ name: ingredient.name, amount: Number(ingredient.amount), unit: ingredient.unit, outputCups: ingredient.output_cups })) })),
    recipes: Object.fromEntries((recipes.data ?? []).reduce((entries, row) => { const list = entries.get(row.menu_item_id) ?? []; list.push({ inventoryItemId: row.inventory_item_id, name: "", amount: Number(row.amount), unit: row.unit }); entries.set(row.menu_item_id, list); return entries; }, new Map<string, RecipeIngredient[]>())),
    // created_at ordering here preserves insertion order, which
    // ingredientsForOrderLine() relies on ([...recipeCostings].reverse().find(...)
    // picks the LAST-inserted matching costing on a tie).
    recipeCostings: (recipeCostings.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      menuItems: (recipeCostingMenuItems.data ?? [])
        .filter((item) => item.recipe_costing_id === row.id)
        .map((item) => item.menu_item_name),
      // A stored ingredient with no inventory_item_id but a name is exactly
      // the UI's "other" (custom, non-inventory-linked) ingredient case -
      // that's already fully determined by the existing columns, so no
      // separate discriminator is stored.
      ingredients: (recipeCostingIngredients.data ?? [])
        .filter((ingredient) => ingredient.recipe_costing_id === row.id)
        .map((ingredient) => ({
          inventoryItemId: ingredient.inventory_item_id ?? (ingredient.name ? "other" : ""),
          name: ingredient.name,
          amount: Number(ingredient.amount),
          unit: ingredient.unit,
        })),
      hotCupInventoryItemId: row.hot_cup_inventory_item_id ?? undefined,
      icedCupInventoryItemId: row.iced_cup_inventory_item_id ?? undefined,
      otherCupInventoryItemId: row.other_cup_inventory_item_id ?? undefined,
    })),
    // Explicit `at` ordering above (not relying on unspecified row order);
    // pairLoginSessions()/openBaristaShifts() re-sort chronologically anyway.
    // user_id falls back to the row's own id (never to "") when a staff
    // account was deleted (ON DELETE SET NULL) - a shared "" key would
    // incorrectly group different deleted staff members' punches together
    // in pairLoginSessions()'s per-userId grouping. username/name/role stay
    // as the snapshot values already on the row either way.
    loginActivity: (loginActivity.data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id ?? row.id,
      username: row.username,
      name: row.name,
      role: row.role,
      type: row.type,
      at: row.at,
    })),
    // created_at ordering (not relying on unspecified row order); the UI
    // re-sorts by date/createdAt in JS regardless. Same user_id fallback
    // rationale as loginActivity above.
    offRequests: (offRequests.data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id ?? row.id,
      name: row.name,
      date: row.date,
      reason: row.reason,
      status: row.status,
      createdAt: row.created_at,
    })),
  });
  memoryStore = store;
  return store;
}

async function writeStore(store: StoreData): Promise<void> {
  if (Array.isArray(store.printJobs) && store.printJobs.length > 300) store.printJobs = store.printJobs.slice(-300);
  const supabase = supabaseAdmin();
  const categoryRows = Array.from(
    new Map(
      store.categories
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => [name.toLowerCase(), name] as const),
    ).values(),
  ).map((name) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "other",
    name,
  }));
  const { data: existingCategories, error: categoryReadError } = await supabase
    .from("menu_categories")
    .select("id, name");

  if (categoryReadError) {
    throw new Error(`Unable to read menu categories: ${categoryReadError.message}`);
  }

  const existingCategoryIds = new Map(
    (existingCategories ?? []).map((row) => [row.name.trim().toLowerCase(), row.id]),
  );
  const categoryId = new Map(
    categoryRows.map((row) => [
      row.name.toLowerCase(),
      existingCategoryIds.get(row.name.toLowerCase()) ?? row.id,
    ]),
  );
  const categoriesToWrite = categoryRows
    .filter((row) => !existingCategoryIds.has(row.name.toLowerCase()))
    .map((row) => ({
      ...row,
      id: categoryId.get(row.name.toLowerCase()) ?? row.id,
    }));
  const uniqueUsers = Array.from(
    new Map(
      store.users.map((user) => [
        user.username.trim().toLowerCase(),
        { ...user, username: user.username.trim().toLowerCase() },
      ]),
    ).values(),
  );
  const { data: existingUsers, error: userReadError } = await supabase
    .from("staff_users")
    .select("id, username")
    .order("id");

  if (userReadError) {
    throw new Error(`Unable to read staff users: ${userReadError.message}`);
  }

  const retainedUserIds = new Set(uniqueUsers.map((user) => user.id));
  const duplicateUserIds = Array.from(
    new Map<string, string[]>()
      .entries(),
  );
  for (const row of existingUsers ?? []) {
    const username = String(row.username ?? "").trim().toLowerCase();
    const ids = duplicateUserIds.find(([key]) => key === username)?.[1];
    if (ids) ids.push(row.id);
    else duplicateUserIds.push([username, [row.id]]);
  }
  const staleDuplicateIds = duplicateUserIds.flatMap(([, ids]) => {
    const retainedId = ids.find((id) => retainedUserIds.has(id)) ?? ids[0];
    return ids.filter((id) => id !== retainedId);
  });
  if (staleDuplicateIds.length > 0) {
    const { error: duplicateDeleteError } = await supabase
      .from("staff_users")
      .delete()
      .in("id", staleDuplicateIds);
    if (duplicateDeleteError) {
      throw new Error(`Unable to remove duplicate staff users: ${duplicateDeleteError.message}`);
    }
  }

  const orderRows = store.orders.map((order) => ({
    id: order.id,
    created_at: order.createdAt,
    barista_name: order.baristaName,
    subtotal: order.subtotal ?? order.total,
    discount: order.discount ?? 0,
    promo_label: order.promoLabel ?? null,
    total: order.total,
    payment_method: order.paymentMethod ?? "cash",
    ticket_no: order.ticketNo ?? "",
    paid: order.paid ?? order.total,
    change: order.change ?? 0,
    voided: order.voided ?? false,
    void_reason: order.voidReason ?? null,
  }));

  // Admin-side removal only changes the current application view.
  // Never delete orders from Supabase during a normal store save.
  // Permanent deletion must be performed explicitly against the database
  // (see the targeted delete*/ *Atomic helpers below).

  const { error: ordersError } = await supabase
    .from("orders")
    .upsert(orderRows, { onConflict: "id" });

  if (ordersError) {
    throw new Error(`Unable to save orders: ${ordersError.message}`);
  }

  const operations = await Promise.all([
    supabase.from("pos_state").upsert({ id: POS_STATE_ID, is_open: store.pos.isOpen, opened_at: store.pos.openedAt, opened_by_name: store.pos.openedBy, updated_at: new Date().toISOString() }),
    supabase.from("staff_users").upsert(
      uniqueUsers.map((user) => ({
        id: user.id,
        username: user.username,
        password: user.password,
        name: user.name,
        role: user.role === "admin" ? "admin" : "barista",
        title: user.title,
      })),
      { onConflict: "id" },
    ),
    supabase.from("menu_categories").insert(categoriesToWrite),
    supabase.from("menu_items").upsert(store.menu.map((item) => ({ id: item.id, name: item.name, price: Math.round(item.price), category_id: categoryId.get(item.category.toLowerCase()) ?? "other", image: item.image, available: item.available })), { onConflict: "id" }),
    supabase.from("promotions").upsert(store.promotions.map((promo) => ({ id: promo.id, label: promo.label, type: promo.type, value: Math.round(promo.value), active: promo.active })), { onConflict: "id" }),
    supabase.from("inventory_items").upsert(store.inventory.map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      cost: item.cost,
      stock: item.stock,
      max_stock: item.maxStock,
      opening_stock: item.openingStock ?? null,
      purchase_unit_size: item.purchaseUnitSize ?? null,
      cup_usage_amount: item.cupUsageAmount ?? null,
      cups_make: item.cupsMake ?? null,
    })), { onConflict: "id" }),
    supabase.from("order_items").upsert(store.orders.flatMap((order) => order.items.map((item, index) => ({ id: `${order.id}-item-${index + 1}`, order_id: order.id, menu_item_id: item.productId, product_id_snapshot: item.productId, name_snapshot: item.name, qty: item.qty, price_snapshot: item.price }))), { onConflict: "id" }),
    supabase.from("usage_logs").upsert(store.usageLogs.map((log) => ({ id: log.id, order_id: log.orderId || null, order_item_id: log.orderItemId || null, item_name_snapshot: log.itemName, used_amount: log.usedAmount, unit: log.unit })), { onConflict: "id" }),
    supabase.from("restocks").upsert(store.restocks.map((record) => ({ id: record.id, item_name_snapshot: record.itemName, quantity_added: record.quantityAdded })), { onConflict: "id" }),
  ]);
  const error = operations.find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to save store data: ${error.message}`);
  memoryStore = store;
}

function withStore<T>(fn: (store: StoreData) => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => {
    const store = await readStore();
    return fn(store);
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getStore(): Promise<StoreData> {
  return withStore((store) => store);
}

export function updateStore(
  fn: (store: StoreData) => void,
): Promise<StoreData> {
  return withStore(async (store) => {
    fn(store);
    await writeStore(store);
    return store;
  });
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Targeted delete helpers -------------------------------------------------
//
// writeStore() only ever upserts/inserts, so "filter the array, then call
// writeStore()" can never remove a row from Supabase - the row survives and
// reappears on the next cold read. These helpers issue the actual DELETE
// and update memoryStore in place so a deleted row can't be re-upserted by
// another in-flight updateStore() call for the rest of this process's
// lifetime. Each one runs through the same `queue` as withStore(), so it
// can't race a concurrent read-modify-write.
//
// The FK behavior noted in each comment below was verified empirically
// against the live Supabase schema (insert a disposable referencing row,
// attempt the delete, observe the result, clean up) since no migration
// file exists in this repo to read it from.

export async function deleteOrderRecord(id: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    // order_items.order_id and usage_logs.order_id are both
    // ON DELETE CASCADE, so deleting the order row alone removes its
    // children too, atomically, in one statement.
    const { error } = await supabase.from("orders").delete().eq("id", id);
    if (error) throw new Error(`Unable to delete order: ${error.message}`);
    if (memoryStore) {
      memoryStore.orders = memoryStore.orders.filter((order) => order.id !== id);
      memoryStore.usageLogs = memoryStore.usageLogs.filter((entry) => entry.orderId !== id);
      // printJobs has no backing table at all (never read from or written
      // to Supabase); keep the existing in-memory-only cleanup for it.
      memoryStore.printJobs = memoryStore.printJobs.filter((job) => job.orderId !== id);
    }
  });
}

export async function deleteRestockRecord(id: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("restocks").delete().eq("id", id);
    if (error) throw new Error(`Unable to delete restock: ${error.message}`);
    if (memoryStore) {
      memoryStore.restocks = memoryStore.restocks.filter((record) => record.id !== id);
    }
  });
}

// Phase 8: atomic multi-table operations -----------------------------------
//
// Each of these calls a single Postgres function (see
// supabase/migrations/20260917061450_atomicity_hardening.sql) so the write
// either fully succeeds or fully rolls back - no manual TypeScript rollback,
// no partial order/inventory/usage-log state.
//
// Cache strategy: order creation patches memoryStore with the exact values
// that were just atomically committed (known with certainty, since the RPC
// is all-or-nothing) rather than invalidating, specifically so printJobs -
// which have no backing table and only ever live in memoryStore - survive
// long enough for the immediately-following print flow to use them. Void/
// delete/restock/rename are lower-frequency admin operations whose exact
// resulting state (e.g. how much inventory a void restores) isn't already
// known on the TypeScript side without an extra read, so those invalidate
// memoryStore instead of risking a hand-patched value drifting from what
// the transaction actually committed.

export async function appendPrintJobs(jobs: PrintJob[]): Promise<void> {
  if (jobs.length === 0) return;
  await enqueue(async () => {
    if (memoryStore) memoryStore.printJobs.push(...jobs);
  });
}

export async function createOrderAtomic(input: {
  order: Order;
  deductions: { inventoryItemId: string; itemName: string; amount: number; unit: string; orderItemId?: string }[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  return enqueue(async () => {
    const supabase = supabaseAdmin();
    const { order, deductions } = input;
    const { error } = await supabase.rpc("create_order_atomic", {
      p_order_id: order.id,
      p_created_at: order.createdAt,
      p_barista_name: order.baristaName,
      p_barista_user_id: null,
      p_items: order.items,
      p_subtotal: order.subtotal ?? order.total,
      p_discount: order.discount ?? 0,
      p_promo_id: null,
      p_promo_label: order.promoLabel ?? null,
      p_total: order.total,
      p_payment_method: order.paymentMethod ?? "cash",
      p_ticket_no: order.ticketNo ?? "",
      p_paid: order.paid ?? order.total,
      p_change: order.change ?? 0,
      p_deductions: deductions,
      p_voided: order.voided ?? false,
      p_void_reason: order.voidReason ?? null,
    });
    if (error) {
      const insufficient = /INSUFFICIENT_STOCK:(.+)/.exec(error.message);
      if (insufficient) return { ok: false, error: `Not enough ${insufficient[1]} in stock.` };
      throw new Error(`Unable to create order: ${error.message}`);
    }
    if (memoryStore) {
      memoryStore.orders.push(order);
      for (const deduction of deductions) {
        const item = memoryStore.inventory.find((entry) => entry.id === deduction.inventoryItemId);
        if (item) item.stock = Math.max(0, roundQty(item.stock - deduction.amount));
      }
      const now = memoryStore.usageLogs.filter((entry) => entry.orderId !== order.id);
      for (const deduction of deductions) {
        now.push({
          id: `${order.id}-${deduction.inventoryItemId}-usage`,
          orderId: order.id,
          orderItemId: deduction.orderItemId ?? "",
          date: order.createdAt,
          itemName: deduction.itemName,
          usedAmount: deduction.amount,
          unit: deduction.unit,
        });
      }
      memoryStore.usageLogs = now;
    }
    return { ok: true };
  });
}

export async function voidOrderAtomic(
  orderId: string,
  reason: string,
  voidedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return enqueue(async () => {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.rpc("void_order_atomic", {
      p_order_id: orderId,
      p_reason: reason,
      p_voided_by: voidedBy,
    });
    if (error) throw new Error(`Unable to void order: ${error.message}`);
    if (!data?.ok) {
      return {
        ok: false,
        error: data?.error === "ALREADY_VOIDED" ? "Ticket is already voided." : "Ticket not found.",
      };
    }
    // printJobs has no backing table, so cancel matching pending/failed jobs
    // here (same behavior as the old markOrderVoided) before the
    // memoryStore invalidation below would otherwise silently drop it.
    if (memoryStore) {
      const updatedAt = new Date().toISOString();
      for (const job of memoryStore.printJobs) {
        if (job.orderId === orderId && (job.status === "pending" || job.status === "failed")) {
          job.status = "cancelled";
          job.updatedAt = updatedAt;
          job.lastError = "Order was voided.";
        }
      }
    }
    // Inventory restoration amounts are server-computed from usage_logs;
    // invalidate rather than recompute the same lookup a second time here.
    memoryStore = null;
    return { ok: true };
  });
}

export async function deleteOrderAtomic(orderId: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.rpc("delete_order_atomic", { p_order_id: orderId });
    if (error) throw new Error(`Unable to delete order: ${error.message}`);
    memoryStore = null;
  });
}

export async function createRestockAtomic(input: {
  id: string;
  inventoryItemId: string | null;
  itemNameSnapshot: string;
  quantityAdded: number;
  createdAt: string;
}): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.rpc("create_restock_atomic", {
      p_id: input.id,
      p_inventory_item_id: input.inventoryItemId,
      p_item_name_snapshot: input.itemNameSnapshot,
      p_quantity_added: input.quantityAdded,
      p_created_at: input.createdAt,
    });
    if (error) throw new Error(`Unable to create restock: ${error.message}`);
    memoryStore = null;
  });
}

export async function editRestockAtomic(input: {
  id: string;
  oldInventoryItemId: string | null;
  oldQuantity: number;
  newInventoryItemId: string | null;
  newItemNameSnapshot: string;
  newQuantity: number;
  newCreatedAt: string;
}): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.rpc("edit_restock_atomic", {
      p_id: input.id,
      p_old_inventory_item_id: input.oldInventoryItemId,
      p_old_quantity: input.oldQuantity,
      p_new_inventory_item_id: input.newInventoryItemId,
      p_new_item_name_snapshot: input.newItemNameSnapshot,
      p_new_quantity: input.newQuantity,
      p_new_created_at: input.newCreatedAt,
    });
    if (error) throw new Error(`Unable to edit restock: ${error.message}`);
    memoryStore = null;
  });
}

export async function deleteRestockAtomic(input: {
  id: string;
  inventoryItemId: string | null;
  quantityAdded: number;
}): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.rpc("delete_restock_atomic", {
      p_id: input.id,
      p_inventory_item_id: input.inventoryItemId,
      p_quantity_added: input.quantityAdded,
    });
    if (error) throw new Error(`Unable to delete restock: ${error.message}`);
    memoryStore = null;
  });
}

export async function renameMenuCategoryAtomic(
  fromName: string,
  toName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return enqueue(async () => {
    const supabase = supabaseAdmin();
    // Look up the category's actual row id rather than recomputing a slug
    // from its name: past renames (before this phase) could only ever
    // insert a new row, never update one in place, so an existing row's id
    // does not necessarily match what the naive name-to-slug algorithm
    // would produce today.
    const { data: existingRows, error: lookupError } = await supabase
      .from("menu_categories")
      .select("id, name");
    if (lookupError) throw new Error(`Unable to look up menu categories: ${lookupError.message}`);
    const fromRow = (existingRows ?? []).find(
      (row) => row.name.trim().toLowerCase() === fromName.trim().toLowerCase(),
    );
    if (!fromRow) {
      return { ok: false, error: "Category not found." };
    }
    const toSlug = toName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "other";

    const { data, error } = await supabase.rpc("rename_menu_category", {
      p_from_slug: fromRow.id,
      p_to_slug: toSlug,
      p_to_name: toName,
    });
    if (error) throw new Error(`Unable to rename category: ${error.message}`);
    if (!data?.ok) {
      return {
        ok: false,
        error: data?.error === "CATEGORY_EXISTS" ? "That category is already on the board." : "Category not found.",
      };
    }
    memoryStore = null;
    return { ok: true };
  });
}

export async function deleteInventoryItemRecord(
  id: string,
): Promise<{ error: string } | { ok: true }> {
  return enqueue(async () => {
    const supabase = supabaseAdmin();
    // recipes.inventory_item_id -> inventory_items.id is ON DELETE CASCADE
    // in the live schema, but we don't rely on that: guard explicitly so a
    // referenced item is never silently dropped out of a recipe.
    // recipe_costing_ingredients.inventory_item_id is ON DELETE SET NULL, so
    // the ingredient row itself would survive, but its inventory link (and
    // therefore its stock deduction on order) would silently disappear -
    // guard that too rather than let a recipe costing quietly degrade.
    // (costing_ingredients has no inventory_item_id column at all, so it
    // can't reference an inventory item.)
    const [legacyRecipeRefs, recipeCostingIngredientRefs] = await Promise.all([
      supabase.from("recipes").select("id").eq("inventory_item_id", id).limit(1),
      supabase.from("recipe_costing_ingredients").select("id").eq("inventory_item_id", id).limit(1),
    ]);
    if (legacyRecipeRefs.error) {
      throw new Error(`Unable to check inventory references: ${legacyRecipeRefs.error.message}`);
    }
    if (recipeCostingIngredientRefs.error) {
      throw new Error(`Unable to check inventory references: ${recipeCostingIngredientRefs.error.message}`);
    }
    if ((legacyRecipeRefs.data && legacyRecipeRefs.data.length > 0) || (recipeCostingIngredientRefs.data && recipeCostingIngredientRefs.data.length > 0)) {
      return { error: "This item is used in a recipe. Remove it from the recipe before deleting it." };
    }

    const { error } = await supabase.from("inventory_items").delete().eq("id", id);
    if (error) {
      if (/foreign key/i.test(error.message)) {
        return { error: "This item is still referenced elsewhere and cannot be deleted." };
      }
      throw new Error(`Unable to delete inventory item: ${error.message}`);
    }
    if (memoryStore) {
      memoryStore.inventory = memoryStore.inventory.filter((item) => item.id !== id);
    }
    return { ok: true };
  });
}

export async function deleteMenuItemRecord(id: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    // order_items.menu_item_id -> menu_items.id is ON DELETE SET NULL, and
    // order_items keeps its own name/price/qty snapshot columns, so past
    // orders stay intact once this menu item is gone.
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    if (error) throw new Error(`Unable to delete menu item: ${error.message}`);
    if (memoryStore) {
      memoryStore.menu = memoryStore.menu.filter((item) => item.id !== id);
    }
  });
}

export async function deleteMenuCategoryRecord(name: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    // menu_items.category_id -> menu_categories.id is ON DELETE RESTRICT.
    // The caller already checks for in-use categories before calling this;
    // this is a defensive backstop against a concurrent add.
    const { error } = await supabase.from("menu_categories").delete().ilike("name", name);
    if (error) throw new Error(`Unable to delete menu category: ${error.message}`);
    if (memoryStore) {
      memoryStore.categories = memoryStore.categories.filter(
        (entry) => entry.toLowerCase() !== name.toLowerCase(),
      );
    }
  });
}

export async function deleteStaffUserRecord(id: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    // orders.barista_user_id -> staff_users.id is ON DELETE SET NULL, and
    // orders keeps its own barista_name snapshot, so past orders stay
    // intact once this staff account is gone.
    const { error } = await supabase.from("staff_users").delete().eq("id", id);
    if (error) throw new Error(`Unable to delete staff user: ${error.message}`);
    if (memoryStore) {
      memoryStore.users = memoryStore.users.filter((user) => user.id !== id);
    }
  });
}

// costings / costing_ingredients ------------------------------------------
//
// costing_ingredients has no stable per-row id on the application side, so
// a save always replaces the full ingredient set for a costing. That can't
// be safely expressed as separate upsert/delete/insert REST calls (a
// failure between them would leave the costing half-updated), so it's a
// single Postgres function call (save_costing, see
// supabase/migrations/20260917034533_costing_persistence.sql) - one
// function invocation is one transaction, so any failure rolls back the
// parent upsert too.

export async function saveCostingRecord(costing: CostingItem): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.rpc("save_costing", {
      p_id: costing.id,
      p_product_name: costing.productName,
      p_ingredients: costing.ingredients,
    });
    if (error) throw new Error(`Unable to save costing: ${error.message}`);
    if (memoryStore) {
      const index = memoryStore.costings.findIndex((entry) => entry.id === costing.id);
      if (index >= 0) memoryStore.costings[index] = costing;
      else memoryStore.costings.push(costing);
    }
  });
}

export async function deleteCostingRecord(id: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    // costing_ingredients.costing_id -> costings.id is ON DELETE CASCADE
    // (verified against the live schema), so deleting the parent row alone
    // removes its ingredients too, atomically, in one statement.
    const { error } = await supabase.from("costings").delete().eq("id", id);
    if (error) throw new Error(`Unable to delete costing: ${error.message}`);
    if (memoryStore) {
      memoryStore.costings = memoryStore.costings.filter((entry) => entry.id !== id);
    }
  });
}

// recipe_costings / recipe_costing_menu_items / recipe_costing_ingredients -
//
// Same reasoning as costings above: a save always replaces the full
// menu-item and ingredient sets for a recipe costing, which isn't safe as
// separate upsert/delete/insert REST calls, so it's a single Postgres
// function call (save_recipe_costing, see
// supabase/migrations/20260917043324_recipe_costing_persistence.sql).

export async function saveRecipeCostingRecord(costing: RecipeCosting): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.rpc("save_recipe_costing", {
      p_id: costing.id,
      p_name: costing.name,
      p_hot_cup_inventory_item_id: costing.hotCupInventoryItemId ?? null,
      p_iced_cup_inventory_item_id: costing.icedCupInventoryItemId ?? null,
      p_other_cup_inventory_item_id: costing.otherCupInventoryItemId ?? null,
      p_menu_items: costing.menuItems,
      p_ingredients: costing.ingredients,
    });
    if (error) throw new Error(`Unable to save recipe costing: ${error.message}`);
    if (memoryStore) {
      const index = memoryStore.recipeCostings.findIndex((entry) => entry.id === costing.id);
      if (index >= 0) memoryStore.recipeCostings[index] = costing;
      else memoryStore.recipeCostings.push(costing);
    }
  });
}

export async function deleteRecipeCostingRecord(id: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    // recipe_costing_menu_items.recipe_costing_id and
    // recipe_costing_ingredients.recipe_costing_id are both
    // ON DELETE CASCADE on recipe_costings.id, so deleting the parent row
    // alone removes both children, atomically, in one statement.
    const { error } = await supabase.from("recipe_costings").delete().eq("id", id);
    if (error) throw new Error(`Unable to delete recipe costing: ${error.message}`);
    if (memoryStore) {
      memoryStore.recipeCostings = memoryStore.recipeCostings.filter((entry) => entry.id !== id);
    }
  });
}

// login_activity -----------------------------------------------------------
//
// Targeted insert/update/delete, not a blanket rewrite: appendPunch() (in
// actions/users.ts) still mutates the in-memory store.loginActivity array
// synchronously (inside the same updateStore() queue turn as its
// "already clocked in" check), so that race protection is unchanged; these
// helpers are how the resulting entry - or an edit/delete of an existing
// one - actually reaches Supabase.

export async function insertLoginActivityRecord(entry: LoginActivity): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("login_activity").insert({
      id: entry.id,
      user_id: entry.userId,
      username: entry.username,
      name: entry.name,
      role: entry.role,
      type: entry.type,
      at: entry.at,
    });
    if (error) throw new Error(`Unable to record login activity: ${error.message}`);
    if (memoryStore) {
      if (!Array.isArray(memoryStore.loginActivity)) memoryStore.loginActivity = [];
      // appendPunch() may have already pushed this same entry into
      // memoryStore synchronously before this call reaches its turn in the
      // queue; recordAuthActivity() has not, so guard against a duplicate.
      if (!memoryStore.loginActivity.some((item) => item.id === entry.id)) {
        memoryStore.loginActivity.unshift(entry);
      }
    }
  });
}

export async function updateLoginActivityTimeRecord(id: string, at: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("login_activity").update({ at }).eq("id", id);
    if (error) throw new Error(`Unable to update login activity: ${error.message}`);
    if (memoryStore) {
      const entry = memoryStore.loginActivity.find((item) => item.id === id);
      if (entry) entry.at = at;
    }
  });
}

export async function deleteLoginActivityRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("login_activity").delete().in("id", ids);
    if (error) throw new Error(`Unable to delete login activity: ${error.message}`);
    if (memoryStore) {
      const idSet = new Set(ids);
      memoryStore.loginActivity = memoryStore.loginActivity.filter((item) => !idSet.has(item.id));
    }
  });
}

// off_requests ---------------------------------------------------------------
//
// Targeted insert/update/delete, not a blanket rewrite - same reasoning as
// login_activity above.

export async function insertOffRequestRecord(entry: OffRequest): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("off_requests").insert({
      id: entry.id,
      user_id: entry.userId,
      name: entry.name,
      date: entry.date,
      reason: entry.reason,
      status: entry.status,
      created_at: entry.createdAt,
    });
    if (error) throw new Error(`Unable to create off request: ${error.message}`);
    if (memoryStore) {
      if (!Array.isArray(memoryStore.offRequests)) memoryStore.offRequests = [];
      if (!memoryStore.offRequests.some((item) => item.id === entry.id)) {
        memoryStore.offRequests.unshift(entry);
      }
    }
  });
}

export async function updateOffRequestStatusRecord(id: string, status: OffRequest["status"]): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("off_requests").update({ status }).eq("id", id);
    if (error) throw new Error(`Unable to update off request: ${error.message}`);
    if (memoryStore) {
      const entry = memoryStore.offRequests.find((item) => item.id === id);
      if (entry) entry.status = status;
    }
  });
}

export async function deleteOffRequestRecord(id: string): Promise<void> {
  await enqueue(async () => {
    const supabase = supabaseAdmin();
    const { error } = await supabase.from("off_requests").delete().eq("id", id);
    if (error) throw new Error(`Unable to delete off request: ${error.message}`);
    if (memoryStore) {
      memoryStore.offRequests = memoryStore.offRequests.filter((item) => item.id !== id);
    }
  });
}

export async function recordAuthActivity(entry: {
  userId: string;
  username: string;
  name: string;
  role: Role;
  type: LoginActivity["type"];
}) {
  if (entry.role === "admin") return;

  await insertLoginActivityRecord({
    id: `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    userId: entry.userId,
    username: entry.username,
    name: entry.name,
    role: entry.role,
    type: entry.type,
    at: new Date().toISOString(),
  });
}