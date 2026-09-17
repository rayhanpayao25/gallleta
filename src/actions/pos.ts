"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { isDrinkCategory, nextTicketNo } from "@/lib/escpos";
import { orderLineOptionsLabel, pricedOrderLine } from "@/lib/menu";
import { parsePayment } from "@/lib/payments";
import { ingredientsForOrderLine, roundQty } from "@/lib/inventory";
import { canUsePos } from "@/lib/users";
import {
  appendPrintJobs,
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
  voidOrderAtomic,
} from "@/lib/store";
import type {
  MenuItem,
  Order,
  OrderItem,
  PrintJob,
  PrintJobStatus,
  PrintJobType,
  StoreData,
} from "@/lib/types";

function isMissingOrderTable(error: { code?: string; message?: string }) {
  return error.code === "PGRST205" || /orders|order_items.*schema cache|relation .*orders|relation .*order_items/i.test(error.message ?? "");
}

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

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    throw new Error("Only an admin can change store records.");
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

function labelJobsForOrder(
  order: Order,
  menu: MenuItem[],
  idPrefix: string,
  createdAt: string,
): PrintJob[] {
  const categoryByProduct = new Map(menu.map((item) => [item.id, item.category]));
  let labelIndex = 0;

  return order.items.flatMap((item, itemIndex) => {
    const category = item.category ?? categoryByProduct.get(item.productId);
    if (!isDrinkCategory(category)) return [];

    return Array.from({ length: item.qty }, (_, copyIndex) => {
      labelIndex += 1;
      return {
        id: `${idPrefix}-label-${labelIndex}`,
        orderId: order.id,
        type: "cup-label" as const,
        status: "pending" as const,
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
        label: {
          productId: item.productId,
          name: orderLineOptionsLabel(item)
            ? `${item.name} / ${orderLineOptionsLabel(item)}`
            : item.name,
          price: item.price,
          itemIndex,
          copyIndex,
          copiesForItem: item.qty,
        },
      };
    });
  });
}

function initialPrintJobs(order: Order, menu: MenuItem[]): PrintJob[] {
  const createdAt = order.createdAt;
  return [
    ...labelJobsForOrder(order, menu, order.id, createdAt),
    {
      id: `${order.id}-receipt`,
      orderId: order.id,
      type: "customer-receipt",
      status: "pending",
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function reprintId(orderId: string, type: PrintJobType): string {
  return `${orderId}-${type}-reprint-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
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
    // delete_order_atomic restores inventory (unless the order was already
    // voided, which already restored it) and removes usage_logs/order_items
    // (DB cascade) and the order row, all in one transaction.
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
}) {
  await requireInventoryAccess(false);
  await editRestockAtomic(input);
  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteRestock(input: { id: string; inventoryItemId: string | null; quantityAdded: number }) {
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
  promoId?: string | null,
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
    priced.push(pricedOrderLine(menuItem, { ...line, qty }));
  }

  const subtotal = priced.reduce((sum, item) => sum + item.price * item.qty, 0);
  let discount = 0;
  let promoLabel: string | undefined;
  if (promoId) {
    const found = store.promotions.find((entry) => entry.id === promoId && entry.active);
    if (!found) {
      return { ok: false as const, error: "That promotion is no longer available." };
    }
    promoLabel = found.label;
    discount =
      found.type === "percent"
        ? Math.round((subtotal * found.value) / 100)
        : Math.min(subtotal, Math.round(found.value));
  }
  const total = Math.max(0, subtotal - discount);
  const method = parsePayment(paymentMethod);
  const cashIn = method === "cash" ? Math.max(0, Math.round(Number(tendered) || 0)) : total;
  if (method === "cash" && cashIn < total) {
    return { ok: false as const, error: "Cash tendered is short." };
  }

  const ticketNo = nextTicketNo(store.orders);
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
    discount,
    promoLabel,
    total,
    paymentMethod: method,
    ticketNo,
    paid: cashIn,
    change: method === "cash" ? cashIn - total : 0,
    voided: false,
  };

  const result = await createOrderAtomic({ order: createdOrder, deductions });
  if (!result.ok) {
    return { ok: false as const, error: result.error };
  }

  const createdPrintJobs = initialPrintJobs(createdOrder, store.menu);
  await appendPrintJobs(createdPrintJobs);

  revalidatePath("/pos");
  revalidatePath("/admin");
  return {
    ok: true as const,
    total,
    ticketNo,
    id: orderId,
    order: createdOrder,
    printJobs: createdPrintJobs,
  };
}

export async function verifyManager(username: string, password: string) {
  await requirePos();
  const store = await getStore();
  const user = store.users.find(
    (entry) =>
      entry.role === "manager" &&
      entry.username === username.trim().toLowerCase() &&
      Boolean(entry.password) &&
      entry.password === password,
  );
  if (!user) {
    return { error: "Manager credentials required to void." };
  }
  return { ok: true, name: user.name };
}

export async function voidOrder(
  orderId: string,
  reason: string,
  managerUsername?: string,
  managerPassword?: string,
) {
  const session = await requirePos();
  if (!reason.trim()) {
    return { error: "Enter a reason for voiding." };
  }

  if (session.role === "cashier") {
    const auth = await verifyManager(managerUsername ?? "", managerPassword ?? "");
    if ("error" in auth) return auth;
  } else if (session.role !== "manager") {
    return { error: "Only a manager can void a transaction." };
  }

  const result = await voidOrderAtomic(orderId, reason.trim(), null);
  if (!result.ok) return { error: result.error };

  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function requestVoidApproval(
  cart: OrderItem[],
  reason: string,
  orderId?: string | null,
  promoId?: string | null,
  paymentMethod?: string | null,
) {
  const session = await requireCashier();
  const trimmedReason = reason.trim();
  if (!trimmedReason) return { error: "Enter a reason for voiding." };

  let error: string | undefined;
  let requestId = "";

  await updateStore((store) => {
    if (
      store.voidRequests.some(
        (request) =>
          request.requestedById === session.userId && request.status === "pending",
      )
    ) {
      error = "You already have a void request waiting for admin approval.";
      return;
    }

    const existingOrder = orderId
      ? store.orders.find((order) => order.id === orderId)
      : undefined;
    if (orderId && !existingOrder) {
      error = "Ticket not found.";
      return;
    }
    if (existingOrder?.voided) {
      error = "Ticket is already voided.";
      return;
    }

    let items: OrderItem[] = [];
    let subtotal = 0;
    let discount = 0;
    let promoLabel: string | undefined;
    let total = 0;
    let requestedPayment = parsePayment(paymentMethod);

    if (existingOrder) {
      items = existingOrder.items.map((item) => ({ ...item }));
      subtotal = existingOrder.subtotal ?? existingOrder.total;
      discount = existingOrder.discount ?? 0;
      promoLabel = existingOrder.promoLabel;
      total = existingOrder.total;
      requestedPayment = parsePayment(existingOrder.paymentMethod);
    } else {
      if (cart.length === 0) {
        error = "No items to void.";
        return;
      }
      for (const line of cart) {
        const menuItem = store.menu.find((item) => item.id === line.productId);
        const qty = Number(line.qty);
        if (!menuItem) {
          error = "One of the items is no longer on the menu.";
          return;
        }
        if (!Number.isSafeInteger(qty) || qty < 1 || qty > 99) {
          error = "Each item quantity must be a whole number from 1 to 99.";
          return;
        }
        items.push(pricedOrderLine(menuItem, { ...line, qty }));
      }
      subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      const promotion = promoId
        ? store.promotions.find((entry) => entry.id === promoId && entry.active)
        : undefined;
      if (promotion) {
        promoLabel = promotion.label;
        discount =
          promotion.type === "percent"
            ? Math.round((subtotal * promotion.value) / 100)
            : Math.min(subtotal, Math.round(promotion.value));
      }
      total = Math.max(0, subtotal - discount);
    }

    requestId = `void-request-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    store.voidRequests.unshift({
      id: requestId,
      requestedAt: new Date().toISOString(),
      requestedById: session.userId,
      requestedByName: session.name,
      reason: trimmedReason,
      status: "pending",
      orderId: existingOrder?.id,
      items,
      subtotal,
      discount,
      promoLabel,
      total,
      paymentMethod: requestedPayment,
    });
  });

  if (error) return { error };
  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true, requestId };
}

export async function getVoidRequestStatus(requestId: string) {
  const session = await requirePos();
  const store = await getStore();
  const request = store.voidRequests.find((entry) => entry.id === requestId);
  if (!request || request.requestedById !== session.userId) {
    return { found: false as const };
  }
  return {
    found: true as const,
    status: request.status,
    orderId: request.orderId ?? null,
    processedOrderId: request.processedOrderId ?? null,
  };
}

export async function deleteVoidRequest(requestId: string) {
  await requireAdmin();
  let error: string | undefined;

  await updateStore((store) => {
    const request = store.voidRequests.find((entry) => entry.id === requestId);
    if (!request) {
      error = "Void request not found.";
      return;
    }
    store.voidRequests = store.voidRequests.filter((entry) => entry.id !== requestId);
  });

  if (error) return { error };
  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function approveVoidRequest(requestId: string) {
  const session = await requireAdmin();

  // voidRequests itself is not yet persisted (out of scope for this phase -
  // it's a separate, not-yet-durable workflow list, same as before). The
  // order-level effect of approving one (voiding an existing order, or
  // creating a new already-voided order for a pre-checkout void) now goes
  // through the atomic RPCs below rather than a plain in-memory mutation.
  const store = await getStore();
  const request = store.voidRequests.find((entry) => entry.id === requestId);
  if (!request) {
    return { error: "Void request not found." };
  }
  if (request.status !== "pending") {
    return { error: "Void request is already approved." };
  }

  let processedOrderId: string;
  if (request.orderId) {
    const result = await voidOrderAtomic(request.orderId, request.reason, null);
    if (!result.ok) return { error: result.error };
    processedOrderId = request.orderId;
  } else {
    const createdAt = new Date().toISOString();
    const createdId = `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const result = await createOrderAtomic({
      order: {
        id: createdId,
        createdAt,
        baristaName: request.requestedByName,
        items: request.items.map((item) => ({ ...item })),
        subtotal: request.subtotal,
        discount: request.discount,
        promoLabel: request.promoLabel,
        total: request.total,
        paymentMethod: request.paymentMethod,
        ticketNo: nextTicketNo(store.orders),
        paid: 0,
        change: 0,
        voided: true,
        voidReason: request.reason,
      },
      deductions: [],
    });
    if (!result.ok) return { error: result.error };
    processedOrderId = createdId;
  }

  await updateStore((innerStore) => {
    const innerRequest = innerStore.voidRequests.find((entry) => entry.id === requestId);
    if (!innerRequest) return;
    innerRequest.status = "approved";
    innerRequest.processedOrderId = processedOrderId;
    innerRequest.approvedAt = new Date().toISOString();
    innerRequest.approvedByName = session.name;
  });

  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true };
}

export async function voidCheckout(
  cart: OrderItem[],
  reason: string,
  managerUsername: string,
  managerPassword: string,
  promoId?: string | null,
  paymentMethod?: string | null,
) {
  const session = await requireCashier();
  if (!reason.trim()) {
    return { error: "Enter a reason for voiding." };
  }
  if (cart.length === 0) {
    return { error: "No items to void." };
  }

  const auth = await verifyManager(managerUsername, managerPassword);
  if ("error" in auth) return auth;

  let error: string | undefined;
  let createdId = "";

  await updateStore((store) => {
    const priced: OrderItem[] = [];
    for (const line of cart) {
      const menuItem = store.menu.find((item) => item.id === line.productId);
      const qty = Number(line.qty);
      if (!menuItem) {
        error = "One of the items is no longer on the menu.";
        return;
      }
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 99) {
        error = "Each item quantity must be a whole number from 1 to 99.";
        return;
      }
      priced.push(pricedOrderLine(menuItem, { ...line, qty }));
    }

    const subtotal = priced.reduce((sum, item) => sum + item.price * item.qty, 0);
    let discount = 0;
    let promoLabel: string | undefined;
    if (promoId) {
      const found = store.promotions.find((entry) => entry.id === promoId && entry.active);
      if (found) {
        promoLabel = found.label;
        discount =
          found.type === "percent"
            ? Math.round((subtotal * found.value) / 100)
            : Math.min(subtotal, Math.round(found.value));
      }
    }
    const total = Math.max(0, subtotal - discount);
    const orderId = `ord-${Date.now()}`;
    createdId = orderId;
    store.orders.push({
      id: orderId,
      createdAt: new Date().toISOString(),
      baristaName: session.name,
      items: priced,
      subtotal,
      discount,
      promoLabel,
      total,
      paymentMethod: parsePayment(paymentMethod),
      ticketNo: nextTicketNo(store.orders),
      paid: 0,
      change: 0,
      voided: true,
      voidReason: reason.trim(),
    });
  });

  if (error) return { error };
  revalidatePath("/pos");
  revalidatePath("/admin");
  return { ok: true, id: createdId };
}

export async function beginPrintJob(jobId: string) {
  await requirePos();
  let error: string | undefined;
  let updated: PrintJob | null = null;

  await updateStore((store) => {
    const job = store.printJobs.find((entry) => entry.id === jobId);
    const order = job
      ? store.orders.find((entry) => entry.id === job.orderId)
      : undefined;
    if (!job || !order) {
      error = "Print job not found.";
      return;
    }
    if (order.voided || job.status === "cancelled") {
      error = "A voided order cannot be printed.";
      return;
    }
    if (job.status === "printed") {
      error = "This print job has already succeeded.";
      return;
    }

    job.attempts += 1;
    job.status = "pending";
    job.updatedAt = new Date().toISOString();
    delete job.lastError;
    updated = { ...job, label: job.label ? { ...job.label } : undefined };
  });

  if (error || !updated) return { error: error ?? "Unable to start print job." };
  revalidatePath("/pos");
  return { ok: true, job: updated };
}

export async function finishPrintJob(
  jobId: string,
  status: Extract<PrintJobStatus, "printed" | "failed">,
  message?: string,
) {
  await requirePos();
  if (status !== "printed" && status !== "failed") {
    return { error: "Invalid print job status." };
  }
  let error: string | undefined;
  let updated: PrintJob | null = null;

  await updateStore((store) => {
    const job = store.printJobs.find((entry) => entry.id === jobId);
    if (!job) {
      error = "Print job not found.";
      return;
    }
    if (job.status === "cancelled") {
      error = "A cancelled print job cannot be updated.";
      return;
    }

    const now = new Date().toISOString();
    job.status = status;
    job.updatedAt = now;
    if (status === "printed") {
      job.printedAt = now;
      delete job.lastError;
    } else {
      job.lastError = (message || "Printer failed.").trim().slice(0, 240);
    }
    updated = { ...job, label: job.label ? { ...job.label } : undefined };
  });

  if (error || !updated) return { error: error ?? "Unable to update print job." };
  revalidatePath("/pos");
  return { ok: true, job: updated };
}

export async function queueReprintJobs(
  orderId: string,
  type: PrintJobType,
  sourceLabelJobId?: string,
) {
  await requirePos();
  if (type !== "cup-label" && type !== "customer-receipt") {
    return { error: "Invalid print job type." };
  }
  let error: string | undefined;
  let created: PrintJob[] = [];

  await updateStore((store) => {
    const order = store.orders.find((entry) => entry.id === orderId);
    if (!order || order.voided) {
      error = "Completed order not found.";
      return;
    }

    const createdAt = new Date().toISOString();
    if (type === "customer-receipt") {
      created = [
        {
          id: reprintId(order.id, type),
          orderId: order.id,
          type,
          status: "pending",
          attempts: 0,
          createdAt,
          updatedAt: createdAt,
        },
      ];
    } else if (sourceLabelJobId) {
      const source = store.printJobs.find(
        (job) =>
          job.id === sourceLabelJobId &&
          job.orderId === order.id &&
          job.type === "cup-label" &&
          job.label,
      );
      if (!source?.label) {
        error = "Cup label job not found.";
        return;
      }
      created = [
        {
          id: reprintId(order.id, type),
          orderId: order.id,
          type,
          status: "pending",
          attempts: 0,
          createdAt,
          updatedAt: createdAt,
          label: { ...source.label },
        },
      ];
    } else {
      created = labelJobsForOrder(
        order,
        store.menu,
        reprintId(order.id, type),
        createdAt,
      );
      if (created.length === 0) {
        error = "This order has no cup labels.";
        return;
      }
    }

    store.printJobs.push(...created);
  });

  if (error) return { error };
  revalidatePath("/pos");
  return { ok: true, printJobs: created };
}