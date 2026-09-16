import { createClient } from "@supabase/supabase-js";
import type {
  CostingItem,
  InventoryItem,
  LoginActivity,
  MenuItem,
  Order,
  Promotion,
  RecipeIngredient,
  Role,
  StaffUser,
  StoreData,
} from "@/lib/types";
import { CUP_SKUS, cupSkuForItem } from "@/lib/inventory";
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
  const key = env(
    "SUPABASE_SECRET_KEY",
    "commume_coffee_SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "commume_coffee_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY_2",
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

function seedOrders(): Order[] {
  const items = [
    { productId: "spanish-latte", name: "Spanish Latte", price: 149 },
    { productId: "seasalt-cream", name: "Sea Salt Cream", price: 159 },
    { productId: "matcha-umami", name: "Matcha Umami", price: 169 },
    { productId: "cookie-crumble", name: "Cookie Crumble", price: 159 },
    { productId: "biscoff-latte", name: "Biscoff Latte", price: 169 },
    { productId: "caramel-macchiato", name: "Caramel Macchiato", price: 159 },
    { productId: "strawberry-crumble", name: "Strawberry Crumble", price: 159 },
    { productId: "panini", name: "Panini", price: 189 },
  ];

  const orders: Order[] = [];
  const now = new Date("2026-09-07T16:00:00+07:00");

  for (let dayOffset = 6; dayOffset >= 0; dayOffset -= 1) {
    const count = 4 + ((6 - dayOffset) % 3);
    for (let i = 0; i < count; i += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - dayOffset);
      date.setHours(11 + i, 10 + i * 7, 0, 0);
      const picked = items[(i + dayOffset) % items.length];
      const extra = items[(i + dayOffset + 2) % items.length];
      const qty = 1 + (i % 2);
      const lineItems = [
        {
          productId: picked.productId,
          name: picked.name,
          qty,
          price: picked.price,
        },
      ];
      if (i % 2 === 0) {
        lineItems.push({
          productId: extra.productId,
          name: extra.name,
          qty: 1,
          price: extra.price,
        });
      }
      const total = lineItems.reduce(
        (sum, item) => sum + item.price * item.qty,
        0,
      );
      orders.push({
        id: `ord-${dayOffset}-${i}`,
        createdAt: date.toISOString(),
        baristaName: "Sale In Charge",
        items: lineItems,
        total: Number(total.toFixed(2)),
        paymentMethod: (["cash", "gcash", "maya"] as const)[i % 3],
      });
    }
  }

  return orders;
}

const DEFAULT_INVENTORY: InventoryItem[] = [
  { id: "coffee-beans", name: "Coffee Beans", category: "Ingredients", unit: "grams", cost: 650, stock: 1000, maxStock: 5000 },
  { id: "milk", name: "Milk", category: "Dairy", unit: "ml", cost: 95, stock: 5000, maxStock: 10000 },
  { id: "sugar", name: "Sugar", category: "Ingredients", unit: "grams", cost: 80, stock: 1000, maxStock: 5000 },
  { id: "cups-peta", name: "Peta Cup", category: "Packaging", unit: "pcs", cost: 3, stock: 200, maxStock: 1000 },
  { id: "cups-daba", name: "Daba Cup", category: "Packaging", unit: "pcs", cost: 3, stock: 200, maxStock: 1000 },
  { id: "cups-hot", name: "Hot Cup", category: "Packaging", unit: "pcs", cost: 3, stock: 200, maxStock: 1000 },
  { id: "matcha-powder", name: "Matcha Powder", category: "Ingredients", unit: "grams", cost: 450, stock: 500, maxStock: 1000 },
];

const DEFAULT_COSTINGS: CostingItem[] = [
  { id: "cost-coffee-beans", productName: "Coffee Beans", ingredients: [{ name: "Coffee Beans", amount: 1000, unit: "grams", outputCups: 55 }] },
  { id: "cost-milk", productName: "Milk", ingredients: [{ name: "Milk", amount: 1000, unit: "ml", outputCups: 75 }] },
  { id: "cost-sugar", productName: "Sugar", ingredients: [{ name: "Sugar", amount: 1000, unit: "grams", outputCups: 100 }] },
  { id: "cost-matcha", productName: "Matcha Powder", ingredients: [{ name: "Matcha Powder", amount: 150, unit: "grams", outputCups: 15 }] },
];

const DEFAULT_RECIPES: Record<string, RecipeIngredient[]> = {};

function emptyStore(): StoreData {
  return {
    pos: { isOpen: false, openedAt: null, openedBy: null },
    orders: seedOrders(),
    printJobs: [],
    menu: DEFAULT_MENU.map((item) => ({ ...item })),
    categories: [...MENU_CATEGORIES],
    promotions: DEFAULT_PROMOS.map((item) => ({ ...item })),
    users: DEFAULT_USERS.map((item) => ({ ...item })),
    inventory: DEFAULT_INVENTORY.map((item) => ({ ...item })),
  recipes: structuredClone(DEFAULT_RECIPES),
  recipeCostings: [],
  usageLogs: [],
    restocks: [],
    costings: structuredClone(DEFAULT_COSTINGS),
    loginActivity: [],
    offRequests: [],
    voidRequests: [],
    loginGates: { ...DEFAULT_LOGIN_GATES },
  };
}

function isGenericCups(item: InventoryItem) {
  return item.id === "cups" || /^cups?$/i.test(item.name.trim());
}

function cupTemplate(sku: (typeof CUP_SKUS)[number]): InventoryItem {
  return {
    id: sku.id,
    name: sku.name,
    category: "Packaging",
    unit: "pcs",
    cost: 3,
    stock: 200,
    maxStock: 1000,
  };
}

function ensureCupTypes(inventory: InventoryItem[]): InventoryItem[] {
  const generic = inventory.find(isGenericCups);
  const next = inventory
    .filter((item) => !isGenericCups(item))
    .map((item) => {
      const sku = cupSkuForItem(item);
      return sku && item.name !== sku.name ? { ...item, name: sku.name } : item;
    });
  const leftover = generic?.stock ?? 0;
  const missing = CUP_SKUS.filter((sku) => !next.some((item) => cupSkuForItem(item)?.id === sku.id));
  const share = missing.length > 0 ? Math.floor(leftover / missing.length) : 0;
  let remainder = leftover - share * missing.length;

  for (const sku of CUP_SKUS) {
    if (next.some((item) => cupSkuForItem(item)?.id === sku.id)) continue;
    next.push({
      ...cupTemplate(sku),
      stock: share + (remainder > 0 ? 1 : 0),
      maxStock: generic?.maxStock || 1000,
      cost: generic?.cost || 3,
    });
    if (remainder > 0) remainder -= 1;
  }
  return next;
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
    store.inventory = DEFAULT_INVENTORY.map((item) => ({ ...item }));
  } else {
    store.inventory = store.inventory.map((item) => ({
      ...item,
      stock: Number(item.stock) || 0,
      maxStock: Number(item.maxStock) || 0,
      cost: Number(item.cost) || 0,
      unit: item.unit || "pcs",
    }));
    store.inventory = ensureCupTypes(store.inventory);
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

  const matchaInventory = store.inventory.find((item) => /matcha/i.test(item.name));
  const hasMatchaCosting = store.costings.some((costing) =>
    costing.ingredients.some((ingredient) => /matcha/i.test(ingredient.name)),
  );
  if (matchaInventory && !hasMatchaCosting) {
    store.costings.push({
      id: "cost-matcha-powder",
      productName: "Matcha Powder",
      ingredients: [{ name: matchaInventory.name, amount: 150, unit: "grams", outputCups: 15 }],
    });
  }

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
  const [pos, users, categories, menu, promotions, inventory, orders, orderItems, usageLogs, restocks, costings, costingIngredients, recipes] = await Promise.all([
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
  ]);
  const firstError = [pos, users, categories, menu, promotions, inventory, orders, orderItems, usageLogs, restocks, costings, costingIngredients, recipes].find((result) => result.error)?.error;
  if (firstError) throw new Error(`Unable to read store data: ${firstError.message}`);

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
    inventory: (inventory.data ?? []).map((row) => ({ id: row.id, name: row.name, category: row.category, unit: row.unit, cost: Number(row.cost), stock: Number(row.stock), maxStock: Number(row.max_stock) })),
    orders: rows.map((row) => ({ id: row.id, createdAt: row.created_at, baristaName: row.barista_name, items: items.filter((item) => item.order_id === row.id).map((item) => ({ productId: item.product_id_snapshot, name: item.name_snapshot, qty: item.qty, price: item.price_snapshot })), subtotal: row.subtotal, discount: row.discount, promoLabel: row.promo_label ?? undefined, total: row.total, paymentMethod: parsePayment(row.payment_method), ticketNo: row.ticket_no, paid: row.paid, change: row.change, voided: row.voided, voidReason: row.void_reason ?? undefined })),
    usageLogs: (usageLogs.data ?? []).map((row) => ({ id: row.id, orderId: row.order_id ?? "", orderItemId: row.order_item_id ?? "", date: row.created_at, itemName: row.item_name_snapshot, usedAmount: Number(row.used_amount), unit: row.unit })),
    restocks: (restocks.data ?? []).map((row) => ({ id: row.id, itemName: row.item_name_snapshot, quantityAdded: Number(row.quantity_added), date: row.created_at })),
    costings: (costings.data ?? []).map((row) => ({ id: row.id, productName: row.product_name, ingredients: (costingIngredients.data ?? []).filter((ingredient) => ingredient.costing_id === row.id).map((ingredient) => ({ name: ingredient.name, amount: Number(ingredient.amount), unit: ingredient.unit, outputCups: ingredient.output_cups })) })),
    recipes: Object.fromEntries((recipes.data ?? []).reduce((entries, row) => { const list = entries.get(row.menu_item_id) ?? []; list.push({ inventoryItemId: row.inventory_item_id, name: "", amount: Number(row.amount), unit: row.unit }); entries.set(row.menu_item_id, list); return entries; }, new Map<string, RecipeIngredient[]>())),
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
    supabase.from("inventory_items").upsert(store.inventory.map((item) => ({ id: item.id, name: item.name, category: item.category, unit: item.unit, cost: item.cost, stock: item.stock, max_stock: item.maxStock })), { onConflict: "id" }),
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

export async function recordAuthActivity(entry: {
  userId: string;
  username: string;
  name: string;
  role: Role;
  type: LoginActivity["type"];
}) {
  if (entry.role === "admin") return;

  await updateStore((store) => {
    if (!Array.isArray(store.loginActivity)) {
      store.loginActivity = [];
    }
    store.loginActivity.unshift({
      id: `auth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      userId: entry.userId,
      username: entry.username,
      name: entry.name,
      role: entry.role,
      type: entry.type,
      at: new Date().toISOString(),
    });
    if (store.loginActivity.length > 300) {
      store.loginActivity.length = 300;
    }
  });
}