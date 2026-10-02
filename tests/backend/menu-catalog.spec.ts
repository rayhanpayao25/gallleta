import { expect, test } from "@playwright/test";
import {
  DEFAULT_MENU,
  menuPriceLabel,
  menuSizePrice,
  pricedOrderLine,
} from "@/lib/menu";

test("default menu matches the printed categories, item counts, and size prices", () => {
  const expected = new Map([
    ["Non Coffee", [6, 50, 70]],
    ["Soda Series", [5, 50, 70]],
    ["Coffee Series", [6, 50, 70]],
    ["Milky Series", [6, 89, 109]],
    ["Yugort Series", [4, 50, 70]],
    ["Milk Tea Series", [5, 60, 80]],
    ["Frappe Series", [5, 129, null]],
  ] as const);

  expect(DEFAULT_MENU).toHaveLength(37);
  expect(new Set(DEFAULT_MENU.map((item) => item.category))).toEqual(
    new Set(expected.keys()),
  );

  for (const [category, [count, smallPrice, largePrice]] of expected) {
    const items = DEFAULT_MENU.filter((item) => item.category === category);
    expect(items).toHaveLength(count);
    for (const item of items) {
      expect(menuSizePrice(item, "16oz")).toBe(largePrice === null ? item.price : smallPrice);
      expect(menuSizePrice(item, "22oz")).toBe(largePrice ?? smallPrice);
      expect(menuPriceLabel(item)).toContain("22oz");
      if (largePrice === null) {
        expect(item.sizes).toEqual([{ label: "22oz", price: 129 }]);
      }
    }
  }
});

test("order pricing and snapshots retain the selected size", () => {
  const item = DEFAULT_MENU.find((entry) => entry.id === "spanish-latte")!;
  const line = pricedOrderLine(item, {
    name: item.name,
    qty: 2,
    size: "22oz",
  });

  expect(line).toMatchObject({
    productId: item.id,
    size: "22oz",
    price: 70,
    qty: 2,
  });
});
