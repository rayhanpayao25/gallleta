import { phDateString, phTimestamp } from "@/lib/datetime";
import { normalizeMenuAddons } from "@/lib/menu";
import type {
  CostingIngredient,
  CostingItem,
  MenuItem,
  OrderItem,
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

export function namesMatch(a: string, b: string) {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function stockLedgerForDate(input: {
  itemName: string;
  liveStock: number;
  date: string;
  restocks: { itemName: string; quantityAdded: number; date: string }[];
  usages: { itemName: string; usedAmount: number; date: string }[];
}): { opening: number; restocked: number; used: number; remaining: number } {
  return stockLedgerForRange({ ...input, from: input.date, to: input.date });
}

export function stockLedgerForRange(input: {
  itemName: string;
  liveStock: number;
  from: string;
  to: string;
  restocks: { itemName: string; quantityAdded: number; date: string }[];
  usages: { itemName: string; usedAmount: number; date: string }[];
}): { opening: number; restocked: number; used: number; remaining: number } {
  const from = input.from <= input.to ? input.from : input.to;
  const to = input.from <= input.to ? input.to : input.from;
  const afterEnd = (value: string) => phDateString(value) > to;
  const inRange = (value: string) => {
    const day = phDateString(value);
    return day >= from && day <= to;
  };

  const sumRestocks = (
    rows: { itemName: string; quantityAdded: number; date: string }[],
    matchesDate: (value: string) => boolean,
  ) =>
    roundQty(
      rows
        .filter((row) => namesMatch(row.itemName, input.itemName) && matchesDate(row.date))
        .reduce((sum, row) => sum + (Number(row.quantityAdded) || 0), 0),
    );

  const sumUsages = (
    rows: { itemName: string; usedAmount: number; date: string }[],
    matchesDate: (value: string) => boolean,
  ) =>
    roundQty(
      rows
        .filter((row) => namesMatch(row.itemName, input.itemName) && matchesDate(row.date))
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

export const CUP_SKUS = [
  { id: "cups-peta", name: "Peta Cup" },
  { id: "cups-daba", name: "Daba Cup" },
  { id: "cups-hot", name: "Hot Cup" },
] as const;

export function cupSkuForItem(item: { id?: string; name: string }) {
  const id = item.id ?? "";
  const name = item.name.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  for (const sku of CUP_SKUS) {
    if (id === sku.id) return sku;
    const stem = sku.name.replace(/ cup$/i, "").toLowerCase();
    if (
      name === stem ||
      name === `${stem} cup` ||
      name === `${stem} cups` ||
      name === `cups ${stem}` ||
      name === `cups - ${stem}`
    ) {
      return sku;
    }
  }
  return null;
}

function addonIngredientsForOrderLine(
  store: Partial<Pick<StoreData, "menu" | "inventory">>,
  line: OrderItem,
): RecipeIngredient[] {
  const menuItem = (store.menu ?? []).find((item) => item.id === line.productId);
  const catalog = new Map(normalizeMenuAddons(menuItem).map((addon) => [addon.id, addon]));
  const inventory = store.inventory ?? [];

  return (line.addons ?? []).flatMap((selected) => {
    const spec = catalog.get(String(selected.id ?? ""));
    const inventoryItemId = String(spec?.inventoryItemId || selected.inventoryItemId || "").trim();
    const usageAmount = Number(spec?.usageAmount ?? selected.usageAmount) || 0;
    const qty = Math.max(1, Number(selected.qty) || 1);
    const amount = usageAmount * qty;
    if (amount <= 0) return [];

    const stock =
      inventory.find((item) => item.id === inventoryItemId) ??
      inventory.find((item) => namesMatch(item.name, spec?.name || selected.name));
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
  const selectedCostingCupId = line.style === "hot" ? costing?.hotCupInventoryItemId : line.style === "iced" ? costing?.icedCupInventoryItemId : costing?.otherCupInventoryItemId;
  const configuredCup = selectedCostingCupId ? inventory.find((item) => item.id === selectedCostingCupId) : undefined;
  const canonicalCupSku = line.style === "hot" ? "cups-hot" : line.style === "iced" ? "cups-peta" : "";
  const selectedCup = canonicalCupSku
    ? inventory.find((item) => cupSkuForItem(item)?.id === canonicalCupSku) ?? configuredCup
    : configuredCup;
  const resolvedRecipe = recipe.filter((ingredient) => Number(ingredient.amount) > 0).map((ingredient) => {
    if (!selectedCup || !cupSkuForItem({ id: ingredient.inventoryItemId, name: ingredient.name })) return ingredient;
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