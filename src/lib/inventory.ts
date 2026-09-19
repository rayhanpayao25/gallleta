import { phDateString, phTimestamp } from "@/lib/datetime";
import { hydrateOrderLine, normalizeMenuAddons } from "@/lib/menu";
import type {
  CostingIngredient,
  CostingItem,
  DrinkStyle,
  InventoryItem,
  MenuItem,
  OrderItem,
  RecipeCosting,
  RecipeIngredient,
  StoreData,
} from "@/lib/types";

export function roundQty(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function formatQty(value: number): string {
  const rounded = roundQty(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function itemKey(name: string) {
  return name.trim().toLowerCase();
}

// Inventory identity is exact-after-normalization only. Substring
// containment leaked usage/restock/costing aggregates between similarly
// named items (e.g. "Milk" vs "Milk Automation - Stock"), so identity
// matching must never use fuzzy containment (KAN-125).
export function itemNameEquals(a: string, b: string) {
  const left = a.trim().toLowerCase().normalize("NFKC").replace(/\s+/g, " ");
  const right = b.trim().toLowerCase().normalize("NFKC").replace(/\s+/g, " ");
  return Boolean(left && left === right);
}

// Ledger rows carry inventory_item_id; legacy rows may not. When the caller
// knows the item's id, the id decides and only id-less rows fall back to an
// exact normalized-name comparison.
export function matchesInventoryRow(
  row: { itemName: string; inventoryItemId?: string },
  item: { name: string; inventoryItemId?: string },
) {
  if (item.inventoryItemId && row.inventoryItemId) {
    return row.inventoryItemId === item.inventoryItemId;
  }
  return itemNameEquals(row.itemName, item.name);
}

export function stockLedgerForDate(input: {
  itemName: string;
  inventoryItemId?: string;
  liveStock: number;
  date: string;
  restocks: { itemName: string; quantityAdded: number; date: string; inventoryItemId?: string }[];
  usages: { itemName: string; usedAmount: number; date: string; inventoryItemId?: string }[];
}): { opening: number; restocked: number; used: number; remaining: number } {
  return stockLedgerForRange({ ...input, from: input.date, to: input.date });
}

export function stockLedgerForRange(input: {
  itemName: string;
  inventoryItemId?: string;
  liveStock: number;
  from: string;
  to: string;
  restocks: { itemName: string; quantityAdded: number; date: string; inventoryItemId?: string }[];
  usages: { itemName: string; usedAmount: number; date: string; inventoryItemId?: string }[];
}): { opening: number; restocked: number; used: number; remaining: number } {
  const from = input.from <= input.to ? input.from : input.to;
  const to = input.from <= input.to ? input.to : input.from;
  const afterEnd = (value: string) => phDateString(value) > to;
  const inRange = (value: string) => {
    const day = phDateString(value);
    return day >= from && day <= to;
  };

  const item = { name: input.itemName, inventoryItemId: input.inventoryItemId };
  const sumRestocks = (
    rows: { itemName: string; quantityAdded: number; date: string; inventoryItemId?: string }[],
    matchesDate: (value: string) => boolean,
  ) =>
    roundQty(
      rows
        .filter((row) => matchesInventoryRow(row, item) && matchesDate(row.date))
        .reduce((sum, row) => sum + (Number(row.quantityAdded) || 0), 0),
    );

  const sumUsages = (
    rows: { itemName: string; usedAmount: number; date: string; inventoryItemId?: string }[],
    matchesDate: (value: string) => boolean,
  ) =>
    roundQty(
      rows
        .filter((row) => matchesInventoryRow(row, item) && matchesDate(row.date))
        .reduce((sum, row) => sum + (Number(row.usedAmount) || 0), 0),
    );

  const restocked = sumRestocks(input.restocks, inRange);
  const used = sumUsages(input.usages, inRange);
  const remaining = roundQty(
    Math.max(0, input.liveStock - sumRestocks(input.restocks, afterEnd) + sumUsages(input.usages, afterEnd)),
  );
  const opening = roundQty(remaining - restocked + used);
  return { opening, restocked, used, remaining };
}

export function remainingForUsages(
  usages: { date: string; itemName: string; usedAmount: number }[],
  restocks: { date: string; itemName: string; quantityAdded: number }[],
  inventory: { name: string; stock: number }[],
): number[] {
  const stock = new Map<string, number>();
  for (const item of inventory) {
    stock.set(itemKey(item.name), item.stock);
  }

  type LedgerEvent =
    | { kind: "usage"; at: string; key: string; qty: number; index: number }
    | { kind: "restock"; at: string; key: string; qty: number; index: number };

  const events: LedgerEvent[] = [];
  usages.forEach((usage, index) => {
    events.push({
      kind: "usage",
      at: usage.date,
      key: itemKey(usage.itemName),
      qty: usage.usedAmount,
      index,
    });
  });
  restocks.forEach((restock, index) => {
    events.push({
      kind: "restock",
      at: restock.date,
      key: itemKey(restock.itemName),
      qty: restock.quantityAdded,
      index: usages.length + index,
    });
  });

  events.sort((a, b) => phTimestamp(b.at) - phTimestamp(a.at) || b.index - a.index);

  const remaining = usages.map(() => 0);
  for (const event of events) {
    const current = stock.get(event.key) ?? 0;
    if (event.kind === "usage") {
      remaining[event.index] = roundQty(Math.max(0, current));
      stock.set(event.key, current + event.qty);
    } else {
      stock.set(event.key, Math.max(0, current - event.qty));
    }
  }
  return remaining;
}

export function perCupAmount(ing: Pick<CostingIngredient, "amount" | "outputCups">): number {
  const amount = Number(ing.amount) || 0;
  const cups = Number(ing.outputCups) || 0;
  if (amount <= 0) return 0;
  if (cups > 0) return amount / cups;
  return amount;
}

export function cupsFromQuantity(
  quantity: number,
  ing: Pick<CostingIngredient, "amount" | "outputCups">,
): number {
  const perCup = perCupAmount(ing);
  if (perCup <= 0) return 0;
  return quantity / perCup;
}

function comparableItemName(value: string) {
  return value.trim().toLowerCase().replace(/(.)\1+/g, "$1");
}

export function findCostingForItem(costings: CostingItem[], name: string): CostingItem | undefined {
  const needle = comparableItemName(name);
  if (!needle) return undefined;
  return costings.find((costing) => {
    if (costing.productName.toLowerCase() === needle) return true;
    return costing.ingredients.some((ing) => {
      const ingName = comparableItemName(ing.name);
      return ingName === needle || ingName.includes(needle) || needle.includes(ingName);
    });
  });
}

export function costingIngredientForItem(
  costings: CostingItem[],
  name: string,
): CostingIngredient | undefined {
  const costing = findCostingForItem(costings, name);
  if (!costing) return undefined;
  const needle = comparableItemName(name);
  return (
    costing.ingredients.find((ing) => comparableItemName(ing.name) === needle) ??
    costing.ingredients[0]
  );
}

type CupAssignment = Pick<
  RecipeCosting,
  "hotCupInventoryItemId" | "icedCupInventoryItemId" | "otherCupInventoryItemId"
>;

export function configuredCupIds(costings: CupAssignment[] | undefined) {
  const ids = new Set<string>();
  for (const costing of costings ?? []) {
    for (const value of [costing.hotCupInventoryItemId, costing.icedCupInventoryItemId, costing.otherCupInventoryItemId]) {
      const id = String(value ?? "").trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

export function looksLikeCupItem(
  item: { id?: string; name: string },
  costings?: CupAssignment[],
) {
  if (configuredCupIds(costings).has(String(item.id ?? "").trim())) return true;
  return /\bcups?\b/i.test(String(item.name ?? "").trim());
}

export function cupForOrderLine(
  inventory: InventoryItem[],
  costing: CupAssignment | undefined,
  style?: DrinkStyle,
) {
  const selectedId =
    style === "hot"
      ? costing?.hotCupInventoryItemId
      : style === "iced"
        ? costing?.icedCupInventoryItemId
        : costing?.otherCupInventoryItemId;
  const id = String(selectedId ?? "").trim();
  if (!id) return undefined;
  return inventory.find((item) => item.id === id);
}

function addonIngredientsForOrderLine(
  store: Partial<Pick<StoreData, "menu" | "inventory">>,
  line: OrderItem,
): RecipeIngredient[] {
  line = hydrateOrderLine(line);
  const menuItem = (store.menu ?? []).find((item) => item.id === line.productId);
  const catalog = new Map(normalizeMenuAddons(menuItem).map((addon) => [addon.id, addon]));
  const inventory = store.inventory ?? [];

  return (line.addons ?? []).flatMap((selected) => {
    const spec =
      catalog.get(String(selected.id ?? "")) ??
      [...catalog.values()].find((addon) => itemNameEquals(addon.name, selected.name));
    const inventoryItemId = String(spec?.inventoryItemId || selected.inventoryItemId || "").trim();
    const usageAmount = Number(spec?.usageAmount ?? selected.usageAmount) || 0;
    const qty = Math.max(1, Number(selected.qty) || 1);
    const amount = usageAmount * qty;
    if (amount <= 0) return [];

    const stock =
      inventory.find((item) => item.id === inventoryItemId) ??
      inventory.find((item) => itemNameEquals(item.name, spec?.name || selected.name));
    if (!stock) return [];

    return [
      {
        inventoryItemId: stock.id,
        name: stock.name,
        amount,
        unit: (spec?.usageUnit || selected.usageUnit || stock.unit || "").trim() || stock.unit,
      },
    ];
  });
}

export function ingredientsForOrderLine(
  store: Partial<Pick<StoreData, "menu" | "recipes" | "recipeCostings" | "inventory">>,
  line: OrderItem,
): RecipeIngredient[] {
  line = hydrateOrderLine(line);
  const menuItem = (store.menu ?? []).find((item) => item.id === line.productId);
  const names = [line.name, menuItem?.name].filter((value): value is string => Boolean(value));
  const normalizeDrink = (value: string) => value
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[·–—-]?\s*(hot|iced)\s*$/i, "")
    .replace(/\s*\((hot|iced)\)\s*$/i, "")
    .replace(/\s+/g, " ");
  const normalizedNames = new Set(names.map(normalizeDrink));
  const matchesDrink = (drink: string) => {
    const normalizedDrink = normalizeDrink(drink);
    return drink === line.productId || normalizedNames.has(normalizedDrink);
  };
  const recipeCostings = store.recipeCostings ?? [];
  const costing = [...recipeCostings].reverse().find((entry) => entry.menuItems.some(matchesDrink));

  // When costings exist, they are the only source of truth. Never fall back to a stale recipe.
  const recipe = recipeCostings.length > 0
    ? costing?.ingredients ?? []
    : (store.recipes ?? {})[line.productId] ?? Object.entries(store.recipes ?? {}).find(([recipeKey]) => matchesDrink(recipeKey))?.[1] ?? [];

  const inventory = store.inventory ?? [];
  const selectedCup = cupForOrderLine(inventory, costing, line.style);
  const cupIds = configuredCupIds(store.recipeCostings);
  const isCupIngredient = (ingredient: RecipeIngredient) => {
    if (cupIds.has(ingredient.inventoryItemId)) return true;
    const stock =
      inventory.find((item) => item.id === ingredient.inventoryItemId) ??
      inventory.find((item) => itemNameEquals(item.name, ingredient.name));
    return stock
      ? looksLikeCupItem(stock, store.recipeCostings)
      : looksLikeCupItem({ name: ingredient.name }, store.recipeCostings);
  };
  const resolvedRecipe = recipe.filter((ingredient) => Number(ingredient.amount) > 0).map((ingredient) => {
    if (!selectedCup || !isCupIngredient(ingredient)) return ingredient;
    return { ...ingredient, inventoryItemId: selectedCup.id, name: selectedCup.name, unit: selectedCup.unit };
  });
  const hasConfiguredCup = resolvedRecipe.some((ingredient) => ingredient.inventoryItemId === selectedCup?.id);
  const cupIngredient = selectedCup && !hasConfiguredCup
    ? [{ inventoryItemId: selectedCup.id, name: selectedCup.name, amount: 1, unit: selectedCup.unit }]
    : [];

  return [
    ...resolvedRecipe,
    ...cupIngredient,
    ...addonIngredientsForOrderLine(store, line),
  ];
}

export function recipeForMenuPreview(store: StoreData, item: MenuItem): RecipeIngredient[] {
  return ingredientsForOrderLine(store, {
    productId: item.id,
    name: item.name,
    qty: 1,
    price: item.price,
  });
}