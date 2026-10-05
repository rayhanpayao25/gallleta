import { expect, test } from "@playwright/test";
import {
  DEFAULT_MENU,
  isFoodOrPastry,
  menuPriceLabel,
  pricedOrderLine,
} from "@/lib/menu";

test("default menu matches the printed categories, items, sizes, and prices", () => {
  const expectedCategories = new Map([
    ["Coffee Drinks", 6],
    ["Non-Coffee Drinks", 5],
    ["Soda Pop", 4],
    ["Matcha Series", 3],
    ["Snacks", 6],
    ["Rice Meals", 4],
  ] as const);

  expect(DEFAULT_MENU).toHaveLength(28);
  expect(new Set(DEFAULT_MENU.map((item) => item.category))).toEqual(
    new Set(expectedCategories.keys()),
  );
  for (const [category, count] of expectedCategories) {
    expect(DEFAULT_MENU.filter((item) => item.category === category)).toHaveLength(count);
  }

  expect(DEFAULT_MENU.map(({ name, category, price }) => [name, category, price])).toEqual([
    ["Iced Latte", "Coffee Drinks", 69],
    ["Spanish Latte", "Coffee Drinks", 69],
    ["Caramel Macchiato", "Coffee Drinks", 69],
    ["Hazelnut Latte", "Coffee Drinks", 69],
    ["Cinnamon Latte", "Coffee Drinks", 69],
    ["Sea Salt Latte", "Coffee Drinks", 79],
    ["Milo Dino", "Non-Coffee Drinks", 59],
    ["Iced Chocolate", "Non-Coffee Drinks", 59],
    ["Choco Oreo", "Non-Coffee Drinks", 59],
    ["Choco Berry", "Non-Coffee Drinks", 59],
    ["Strawberry Milk", "Non-Coffee Drinks", 59],
    ["Green Apple", "Soda Pop", 49],
    ["Blueberry", "Soda Pop", 49],
    ["Strawberry", "Soda Pop", 49],
    ["Lychee", "Soda Pop", 49],
    ["Milky Matcha", "Matcha Series", 69],
    ["Matcha Oreo", "Matcha Series", 69],
    ["Matcha Berry", "Matcha Series", 69],
    ["Cheesy Fries", "Snacks", 69],
    ["Regular Fries", "Snacks", 49],
    ["Nachos", "Snacks", 69],
    ["Siomai", "Snacks", 49],
    ["Tempura", "Snacks", 49],
    ["Squidballs", "Snacks", 49],
    ["Tapsilog", "Rice Meals", 109],
    ["Tocilog", "Rice Meals", 99],
    ["Hungarian Silog", "Rice Meals", 109],
    ["Chicken Wings", "Rice Meals", 79],
  ]);

  const drinks = DEFAULT_MENU.filter((item) =>
    ["Coffee Drinks", "Non-Coffee Drinks", "Soda Pop", "Matcha Series"].includes(item.category),
  );
  expect(drinks.every((item) => item.sizes?.length === 1 && item.sizes[0].label === "16oz")).toBe(true);
  expect(drinks.every((item) => menuPriceLabel(item).startsWith("16oz"))).toBe(true);
  expect(drinks[0].addons?.map(({ name, price }) => [name, price])).toEqual([
    ["Coffee Shot", 15],
    ["Oreo", 15],
    ["Strawberry", 15],
    ["Nata de Coco", 10],
    ["Sea Salt Cream", 25],
    ["Seaweed (per pack)", 25],
  ]);
  expect(DEFAULT_MENU.find((item) => item.id === "chicken-wings")?.sizes).toEqual([
    { label: "2pcs", price: 79 },
    { label: "3pcs", price: 99 },
  ]);
  expect(isFoodOrPastry("Snacks")).toBe(true);
  expect(isFoodOrPastry("Rice Meals")).toBe(true);
});

test("order pricing and snapshots retain the selected size", () => {
  const item = DEFAULT_MENU.find((entry) => entry.id === "spanish-latte")!;
  const line = pricedOrderLine(item, {
    name: item.name,
    qty: 2,
    size: "16oz",
  });

  expect(line).toMatchObject({
    productId: item.id,
    size: "16oz",
    price: 69,
    qty: 2,
  });
});
