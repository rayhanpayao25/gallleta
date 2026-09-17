"use client";

import { useMemo, useState, useTransition } from "react";
import {
  addMenuCategory,
  createMenuItem,
  deleteMenuCategory,
  deleteMenuItem,
  renameMenuCategory,
  setMenuItemAvailable,
  updateMenuItem,
} from "@/actions/menu";
import { addonIdFromName, DRINK_STYLES, drinkStyleLabel, drinkStyleLabelList, formatMoney, isFoodOrPastry, normalizeMenuAddons, normalizeMenuStyles } from "@/lib/menu";
import type { DrinkStyle, InventoryItem, MenuAddon, MenuItem } from "@/lib/types";

type MenuCatalogProps = {
  menu: MenuItem[];
  categories: string[];
  inventory?: InventoryItem[];
};

type SubTab = "items" | "categories";

const field =
  "w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none transition-all focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900";

const iconBtn =
  "flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-all hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30";

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M13.5 6.5l3 3" strokeWidth="1.7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor">
      <path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" strokeWidth="1.7" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor">
      <path d="M5 12.5l4.5 4.5L19 7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor">
      <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor">
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.5" strokeWidth="1.7" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor">
      <path d="M3 3l18 18M10.5 10.7a2.5 2.5 0 0 0 3 3M7 7.4C4.6 8.8 3 12 3 12s3.5 6.5 9.5 6.5c1.4 0 2.7-.3 3.8-.8M16.8 16.2C19.2 14.8 21.5 12 21.5 12S18 5.5 12 5.5c-.7 0-1.3.1-1.9.2" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function actionError(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    typeof result.error === "string" &&
    result.error
  ) {
    return result.error;
  }
  return null;
}

export function MenuCatalog({ menu, categories, inventory = [] }: MenuCatalogProps) {
  const [tab, setTab] = useState<SubTab>("items");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newCategory, setNewCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [filter, setFilter] = useState("All");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemStyles, setItemStyles] = useState<DrinkStyle[]>([...DRINK_STYLES]);
  const [itemAddons, setItemAddons] = useState<MenuAddon[]>([]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of menu) {
      const key = item.category.toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [menu]);

  const visibleItems = useMemo(() => {
    const needle = filter.toLowerCase();
    return menu
      .filter((item) => filter === "All" || item.category.toLowerCase() === needle)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [menu, filter]);

  function flash(message: string | null) {
    setNotice(message);
  }

  function startCreateItem() {
    setEditingId("new");
    setItemName("");
    setItemPrice("");
    setItemCategory(filter !== "All" ? filter : categories[0] ?? "");
    setItemAvailable(true);
    setItemStyles(isFoodOrPastry(filter !== "All" ? filter : categories[0] ?? "") ? [] : [...DRINK_STYLES]);
    setItemAddons([]);
    setNotice(null);
    setTab("items");
  }

  function startEditItem(item: MenuItem) {
    setEditingId(item.id);
    setItemName(item.name);
    setItemPrice(String(item.price));
    setItemCategory(item.category);
    setItemAvailable(item.available !== false);
    setItemStyles(normalizeMenuStyles(item));
    setItemAddons(normalizeMenuAddons(item));
    setNotice(null);
    setTab("items");
  }

  function resetItemForm() {
    setEditingId(null);
  }

  function itemFormData() {
    const data = new FormData();
    if (editingId && editingId !== "new") data.set("id", editingId);
    data.set("name", itemName);
    data.set("price", itemPrice);
    data.set("category", itemCategory);
    data.set("available", itemAvailable ? "true" : "false");
    for (const style of itemStyles) data.append("styles", style);
    data.set("addons", JSON.stringify(itemAddons.filter((addon) => addon.name.trim())));
    return data;
  }

  return (
    <div className="min-h-screen min-w-0 space-y-6 rounded-none border-0 border-neutral-300 bg-white p-3 sm:rounded-xl sm:border sm:p-6">
      <div className="flex gap-2 overflow-x-auto border-b border-neutral-400 pb-3">
        {(
          [
            { id: "items", label: "Items" },
            { id: "categories", label: "Categories" },
          ] as const
        ).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`shrink-0 px-4 py-1.5 rounded text-xs font-bold transition shadow-sm uppercase ${
              tab === entry.id ? "bg-black text-white" : "bg-white text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="w-full space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
            {tab === "categories" ? "Categories" : "Items"}
          </h1>
          {tab === "items" ? (
            <button
              type="button"
              onClick={startCreateItem}
              className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Add item
            </button>
          ) : null}
        </div>

        {notice ? <p className="text-sm text-neutral-500">{notice}</p> : null}

        {tab === "categories" ? (
          <div className="space-y-5">
            <form
              className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = await addMenuCategory(newCategory);
                  const error = actionError(result);
                  if (error) {
                    flash(error);
                    return;
                  }
                  setNewCategory("");
                  flash("Category added.");
                });
              }}
            >
              <label className="min-w-0 flex-1 text-xs font-medium text-neutral-600">
                <span className="mb-1.5 block">New category</span>
                <input
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  placeholder="e.g. Coffee"
                  className={field}
                />
              </label>
              <button
                type="submit"
                disabled={pending || !newCategory.trim()}
                className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
              >
                {pending ? "Saving..." : "Add category"}
              </button>
            </form>

            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium tracking-wide text-neutral-400 uppercase">
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Items</th>
                    <th className="sticky right-0 bg-white px-3 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody>
                  {categories.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-sm text-neutral-400">
                        No categories yet.
                      </td>
                    </tr>
                  ) : (
                    categories.map((category) => {
                      const count = counts.get(category.toLowerCase()) ?? 0;
                      const editing = editingCategory === category;
                      return (
                        <tr key={category} className="border-t border-neutral-100">
                          <td className="px-4 py-3">
                            {editing ? (
                              <input
                                value={categoryName}
                                onChange={(event) => setCategoryName(event.target.value)}
                                className={field}
                                autoFocus
                              />
                            ) : (
                              <span className="font-medium">{category}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-neutral-500">{count}</td>
                          <td className="sticky right-0 bg-white px-3 py-3">
                            <div className="flex justify-end gap-0.5">
                              {editing ? (
                                <>
                                  <button
                                    type="button"
                                    aria-label={`Save ${category}`}
                                    disabled={pending}
                                    onClick={() =>
                                      startTransition(async () => {
                                        const result = await renameMenuCategory(category, categoryName);
                                        const error = actionError(result);
                                        if (error) {
                                          flash(error);
                                          return;
                                        }
                                        setEditingCategory(null);
                                        if (filter === category) setFilter(categoryName.trim() || category);
                                        flash("Category renamed.");
                                      })
                                    }
                                    className={iconBtn}
                                  >
                                    <CheckIcon />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Cancel rename"
                                    onClick={() => setEditingCategory(null)}
                                    className={iconBtn}
                                  >
                                    <CloseIcon />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    aria-label={`Rename ${category}`}
                                    onClick={() => {
                                      setEditingCategory(category);
                                      setCategoryName(category);
                                      setNotice(null);
                                    }}
                                    className={iconBtn}
                                  >
                                    <PencilIcon />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Delete ${category}`}
                                    disabled={pending}
                                    onClick={() => {
                                      if (count > 0) {
                                        flash("Move or delete items in this category first.");
                                        return;
                                      }
                                      startTransition(async () => {
                                        const result = await deleteMenuCategory(category);
                                        const error = actionError(result);
                                        if (error) {
                                          flash(error);
                                          return;
                                        }
                                        if (filter === category) setFilter("All");
                                        flash("Category deleted.");
                                      });
                                    }}
                                    className={`${iconBtn} hover:bg-red-50 hover:text-red-600`}
                                  >
                                    <TrashIcon />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {["All", ...categories].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setFilter(name)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    filter === name
                      ? "bg-black text-white"
                      : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:text-black"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>

            {editingId ? (
              <form
                className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  startTransition(async () => {
                    const result =
                      editingId === "new" ? await createMenuItem(itemFormData()) : await updateMenuItem(itemFormData());
                    const error = actionError(result);
                    if (error) {
                      flash(error);
                      return;
                    }
                    resetItemForm();
                    flash(editingId === "new" ? "Item added." : "Item updated.");
                  });
                }}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{editingId === "new" ? "New item" : "Edit item"}</p>
                  <button type="button" onClick={resetItemForm} className="text-xs text-neutral-500 hover:text-black">
                    Cancel
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs font-medium text-neutral-600">
                    <span className="mb-1.5 block">Name</span>
                    <input value={itemName} onChange={(event) => setItemName(event.target.value)} className={field} required />
                  </label>
                  <label className="text-xs font-medium text-neutral-600">
                    <span className="mb-1.5 block">Price</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={itemPrice}
                      onChange={(event) => setItemPrice(event.target.value)}
                      className={field}
                      required
                    />
                  </label>
                  <label className="text-xs font-medium text-neutral-600">
                    <span className="mb-1.5 block">Category</span>
                    <select
                      value={itemCategory}
                      onChange={(event) => {
                        const next = event.target.value;
                        setItemCategory(next);
                        setItemStyles(isFoodOrPastry(next) ? [] : itemStyles.length > 0 ? itemStyles : [...DRINK_STYLES]);
                      }}
                      className={field}
                      required
                    >
                      <option value="" disabled>
                        Select a category
                      </option>
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {!isFoodOrPastry(itemCategory) ? (
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-neutral-600">Type</p>
                    <div className="flex gap-2">
                      {DRINK_STYLES.map((style) => {
                        const on = itemStyles.includes(style);
                        return (
                          <button
                            key={style}
                            type="button"
                            onClick={() =>
                              setItemStyles((current) =>
                                on ? current.filter((entry) => entry !== style) : [...current, style],
                              )
                            }
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                              on ? "border-black bg-black text-white" : "border-neutral-200 bg-white text-neutral-600"
                            }`}
                          >
                            {drinkStyleLabel(style)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-neutral-600">Add-ons</p>
                    <button
                      type="button"
                      onClick={() =>
                        setItemAddons((current) => [
                          ...current,
                          {
                            id: addonIdFromName("addon", current.length),
                            name: "",
                            price: 0,
                            qtyEnabled: false,
                          },
                        ])
                      }
                      className="text-xs font-medium text-neutral-600 hover:text-black"
                    >
                      Add option
                    </button>
                  </div>
                  {itemAddons.length === 0 ? (
                    <p className="text-xs text-neutral-400">
                      Example: Oat milk ₱30, Extra espresso ₱40. Set stock + amount so extras deduct inventory (20 ml milk → 100 ml recipe + 20 ml extra = 120 ml).
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div className="hidden grid-cols-[1fr_88px_1fr_88px_auto] gap-2 text-[11px] text-neutral-400 lg:grid">
                        <span>Name</span>
                        <span>Extra ₱</span>
                        <span>Deduct from</span>
                        <span>Amount</span>
                        <span />
                      </div>
                      {itemAddons.map((addon, index) => {
                        const stock = inventory.find((item) => item.id === addon.inventoryItemId);
                        return (
                        <div key={addon.id} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_88px_1fr_88px_auto] lg:items-center">
                          <input
                            value={addon.name}
                            onChange={(event) =>
                              setItemAddons((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, name: event.target.value } : entry,
                                ),
                              )
                            }
                            placeholder="Oat milk"
                            className={field}
                          />
                          <input
                            inputMode="numeric"
                            value={addon.price === 0 ? "" : String(addon.price)}
                            onChange={(event) => {
                              const raw = event.target.value.replace(/[^\d]/g, "");
                              setItemAddons((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, price: raw ? Math.max(0, Number(raw)) : 0 }
                                    : entry,
                                ),
                              );
                            }}
                            className={field}
                            aria-label="Add-on extra price"
                            placeholder="20"
                          />
                          <select
                            value={addon.inventoryItemId ?? ""}
                            onChange={(event) => {
                              const nextId = event.target.value;
                              const nextStock = inventory.find((item) => item.id === nextId);
                              setItemAddons((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        inventoryItemId: nextId || undefined,
                                        usageUnit: nextStock?.unit || entry.usageUnit,
                                      }
                                    : entry,
                                ),
                              );
                            }}
                            className={field}
                            aria-label="Stock item to deduct"
                          >
                            <option value="">No stock deduction</option>
                            {inventory.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                          <div className="flex items-center gap-1">
                            <input
                              inputMode="decimal"
                              value={addon.usageAmount ? String(addon.usageAmount) : ""}
                              onChange={(event) => {
                                const raw = event.target.value.replace(/[^\d.]/g, "");
                                const usageAmount = raw ? Math.max(0, Number(raw)) : 0;
                                setItemAddons((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, usageAmount: usageAmount || undefined }
                                      : entry,
                                  ),
                                );
                              }}
                              className={field}
                              aria-label="Add-on usage amount"
                              placeholder="20"
                            />
                            <span className="shrink-0 text-[11px] text-neutral-400">
                              {stock?.unit || addon.usageUnit || "ml"}
                            </span>
                          </div>
                          <button
                            type="button"
                            aria-label="Remove add-on"
                            onClick={() =>
                              setItemAddons((current) => current.filter((_, entryIndex) => entryIndex !== index))
                            }
                            className="text-xs text-neutral-400 hover:text-black"
                          >
                            Remove
                          </button>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm text-neutral-700">
                    <input
                      type="checkbox"
                      checked={itemAvailable}
                      onChange={(event) => setItemAvailable(event.target.checked)}
                      className="h-4 w-4 accent-black"
                    />
                    Available
                  </label>
                  <button
                    type="submit"
                    disabled={pending || !itemName.trim() || !itemCategory || categories.length === 0}
                    className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
                  >
                    {pending ? "Saving..." : editingId === "new" ? "Add" : "Save"}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-xs font-medium tracking-wide text-neutral-400 uppercase">
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="sticky right-0 bg-white px-3 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-400">
                        {categories.length === 0 ? "Add a category, then add items." : "No items in this category."}
                      </td>
                    </tr>
                  ) : (
                    visibleItems.map((item) => (
                      <tr key={item.id} className="border-t border-neutral-100">
                        <td className="px-4 py-3 font-medium">
                          <p>{item.name}</p>
                          {normalizeMenuAddons(item).length > 0 ? (
                            <p className="mt-0.5 text-[11px] text-neutral-400">
                              {normalizeMenuAddons(item)
                                .map((addon) => {
                                  const stock = inventory.find((entry) => entry.id === addon.inventoryItemId);
                                  const extra = addon.price > 0 ? ` +₱${addon.price}` : "";
                                  const used =
                                    addon.usageAmount && stock
                                      ? ` · ${addon.usageAmount}${stock.unit || addon.usageUnit || ""} ${stock.name}`
                                      : "";
                                  return `${addon.name}${extra}${used}`;
                                })
                                .join(", ")}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-neutral-500">{item.category}</td>
                        <td className="px-4 py-3 text-neutral-500">{drinkStyleLabelList(item)}</td>
                        <td className="px-4 py-3 text-right">{formatMoney(item.price)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs ${item.available !== false ? "text-neutral-900" : "text-neutral-400"}`}>
                            {item.available !== false ? "On" : "Hidden"}
                          </span>
                        </td>
                        <td className="sticky right-0 bg-white px-3 py-3">
                          <div className="flex justify-end gap-0.5">
                            <button
                              type="button"
                              aria-label={item.available === false ? `Show ${item.name}` : `Hide ${item.name}`}
                              disabled={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  await setMenuItemAvailable(item.id, item.available === false);
                                })
                              }
                              className={iconBtn}
                            >
                              {item.available === false ? <EyeIcon /> : <EyeOffIcon />}
                            </button>
                            <button
                              type="button"
                              aria-label={`Edit ${item.name}`}
                              onClick={() => startEditItem(item)}
                              className={iconBtn}
                            >
                              <PencilIcon />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${item.name}`}
                              disabled={pending}
                              onClick={() => {
                                startTransition(async () => {
                                  const result = await deleteMenuItem(item.id);
                                  const error = actionError(result);
                                  if (error) {
                                    flash(error);
                                    return;
                                  }
                                  if (editingId === item.id) resetItemForm();
                                  flash("Item deleted.");
                                });
                              }}
                              className={`${iconBtn} hover:bg-red-50 hover:text-red-600`}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
