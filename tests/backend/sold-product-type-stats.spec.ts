import { test, expect } from "@playwright/test";
import { productStatsForCategoryType, soldProductTypeStats } from "@/lib/analytics";

test("drink sales use the explicit category type, not category or product names", () => {
  const stats = productStatsForCategoryType(
    [
      { id: "fries", name: "Regular Fries", category: "Sides", qty: 15, sales: 735 },
      { id: "tea", name: "Matcha", category: "Cold Drinks", qty: 2, sales: 340 },
    ],
    { Sides: "Food", "cold drinks": " drinks " },
    "Drinks",
  );

  expect(stats.map((item) => item.name)).toEqual(["Matcha"]);
});

test("sold product summary groups sales by menu category type", () => {
  const stats = soldProductTypeStats(
    [
      { id: "coffee", name: "Latte", category: "Coffee", qty: 3, sales: 450 },
      { id: "tea", name: "Matcha", category: "Tea", qty: 2, sales: 340 },
      { id: "food", name: "Panini", category: "Food", qty: 1, sales: 250 },
    ],
    ["Coffee", "Tea", "Food", "Pastries"],
    {
      coffee: "Beverages",
      Tea: "beverages",
      Food: "Meals",
      Pastries: "Sweets",
    },
  );

  expect(stats).toEqual([
    { name: "Beverages", qty: 5, sales: 790 },
    { name: "Meals", qty: 1, sales: 250 },
    { name: "Sweets", qty: 0, sales: 0 },
  ]);
});

test("sold product summary falls back to category names when types are blank", () => {
  const stats = soldProductTypeStats(
    [{ id: "coffee", name: "Latte", category: "Coffee", qty: 2, sales: 300 }],
    ["Coffee", "Desserts"],
    { Coffee: "  ", Desserts: "" },
  );

  expect(stats).toEqual([
    { name: "Coffee", qty: 2, sales: 300 },
    { name: "Desserts", qty: 0, sales: 0 },
  ]);
});
