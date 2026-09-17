import { DEFAULT_MENU } from "../src/lib/menu";
import {
  cupsFromQuantity,
  ingredientsForOrderLine,
  perCupAmount,
  remainingForUsages,
  roundQty,
  stockLedgerForDate,
} from "../src/lib/inventory";
import type { InventoryItem, StoreData } from "../src/lib/types";

const costings = [
  { id: "cost-coffee-beans", productName: "Coffee Beans", ingredients: [{ name: "Coffee Beans", amount: 1000, unit: "grams", outputCups: 55 }] },
  { id: "cost-milk", productName: "Milk", ingredients: [{ name: "Milk", amount: 1000, unit: "ml", outputCups: 7.5 }] },
  { id: "cost-sugar", productName: "Sugar", ingredients: [{ name: "Sugar", amount: 1000, unit: "grams", outputCups: 100 }] },
  { id: "cost-matcha", productName: "Matcha Powder", ingredients: [{ name: "Matcha Powder", amount: 150, unit: "grams", outputCups: 15 }] },
];

const inventory: InventoryItem[] = [
  { id: "coffee-beans", name: "Coffee Beans", unit: "grams", cost: 650, stock: 1000, maxStock: 5000 },
  { id: "milk", name: "Milk", unit: "ml", cost: 95, stock: 5000, maxStock: 10000 },
  { id: "sugar", name: "Sugar", unit: "grams", cost: 80, stock: 1000, maxStock: 5000 },
  { id: "cups-peta", name: "Peta Cup", unit: "pcs", cost: 3, stock: 200, maxStock: 1000 },
  { id: "cups-daba", name: "Daba Cup", unit: "pcs", cost: 3, stock: 200, maxStock: 1000 },
  { id: "cups-hot", name: "Hot Cup", unit: "pcs", cost: 3, stock: 200, maxStock: 1000 },
  { id: "matcha-powder", name: "Matcha Powder", unit: "grams", cost: 450, stock: 500, maxStock: 1000 },
];

const store = {
  menu: DEFAULT_MENU,
  inventory,
  costings,
  recipes: {},
} as StoreData;

let failed = 0;
function assert(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  pass  ${label}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

function almostEqual(a: number, b: number, digits = 2) {
  return roundQty(a) === roundQty(Number(b.toFixed(digits)));
}

function usedMap(productId: string, qty: number) {
  const line = { productId, name: "", qty, price: 0 };
  const ingredients = ingredientsForOrderLine(store, line);
  return Object.fromEntries(ingredients.map((ing) => [ing.name, roundQty(ing.amount * qty)]));
}

function deduct(stock: Record<string, number>, used: Record<string, number>) {
  const next = { ...stock };
  for (const [name, amount] of Object.entries(used)) {
    next[name] = roundQty((next[name] ?? 0) - amount);
  }
  return next;
}

console.log("1. Costing yields");
const beans = costings[0].ingredients[0];
const milk = costings[1].ingredients[0];
const sugar = costings[2].ingredients[0];
const matcha = costings[3].ingredients[0];
assert("beans per cup = 1000/55", almostEqual(perCupAmount(beans), 1000 / 55));
assert("milk per cup = 1000/7.5", almostEqual(perCupAmount(milk), 1000 / 7.5));
assert("sugar per cup = 10g", almostEqual(perCupAmount(sugar), 10));
assert("matcha per cup = 10g", almostEqual(perCupAmount(matcha), 10));
assert("1kg beans → 55 cups", almostEqual(cupsFromQuantity(1000, beans), 55));
assert("150g matcha → 15 cups", almostEqual(cupsFromQuantity(150, matcha), 15));
assert("1kg sugar → 100 cups", almostEqual(cupsFromQuantity(1000, sugar), 100));
assert("1L milk → 7.5 cups", almostEqual(cupsFromQuantity(1000, milk), 7.5));

console.log("\n2. POS recipes by category");
const latte = usedMap("latte", 1);
assert("latte uses beans", latte["Coffee Beans"] === roundQty(1000 / 55));
assert("latte uses milk", latte["Milk"] === roundQty(1000 / 7.5));
assert("latte uses sugar", latte["Sugar"] === 10);
assert("latte uses 1 hot cup", latte["Hot Cup"] === 1);
assert("latte does not use matcha", latte["Matcha Powder"] == null);

const americano = usedMap("americano-long-black", 1);
assert("americano uses beans+milk+sugar+hot cup", Boolean(americano["Coffee Beans"] && americano["Milk"] && americano["Sugar"] && americano["Hot Cup"]));

const matchaLatte = usedMap("matcha-latte", 1);
assert("matcha uses 10g powder", matchaLatte["Matcha Powder"] === 10);
assert("matcha uses 10g sugar", matchaLatte["Sugar"] === 10);
assert("matcha uses 1 peta cup", matchaLatte["Peta Cup"] === 1);
assert("matcha does not use coffee beans", matchaLatte["Coffee Beans"] == null);

const hojicha = usedMap("hojicha-latte", 1);
assert("hojicha treated as matcha drink", hojicha["Matcha Powder"] === 10 && hojicha["Coffee Beans"] == null);

const strawberry = usedMap("strawberry-creme", 1);
assert("non-coffee uses milk+sugar+peta", strawberry["Milk"] === roundQty(1000 / 7.5) && strawberry["Sugar"] === 10 && strawberry["Peta Cup"] === 1);
assert("non-coffee does not use beans", strawberry["Coffee Beans"] == null);

const fresh = usedMap("watermelon-whisper", 1);
assert("fresh drink uses milk+sugar+daba", Boolean(fresh["Milk"] && fresh["Sugar"] && fresh["Daba Cup"]));

const fries = usedMap("fries", 1);
assert("food uses no drink ingredients", Object.keys(fries).length === 0);
const cookie = usedMap("choco-chip-cookie", 1);
assert("pastry uses no drink ingredients", Object.keys(cookie).length === 0);

console.log("\n3. Qty scaling and mixed cart");
const fiveLattes = usedMap("latte", 5);
assert("5 lattes = 5× beans", almostEqual(fiveLattes["Coffee Beans"], (1000 / 55) * 5));
assert("5 lattes = 5× milk", almostEqual(fiveLattes["Milk"], (1000 / 7.5) * 5));
assert("5 lattes = 50g sugar", fiveLattes["Sugar"] === 50);
assert("5 lattes = 5 hot cups", fiveLattes["Hot Cup"] === 5);

const opening = {
  "Coffee Beans": 1000,
  Milk: 5000,
  Sugar: 1000,
  "Peta Cup": 200,
  "Daba Cup": 200,
  "Hot Cup": 200,
  "Matcha Powder": 500,
};
const after = deduct(deduct(opening, usedMap("latte", 2)), usedMap("matcha-latte", 1));
const expectedBeans = roundQty(1000 - (1000 / 55) * 2);
const expectedMilk = roundQty(5000 - (1000 / 7.5) * 2);
const expectedSugar = roundQty(1000 - 10 * 2 - 10);
const expectedHot = 200 - 2;
const expectedPeta = 200 - 1;
const expectedMatcha = 500 - 10;
assert("mixed cart beans remaining", after["Coffee Beans"] === expectedBeans, `${after["Coffee Beans"]} vs ${expectedBeans}`);
assert("mixed cart milk remaining", after["Milk"] === expectedMilk, `${after["Milk"]} vs ${expectedMilk}`);
assert("mixed cart sugar remaining", after["Sugar"] === expectedSugar, `${after["Sugar"]} vs ${expectedSugar}`);
assert("mixed cart hot remaining", after["Hot Cup"] === expectedHot);
assert("mixed cart peta remaining", after["Peta Cup"] === expectedPeta);
assert("mixed cart matcha remaining", after["Matcha Powder"] === expectedMatcha);
assert("food does not change stock", deduct(opening, usedMap("fries", 3))["Coffee Beans"] === 1000);

console.log("\n4. Stock identity Opening + Restock − Used = Remaining");
const usages = [
  { itemName: "Coffee Beans", usedAmount: 90.91, date: "2026-09-09T12:00:00.000Z" },
  { itemName: "Coffee Beans", usedAmount: 18.18, date: "2026-09-10T06:00:00.000Z" },
];
const restocks = [
  { itemName: "Coffee Beans", quantityAdded: 1000, date: "2026-09-10 08:00:00" },
];
const liveStock = roundQty(1000 - 90.91 - 18.18 + 1000);

const today = stockLedgerForDate({
  itemName: "Coffee Beans",
  liveStock,
  date: "2026-09-10",
  restocks,
  usages,
});
assert("today remaining = live stock", today.remaining === liveStock);
assert("today identity", almostEqual(today.opening + today.restocked - today.used, today.remaining));
assert("today restocked 1000", today.restocked === 1000);
assert("today used 18.18", today.used === 18.18);

const yesterday = stockLedgerForDate({
  itemName: "Coffee Beans",
  liveStock,
  date: "2026-09-09",
  restocks,
  usages,
});
assert("yesterday remaining is end-of-day, not live", yesterday.remaining === roundQty(1000 - 90.91));
assert("yesterday identity", almostEqual(yesterday.opening + yesterday.restocked - yesterday.used, yesterday.remaining));
assert("yesterday used 90.91", yesterday.used === 90.91);
assert("yesterday restock 0", yesterday.restocked === 0);

console.log("\n5. Usage log remaining reconstruction");
const reconstructed = remainingForUsages(
  usages,
  restocks,
  [{ name: "Coffee Beans", stock: liveStock }],
);
assert("newest usage remaining after later restock", reconstructed[1] === roundQty(liveStock));
assert(
  "older usage remaining before later restock and later usage",
  reconstructed[0] === roundQty(liveStock - 1000 + 18.18),
  `${reconstructed[0]} vs ${roundQty(liveStock - 1000 + 18.18)}`,
);

const mixedTimeRemaining = remainingForUsages(
  [{ date: "2026-09-10T06:43:00.000Z", itemName: "Coffee Beans", usedAmount: 18.18 }],
  [{ date: "2026-09-10 14:43:00", itemName: "Coffee Beans", quantityAdded: 1000 }],
  [{ name: "Coffee Beans", stock: 1981.82 }],
);
assert(
  "Manila restock stamp sorts after UTC usage of the same moment+offset",
  mixedTimeRemaining[0] === 981.82,
  `${mixedTimeRemaining[0]}`,
);

console.log("\n6. Admin sale uses per-cup, not pack");
const adminSaleQty = 2;
const adminUsedBeans = roundQty(perCupAmount(beans) * adminSaleQty);
assert("2-cup admin sale deducts ~36.36g not 2000g", adminUsedBeans === roundQty((1000 / 55) * 2) && adminUsedBeans < 100);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll inventory math checks passed");
