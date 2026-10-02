"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { normalizeMenuSizes, pricedOrderLine } from "@/lib/menu";
import { parsePayment } from "@/lib/payments";
import { ingredientsForOrderLine, roundQty } from "@/lib/inventory";
import { canUsePos } from "@/lib/users";
import {
  createOrderAtomic,
  createRestockAtomic,
  deleteCostingRecord,
  deleteInventoryItemRecord,
  deleteOrderAtomic,
  deleteRecipeCostingRecord,
  deleteRestockAtomic,
  deleteRestockRecord,
  editRestockAtomic,
  getStore,
  saveCostingRecord,
  saveRecipeCostingRecord,
  updateStore,
} from "@/lib/store";
import type {
  Order,
  OrderItem,
  StoreData,
} from "@/lib/types";

async function requirePos() {
  const session = await getSession();
  if (!session || !canUsePos(session.role)) {
    throw new Error("Only POS staff can use the POS.");
  }
  return session;
}

async function requireCashier() {
  const session = await getSession();
  if (!session || session.role !== "cashier") {
    throw new Error("Only a cashier can take orders.");
  }
  return session;
}

async function requireInventoryAccess(hasAdminOnlyData: boolean) {
  const session = await getSession();
  if (
    !session ||
    (session.role !== "admin" && session.role !== "cashier") ||
    (session.role === "cashier" && hasAdminOnlyData)
  ) {
    throw new Error("You do not have permission to change these store records.");
  }
  return session;
}

export async function saveAdminData(data: {
  inventory?: StoreData["inventory"];
  restocks?: StoreData["restocks"];
  costings?: StoreData["costings"];
  recipes?: StoreData["recipes"];
  recipeCostings?: StoreData["recipeCostings"];
  usageLogs?: StoreData["usageLogs"];
  orders?: StoreData["orders"];
}) {
  await requireInventoryAccess(data.costings !== undefined || data.recipeCostings !== undefined || data.orders !== undefined);

  if (data.costings) {
    // The client always sends the full resulting costings array (this is
    // how the existing costing UI already calls saveAdminData for both add
    // and delete), so reconcile against what's currently persisted: drop
    // rows that vanished, upsert everything that's present.
    const current = await getStore();
    const nextIds = new Set(data.costings.map((entry) => entry.id));
    for (const existing of current.costings) {
      if (!nextIds.has(existing.id)) {
        await deleteCostingRecord(existing.id);
      }
    }
    for (const costing of data.costings) {
      await saveCostingRecord(costing);
    }
  }

  if (data.recipeCostings) {
    // Same reconcile pattern: saveCostings()/deleteRecipeCosting() in
    // SalePurchaseTransactions.tsx both send the full resulting
    // recipeCostings array (a "delete" is just "save the array without
    // that entry").
    const current = await getStore();
    const nextIds = new Set(data.recipeCostings.map((entry) => entry.id));
    for (const existing of current.recipeCostings) {
      if (!nextIds.has(existing.id)) {
        await deleteRecipeCostingRecord(existing.id);
      }
    }
    for (const costing of data.recipeCostings) {
      await saveRecipeCostingRecord(costing);
    }
  }

  await updateStore((store) => {
    if (data.inventory) store.inventory = data.inventory;
    if (data.restocks) store.restocks = data.restocks;
    if (data.costings) store.costings = data.costings;
    if (data.recipes && Object.keys(data.recipes).length > 0) store.recipes = data.recipes;
    if (data.recipeCostings) store.recipeCostings = data.recipeCostings;
    if (data.usageLogs) store.usageLogs = data.usageLogs;
    if (data.orders) store.orders = data.orders;
  });
  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteAdminRecord(kind: "order" | "inventory" | "restock" | "costing" | "usage", id: string) {
  await requireInventoryAccess(kind === "order" || kind === "costing" || kind === "usage");

  if (kind === "order") {
    // delete_order_atomic restores inventory and removes the order and its
    // related order_items/usage_logs in one transaction.
    await deleteOrderAtomic(id);
  } else if (kind === "restock") {
    await deleteRestockRecord(id);
  } else if (kind === "inventory") {
    const result = await deleteInventoryItemRecord(id);
    if ("error" in result) return result;
  } else if (kind === "costing") {
    await deleteCostingRecord(id);
  } else {
    // No live UI deletes a single usage_logs row directly; usage_logs
    // cleanup for a deleted order is handled by delete_order_atomic's cascade.
    await updateStore((store) => {
      store.usageLogs = store.usageLogs.filter((record) => record.id !== id);
    });
  }

  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function createRestock(input: {
  id: string;
  inventoryItemId: string | null;
  itemNameSnapshot: string;
  quantityAdded: number;
  createdAt: string;
  purchaseQty?: number | null;
  purchaseUnit?: string | null;
}) {
  await requireInventoryAccess(false);
  await createRestockAtomic(input);
  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function editRestock(input: {
  id: string;
  oldInventoryItemId: string | null;
  oldQuantity: number;
  newInventoryItemId: string | null;
  newItemNameSnapshot: string;
  newQuantity: number;
  newCreatedAt: string;
  newPurchaseQty?: number | null;
  newPurchaseUnit?: string | null;
}) {
  await requireInventoryAccess(false);
  await editRestockAtomic(input);
  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteRestock(input: { id: string }) {
  await requireInventoryAccess(false);
  await deleteRestockAtomic(input);
  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function openPos() {
  const session = await requirePos();
  await updateStore((store) => {
    store.pos = {
      isOpen: true,
      openedAt: new Date().toISOString(),
      openedBy: session.name,
    };
  });
  revalidatePath("/pos");
  revalidatePath("/admin");
}

export async function closePos() {
  await requirePos();
  await updateStore((store) => {
    store.pos = {
      isOpen: false,
      openedAt: null,
      openedBy: null,
    };
  });
  revalidatePath("/pos");
  revalidatePath("/admin");
}

export async function createOrder(
  cart: OrderItem[],
  paymentMethod?: string | null,
  tendered?: number | null,
) {
  const session = await requireCashier();

  if (cart.length === 0) {
    return { ok: false as const, error: "Add a drink before charging." };
  }

  const store = await getStore();
  if (!store.pos.isOpen) {
    return { ok: false as const, error: "Open the POS before taking orders." };
  }

  const priced: OrderItem[] = [];
  for (const line of cart) {
    const menuItem = store.menu.find((item) => item.id === line.productId);
    const qty = Number(line.qty);
    if (!menuItem || !menuItem.available) {
      return { ok: false as const, error: "One of the items is no longer on the menu." };
    }
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 99) {
      return { ok: false as const, error: "Each item quantity must be a whole number from 1 to 99." };
    }
    const sizes = normalizeMenuSizes(menuItem.sizes);
    if (sizes.length > 1 && !sizes.some((size) => size.label === line.size)) {
      return { ok: false as const, error: `Choose a cup size for ${menuItem.name}.` };
    }
    priced.push(pricedOrderLine(menuItem, { ...line, qty }));
  }

  const subtotal = priced.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = subtotal;
  const method = parsePayment(paymentMethod);
  const cashIn = method === "cash" ? Math.max(0, Math.round(Number(tendered) || 0)) : total;
  if (method === "cash" && cashIn < total) {
    return { ok: false as const, error: "Cash tendered is short." };
  }

  // The ticket number is allocated inside create_order_atomic on a per-PH-day
  // DB counter, not from this (possibly stale) cached order list.
  const orderId = `ord-${Date.now()}`;
  const createdAt = new Date().toISOString();

  // Aggregate ingredient deductions per inventory item across all cart
  // lines (same resolution logic and normalization as before - only the
  // write path changed). This is the "current server-side recipe/costing
  // logic" the atomic RPC applies; recipe/costing resolution stays here in
  // TypeScript rather than being reimplemented in SQL.
  const normalize = (value: string) => value.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  const deductionsByItem = new Map<string, { itemName: string; amount: number; unit: string; orderItemId: string }>();
  for (const line of priced) {
    for (const ingredient of ingredientsForOrderLine(store, line)) {
      const inventory = store.inventory.find(
        (item) => item.id === ingredient.inventoryItemId || normalize(item.name) === normalize(ingredient.name),
      );
      if (!inventory) continue;
      const amount = roundQty(ingredient.amount * line.qty);
      const existing = deductionsByItem.get(inventory.id);
      if (existing) {
        existing.amount = roundQty(existing.amount + amount);
      } else {
        deductionsByItem.set(inventory.id, { itemName: inventory.name, amount, unit: ingredient.unit, orderItemId: line.productId });
      }
    }
  }
  const deductions = Array.from(deductionsByItem.entries()).map(([inventoryItemId, value]) => ({
    inventoryItemId,
    ...value,
  }));

  const createdOrder: Order = {
    id: orderId,
    createdAt,
    baristaName: session.name,
    items: priced,
    subtotal,
    total,
    paymentMethod: method,
    paid: cashIn,
    change: method === "cash" ? cashIn - total : 0,
  };

  const result = await createOrderAtomic({ order: createdOrder, deductions });
  if (!result.ok) {
    return { ok: false as const, error: result.error };
  }
  const ticketNo = result.ticketNo;
  createdOrder.ticketNo = ticketNo;

  revalidatePath("/pos");
  revalidatePath("/admin");
  return {
    ok: true as const,
    total,
    ticketNo,
    id: orderId,
    order: createdOrder,
  };
}