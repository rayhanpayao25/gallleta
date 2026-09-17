"use client";

import { useState, useEffect, useTransition } from "react";
import { approveVoidRequest } from "@/actions/pos";
import { formatMoney, orderLineListLabel } from "@/lib/menu";
import { phDateTimeLabel } from "@/lib/datetime";
import { paymentLabel } from "@/lib/payments";
import { ingredientsForOrderLine } from "@/lib/inventory";
import {
  bestSellers,
  busiestDay,
  cafeHours,
  categorySales,
  lastNDays,
  liveOrders,
  lowSellers,
  ordersOnDay,
  paymentStats,
  productStats,
  drinkProductStats,
  salesByHour,
  salesByYearMonths,
  sumSales,
  unitsSold,
} from "@/lib/analytics";
import type { Order, StoreData } from "@/lib/types";

type CustomEntry = {
  id: string;
  title: string;
  reason: string;
  amount: number;
  date: string;
};

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
      <p className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
        {label}
      </p>
      <p className="mt-2 break-words text-xl font-semibold sm:mt-3 sm:text-3xl">{value}</p>
      {hint ? <p className="mt-2 text-xs leading-relaxed text-neutral-500">{hint}</p> : null}
    </div>
  );
}

function VerticalBars({
  items,
}: {
  items: { key: string; label: string; value: number; caption: string; display: string }[];
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="mt-6 flex h-64 items-end gap-2 pb-6 overflow-x-auto">
      {items.map((item, idx) => (
        <div key={`${item.key}-${idx}`} className="flex min-w-[32px] flex-1 flex-col items-center h-full justify-end">
          <p className="mb-2 text-[10px] text-neutral-400 whitespace-nowrap">{item.display}</p>
          <div className="flex w-full items-end flex-1">
            <div
              className="w-full bg-black"
              style={{ height: `${Math.max((item.value / max) * 100, item.value > 0 ? 6 : 0)}%` }}
              title={item.display}
            />
          </div>
          <span className="mt-2 text-[11px] font-medium text-neutral-700 whitespace-nowrap truncate max-w-full">{item.label}</span>
          <span className="text-[10px] text-neutral-500 whitespace-nowrap">{item.caption}</span>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({
  items,
  empty,
}: {
  items: { key: string; label: string; value: number; left: string; right: string }[];
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="mt-6 text-sm text-neutral-500">{empty}</p>;
  }
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className="mt-5 space-y-3">
      {items.map((item, idx) => (
        <li key={`${item.key}-${idx}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 text-neutral-500">{item.right}</span>
          </div>
          <div className="mt-1.5 h-2 bg-neutral-200">
            <div
              className="h-full bg-black"
              style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 4 : 0)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">{item.left}</p>
        </li>
      ))}
    </ul>
  );
}

function formatDateStr(date: Date) {
  return date.toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toInputDateStr(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isVoided(order: Order) {
  return Boolean(order.voided) || Boolean(order.voidReason?.trim());
}

function orderIdLabel(order: Order) {
  return order.ticketNo != null ? `#${order.ticketNo}` : order.id;
}

function entryInPeriod(dateStr: string, start: Date, end: Date) {
  const dayStart = new Date(`${dateStr}T00:00:00+08:00`).getTime();
  const dayEnd = new Date(`${dateStr}T23:59:59.999+08:00`).getTime();
  if (Number.isNaN(dayStart) || Number.isNaN(dayEnd)) return false;
  return dayStart <= end.getTime() && dayEnd >= start.getTime();
}

export function AdminDashboard({ store }: { store: StoreData }) {
  const [isClient, setIsClient] = useState(false);
  const [filterDateStr, setFilterDateStr] = useState("");
  const [rangeType, setRangeType] = useState<string>("today");
  const [activeFilterMode, setActiveFilterMode] = useState<"range" | "date">("range");
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [approvalPending, startApprovalTransition] = useTransition();
  const [drinksOpen, setDrinksOpen] = useState(true);
  const [ordersOpen, setOrdersOpen] = useState(true);

  const [expenses, setExpenses] = useState<CustomEntry[]>([]);
  const [credits, setCredits] = useState<CustomEntry[]>([]);

  useEffect(() => {
    setIsClient(true);
    const today = new Date();
    setFilterDateStr(toInputDateStr(today));

    const savedExpenses = localStorage.getItem("cafe_expenses");
    if (savedExpenses) {
      try { setExpenses(JSON.parse(savedExpenses)); } catch (e) {}
    }

    const savedCredits = localStorage.getItem("cafe_credits");
    if (savedCredits) {
      try { setCredits(JSON.parse(savedCredits)); } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (isClient) {
      localStorage.setItem("cafe_expenses", JSON.stringify(expenses));
    }
  }, [expenses, isClient]);

  useEffect(() => {
    if (isClient) {
      localStorage.setItem("cafe_credits", JSON.stringify(credits));
    }
  }, [credits, isClient]);

  const [newExpTitle, setNewExpTitle] = useState("");
  const [newExpReason, setNewExpReason] = useState("");
  const [newExpAmount, setNewExpAmount] = useState("");

  const [newCredTitle, setNewCredTitle] = useState("");
  const [newCredReason, setNewCredReason] = useState("");
  const [newCredAmount, setNewCredAmount] = useState("");

  let now = new Date();
  const startOfPeriod = new Date();

  const isTodaySelected = activeFilterMode === "date" || (activeFilterMode === "range" && rangeType === "today");

  if (activeFilterMode === "date" && filterDateStr) {
    now = new Date(`${filterDateStr}T23:59:59+08:00`);
    startOfPeriod.setTime(now.getTime());
    startOfPeriod.setHours(0, 0, 0, 0);
  } else {
    now = new Date();
    startOfPeriod.setTime(now.getTime());
    
    if (rangeType === "today") {
      startOfPeriod.setHours(0, 0, 0, 0);
    } else if (rangeType === "week") {
      startOfPeriod.setDate(now.getDate() - 6);
      startOfPeriod.setHours(0, 0, 0, 0);
    } else if (rangeType === "lastWeek") {
      const dayOfWeek = now.getDay();
      const diffToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() - diffToLastMonday - 7);
      lastMonday.setHours(0, 0, 0, 0);

      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      lastSunday.setHours(23, 59, 59, 999);

      startOfPeriod.setTime(lastMonday.getTime());
      now.setTime(lastSunday.getTime());
    } else if (rangeType === "month") {
      startOfPeriod.setDate(1);
      startOfPeriod.setHours(0, 0, 0, 0);
    } else if (rangeType === "lastMonth") {
      startOfPeriod.setMonth(now.getMonth() - 1);
      startOfPeriod.setDate(1);
      startOfPeriod.setHours(0, 0, 0, 0);
      now.setDate(0);
      now.setHours(23, 59, 59, 999);
    } else if (rangeType === "thisYear") {
      startOfPeriod.setMonth(0, 1);
      startOfPeriod.setHours(0, 0, 0, 0);
    } else if (rangeType === "lastYear") {
      const prevYear = now.getFullYear() - 1;
      startOfPeriod.setFullYear(prevYear, 0, 1);
      startOfPeriod.setHours(0, 0, 0, 0);
      now.setFullYear(prevYear, 11, 31);
      now.setHours(23, 59, 59, 999);
    }
  }

  const todayDateStr = formatDateStr(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterdayDateStr = formatDateStr(yesterdayDate);

  const today = ordersOnDay(store.orders, now);
  const yesterday = ordersOnDay(store.orders, yesterdayDate);
  const week = lastNDays(store.orders, 7, now);
  const currentWeekStart = new Date(now);
  currentWeekStart.setDate(now.getDate() - 6);
  const currentWeekRangeStr = `${formatDateStr(currentWeekStart)} – ${todayDateStr}`;

  let trackingItems: { key: string; label: string; value: number; caption: string; display: string }[] = [];
  let trackingTitle = "Sales tracking";
  let trackingSubtitle = "";

  if (rangeType === "month" || rangeType === "lastMonth") {
    const daysInMonth = rangeType === "month" ? now.getDate() : 30;
    const monthDays = lastNDays(store.orders, daysInMonth, now);
    trackingTitle = `Sales tracking · ${rangeType === "month" ? "This Month" : "Last Month"}`;
    trackingItems = monthDays.map((d) => ({
      key: d.date,
      label: d.label.split(",")[0],
      value: d.sales,
      display: formatMoney(d.sales),
      caption: `${d.orders} tix`,
    }));
  } else if (rangeType === "thisYear") {
    trackingTitle = "Sales tracking · This Year (Monthly)";
    const yearMonths = salesByYearMonths(store.orders);
    trackingItems = yearMonths.map((m) => ({
      key: m.key,
      label: m.label,
      value: m.sales,
      display: m.sales > 0 ? formatMoney(m.sales) : "",
      caption: `${m.orders} tix`,
    }));
  } else if (rangeType === "lastYear") {
    trackingTitle = "Sales tracking · Last Year (Monthly)";
    const targetYear = now.getFullYear();
    const yearMonths = salesByYearMonths(store.orders, targetYear);
    trackingItems = yearMonths.map((m) => ({
      key: m.key,
      label: m.label,
      value: m.sales,
      display: m.sales > 0 ? formatMoney(m.sales) : "",
      caption: `${m.orders} tix`,
    }));
  } else if (rangeType === "week" || rangeType === "lastWeek") {
    trackingTitle = rangeType === "lastWeek" ? "Sales tracking · Last Week" : "Sales tracking · 7 days";
    trackingSubtitle = currentWeekRangeStr;
    const targetWeekDays = lastNDays(store.orders, 7, now);
    trackingItems = targetWeekDays.map((day) => ({
      key: day.date,
      label: day.label,
      value: day.sales,
      display: formatMoney(day.sales),
      caption: `${day.orders} tix`,
    }));
  }

  const filteredOrdersList = liveOrders(store.orders).filter((order) => {
    const orderTime = new Date(order.createdAt).getTime();
    return orderTime >= startOfPeriod.getTime() && orderTime <= now.getTime();
  });

  const productStatsList = productStats(filteredOrdersList, store.menu);
  const best = bestSellers(productStatsList, 5);
  const low = lowSellers(productStatsList, 5);
  const drinkStyles = new Map<string, { iced: number; hot: number }>();
  for (const order of filteredOrdersList) {
    for (const line of order.items) {
      const current = drinkStyles.get(line.productId) ?? { iced: 0, hot: 0 };
      if (line.style === "iced") current.iced += line.qty;
      else if (line.style === "hot") current.hot += line.qty;
      drinkStyles.set(line.productId, current);
    }
  }
  const drinkSoldRows = drinkProductStats(productStatsList)
    .filter((item) => item.qty > 0)
    .map((item) => ({
      ...item,
      iced: drinkStyles.get(item.id)?.iced ?? 0,
      hot: drinkStyles.get(item.id)?.hot ?? 0,
    }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  
  const categories = categorySales(drinkProductStats(productStatsList)).filter((item) => item.qty > 0);
  
  // Custom mapping para siguraduhing ang bibilangin ay ang total item quantity sa halip na order count lang
  const rawHours = salesByHour(filteredOrdersList, now, rangeType === "week" && activeFilterMode === "range" ? 7 : 1);
  const updatedHoursMap = rawHours.map(slot => {
    const slotOrders = filteredOrdersList.filter(o => {
      const orderHour = new Date(o.createdAt).getHours();
      return orderHour === slot.hour;
    });
    const totalQtyInHour = slotOrders.reduce((acc, order) => {
      return acc + order.items.reduce((sum, item) => sum + item.qty, 0);
    }, 0);
    return {
      ...slot,
      orders: totalQtyInHour, // Ginagamit na natin ang actual item quantity
    };
  });

  const hours = cafeHours(updatedHoursMap);
  const peak = hours.reduce(
    (bestHour, slot) => (slot.orders > bestHour.orders ? slot : bestHour),
    hours[0],
  );

  const busy = busiestDay(week);
  
  const payments = paymentStats(filteredOrdersList);
  const totalSalesAmount = sumSales(filteredOrdersList);
  const periodExpenses = expenses.filter((entry) => entryInPeriod(entry.date, startOfPeriod, now));
  const periodCredits = credits.filter((entry) => entryInPeriod(entry.date, startOfPeriod, now));
  const totalExpensesAmount = periodExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalCreditsAmount = periodCredits.reduce((sum, c) => sum + c.amount, 0);
  const todayStr = toInputDateStr(new Date());
  const canEditLedgers =
    (activeFilterMode === "range" && rangeType === "today") ||
    (activeFilterMode === "date" && filterDateStr === todayStr);

  const netProfitOrLoss = totalSalesAmount - (totalExpensesAmount + totalCreditsAmount);

  const drinksQty = drinkProductStats(productStatsList).reduce((sum, item) => sum + item.qty, 0);
  const drinksSales = drinkProductStats(productStatsList).reduce((sum, item) => sum + item.sales, 0);
  const foodSales = productStatsList
    .filter((item) => /food/i.test(item.category) && !/pastr/i.test(item.category))
    .reduce((sum, item) => sum + item.sales, 0);
  const pastriesSales = productStatsList
    .filter((item) => /pastr/i.test(item.category))
    .reduce((sum, item) => sum + item.sales, 0);
  const foodQty = productStatsList
    .filter((item) => /food/i.test(item.category) && !/pastr/i.test(item.category))
    .reduce((sum, item) => sum + item.qty, 0);
  const pastryQty = productStatsList
    .filter((item) => /pastr/i.test(item.category))
    .reduce((sum, item) => sum + item.qty, 0);
  const totalSoldQty = drinksQty + foodQty + pastryQty;
  const costByCategory = filteredOrdersList.reduce((totals, order) => {
    order.items.forEach((line) => {
      const menuItem = store.menu.find((item) => item.id === line.productId) ?? store.menu.find((item) => item.name.trim().toLowerCase() === line.name.trim().toLowerCase());
      const category = menuItem?.category ?? "Other";
      const lineCost = ingredientsForOrderLine(store, line).reduce((sum, ingredient) => {
        const inventoryItem = store.inventory.find((item) => item.id === ingredient.inventoryItemId);
        if (!inventoryItem) return sum;
        const packSize = Number(inventoryItem.purchaseUnitSize) || Number(inventoryItem.cupsMake) || 1;
        return sum + (Number(ingredient.amount) / packSize) * Number(inventoryItem.cost || 0) * line.qty;
      }, 0);
      const normalizedCategory = category.replace(/[^a-z]/gi, "").toLowerCase();
      const key = /pastr/.test(normalizedCategory)
        ? "pastries"
        : /food/.test(normalizedCategory)
          ? "food"
          : /drink|coffee|beverage|tea/.test(normalizedCategory)
            ? "drinks"
            : null;
      if (key) totals[key] += lineCost;
    });
    return totals;
  }, { drinks: 0, food: 0, pastries: 0 });
  const totalCost = costByCategory.drinks + costByCategory.food + costByCategory.pastries;

  const computedAverageTicket = filteredOrdersList.length > 0 
    ? totalSalesAmount / filteredOrdersList.length 
    : 0;

  const latest = [...store.orders]
    .filter((order) => {
      const orderTime = new Date(order.createdAt).getTime();
      return orderTime >= startOfPeriod.getTime() && orderTime <= now.getTime();
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingVoidRequests = (store.voidRequests ?? []).filter(
    (request) => request.status === "pending",
  );

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditLedgers || !newExpTitle || !newExpAmount) return;
    const item: CustomEntry = {
      id: String(Date.now()),
      title: newExpTitle,
      reason: newExpReason,
      amount: parseFloat(newExpAmount) || 0,
      date: toInputDateStr(new Date()),
    };
    setExpenses([item, ...expenses]);
    setNewExpTitle("");
    setNewExpReason("");
    setNewExpAmount("");
  };

  const handleDeleteExpense = (id: string) => {
    if (!canEditLedgers) return;
    const entry = expenses.find((ex) => ex.id === id);
    if (!entry || entry.date !== todayStr) return;
    setExpenses(expenses.filter((ex) => ex.id !== id));
  };

  const handleAddCredit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditLedgers || !newCredTitle || !newCredAmount) return;
    const item: CustomEntry = {
      id: String(Date.now()),
      title: newCredTitle,
      reason: newCredReason,
      amount: parseFloat(newCredAmount) || 0,
      date: toInputDateStr(new Date()),
    };
    setCredits([item, ...credits]);
    setNewCredTitle("");
    setNewCredReason("");
    setNewCredAmount("");
  };

  const handleDeleteCredit = (id: string) => {
    if (!canEditLedgers) return;
    const entry = credits.find((cr) => cr.id === id);
    if (!entry || entry.date !== todayStr) return;
    setCredits(credits.filter((cr) => cr.id !== id));
  };

  if (!isClient) {
    return <div className="p-8 text-center text-neutral-500">Loading dashboard...</div>;
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 px-3 py-5 sm:space-y-10 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs tracking-[0.3em] text-neutral-500 uppercase">
            Sales analysis
          </p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
            Track every ticket
          </h1>
        </div>

        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto">
          <div 
            className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 shadow-sm transition sm:py-1.5 ${
              activeFilterMode === "range" 
                ? "bg-white border-black ring-1 ring-black" 
                : "bg-white border-neutral-300 opacity-75"
            }`}
          >
            <span className="shrink-0 text-xs font-medium text-neutral-500">Range:</span>
            <select
              value={rangeType}
              onChange={(e) => {
                setRangeType(e.target.value);
                setActiveFilterMode("range");
              }}
              onClick={() => setActiveFilterMode("range")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none cursor-pointer"
            >
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="lastWeek">Last Week</option>
              <option value="month">This Month</option>
              <option value="lastMonth">Last Month</option>
              <option value="thisYear">This Year</option>
              <option value="lastYear">Last Year</option>
            </select>
          </div>

          <div 
            className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 shadow-sm transition sm:py-1.5 ${
              activeFilterMode === "date" 
                ? "bg-white border-black ring-1 ring-black" 
                : "bg-white border-neutral-300 opacity-75"
            }`}
          >
            <span className="shrink-0 text-xs font-medium text-neutral-500">Date:</span>
            <input
              type="date"
              value={filterDateStr}
              onChange={(e) => {
                setFilterDateStr(e.target.value);
                setActiveFilterMode("date");
              }}
              onClick={() => setActiveFilterMode("date")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none cursor-pointer"
            />
          </div>

          <p
            className={`w-fit rounded-full px-4 py-2 text-sm ${
              store.pos.isOpen
                ? "bg-black text-white"
                : "border border-neutral-300 text-neutral-600"
            }`}
          >
            POS {store.pos.isOpen ? "open" : "closed"}
            {store.pos.openedBy ? ` · ${store.pos.openedBy}` : ""}
          </p>
        </div>
      </div>

      {pendingVoidRequests.length > 0 ? (
        <section className="border border-neutral-300 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-neutral-200 pb-3">
            <div>
              <p className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
                Void approvals
              </p>
              <h2 className="mt-1 text-lg font-semibold">Requests waiting for admin</h2>
            </div>
            <span className="rounded-full bg-black px-3 py-1 text-xs font-medium text-white">
              {pendingVoidRequests.length} pending
            </span>
          </div>

          {approvalMessage ? (
            <p className="mt-3 text-sm text-neutral-600">{approvalMessage}</p>
          ) : null}

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {pendingVoidRequests.map((request) => (
              <article key={request.id} className="border border-neutral-200 bg-neutral-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{request.requestedByName}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {phDateTimeLabel(request.requestedAt)}
                      {request.orderId ? " · Existing ticket" : " · Current checkout"}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">{formatMoney(request.total)}</p>
                </div>
                <p className="mt-3 text-sm text-neutral-700">
                  {request.items.map((item) => `${item.qty}× ${orderLineListLabel(item)}`).join(", ")}
                </p>
                <p className="mt-2 text-xs text-neutral-500">
                  Reason: {request.reason}
                </p>
                <button
                  type="button"
                  disabled={approvalPending}
                  onClick={() =>
                    startApprovalTransition(async () => {
                      const result = await approveVoidRequest(request.id);
                      if ("error" in result && result.error) {
                        setApprovalMessage(result.error);
                        return;
                      }
                      setApprovalMessage(`Void approved for ${request.requestedByName}.`);
                    })
                  }
                  className="mt-4 w-full rounded-lg bg-black px-4 py-2.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
                >
                  {approvalPending ? "Processing..." : "Approve void"}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-6">
        <div className="border-b border-neutral-200 pb-3">
          <h2 className="text-xs tracking-[0.25em] text-neutral-500 uppercase">
            Performance Overview
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {isTodaySelected ? (
            <>
              <Metric
                label="Today's Sales"
                value={formatMoney(sumSales(today))}
              />
              <Metric
                label="Today's Orders"
                value={String(today.length)}
              />
            </>
          ) : (
            <>
              <Metric
                label="Period Sales"
                value={formatMoney(filteredOrdersList.reduce((s, o) => s + o.total, 0))}
              />
              <Metric 
                label="Period Orders" 
                value={String(filteredOrdersList.length)} 
              />
            </>
          )}

          <Metric
            label="Average Ticket"
            value={formatMoney(computedAverageTicket)}
          />

          <div className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
            <p className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
              Sold Products
            </p>
            <div className="mt-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Drinks</p>
                  <p className="text-xs text-neutral-500">{formatMoney(drinksSales)}</p>
                </div>
                <p className="text-2xl font-semibold sm:text-3xl">{drinksQty}</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Food</p>
                  <p className="text-xs text-neutral-500">{formatMoney(foodSales)}</p>
                </div>
                <p className="text-2xl font-semibold sm:text-3xl">{foodQty}</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Pastries</p>
                  <p className="text-xs text-neutral-500">{formatMoney(pastriesSales)}</p>
                </div>
                <p className="text-2xl font-semibold sm:text-3xl">{pastryQty}</p>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-3">
                <div>
                  <p className="text-sm font-semibold">Total Sold</p>
                  <p className="text-xs text-neutral-500">{formatMoney(drinksSales + foodSales + pastriesSales)}</p>
                </div>
                <p className="text-2xl font-semibold sm:text-3xl">{totalSoldQty}</p>
              </div>
            </div>
          </div>

          <Metric
            label="Peak Hour"
            value={peak && peak.orders > 0 ? peak.label : "—"}
          />

          {rangeType === "week" && (
            <Metric
              label="Busiest Day"
              value={busy?.label ?? "—"}
            />
          )}
        </div>
      </section>

      <section className="border border-neutral-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
              Net Summary (Revenue - Expenses - Credits)
            </p>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
              {formatMoney(netProfitOrLoss)}
            </h2>
          </div>
          <div className="text-left text-xs text-neutral-500 space-y-1 sm:text-right">
            <p>Total Revenue: <span className="font-medium text-black">{formatMoney(totalSalesAmount)}</span></p>
            <p>Total Expenses: <span className="font-medium text-black">{formatMoney(totalExpensesAmount)}</span></p>
            <p>Total Credits: <span className="font-medium text-black">{formatMoney(totalCreditsAmount)}</span></p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {!isTodaySelected && (
          <div className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
                {trackingTitle}
              </h2>
              <span className="text-[11px] text-neutral-400">{trackingSubtitle}</span>
            </div>
            <VerticalBars items={trackingItems} />
          </div>
        )}

        <div className={`min-w-0 border border-neutral-200 bg-white p-4 sm:p-5 ${isTodaySelected ? "lg:col-span-2" : ""}`}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
              Peak hours <span className="hidden sm:inline">(by item volume) · 10:00 AM – 12:00 AM</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <VerticalBars
                items={hours.map((slot) => ({
                  key: String(slot.hour),
                  label: slot.label,
                  value: slot.orders,
                  display: slot.orders > 0 ? `${slot.orders} items` : "",
                  caption: "",
                }))}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
          <h2 className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
            Best selling drinks
          </h2>
          
          <HorizontalBars
            empty="No drinks sold in this period."
            items={best.map((item) => ({
              key: item.id,
              label: item.name,
              value: item.qty,
              left: `${item.qty} sold`,
              right: formatMoney(item.sales),
            }))}
          />
        </div>

        <div className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
          <h2 className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
            Low selling drinks
          </h2>
          <HorizontalBars
            empty="No drinks found in menu."
            items={low.map((item) => ({
              key: item.id,
              label: item.name,
              value: item.qty,
              left: item.qty === 0 ? "No sales" : `${item.qty} sold`,
              right: formatMoney(item.sales),
            }))}
          />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
          <h2 className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
            Sales by category (by item quantity)
          </h2>
          <HorizontalBars
            empty="No category sales in this period."
            items={categories
              .sort((a, b) => b.qty - a.qty)
              .map((item) => ({
                key: item.name,
                label: item.name,
                value: item.qty,
                left: `${item.qty} items`,
                right: item.sales ? formatMoney(item.sales) : '₱0.00',
              }))}
          />
        </div>

        <div className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
          <h2 className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
            Payment Mix (Total Breakdown)
          </h2>
          <p className="mt-1 text-[11px] text-neutral-400">Total Collections Breakdown</p>
          <div className="mt-4 space-y-3">
            {payments.map((p, pIdx) => (
              <div key={`${p.method}-${pIdx}`} className="flex justify-between items-center text-sm border-b border-neutral-100 pb-2">
                <div>
                  <p className="font-medium">{p.label}</p>
                  <p className="text-xs text-neutral-500">{p.count} transactions</p>
                </div>
                <span className="font-semibold">{formatMoney(p.sales)}</span>
              </div>
            ))}
            <div className="flex justify-between items-center text-sm font-bold pt-2 border-t border-neutral-200">
              <span>Total Revenue:</span>
              <span>{formatMoney(totalSalesAmount)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 border border-neutral-200 bg-white p-4 space-y-4 sm:p-5">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xs tracking-[0.25em] text-neutral-500 uppercase">Expenses Tracker</h2>
              <p className="text-sm font-semibold mt-1">Total: {formatMoney(totalExpensesAmount)}</p>
            </div>
          </div>

          {canEditLedgers ? (
          <form onSubmit={handleAddExpense} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-neutral-100">
            <input
              type="text"
              placeholder="Expense title..."
              value={newExpTitle}
              onChange={(e) => setNewExpTitle(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-1.5 text-sm outline-none focus:border-black"
            />
            <input
              type="text"
              placeholder="Reason..."
              value={newExpReason}
              onChange={(e) => setNewExpReason(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-1.5 text-sm outline-none focus:border-black"
            />
            <input
              type="number"
              placeholder="Amount (₱)"
              value={newExpAmount}
              onChange={(e) => setNewExpAmount(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-1.5 text-sm outline-none focus:border-black"
            />
            <button
              type="submit"
              className="sm:col-span-3 bg-black text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 transition"
            >
              Add Expense
            </button>
          </form>
          ) : null}

          <div className="overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-400 text-xs border-b border-neutral-100">
                <tr>
                  <th className="py-2">Title</th>
                  <th className="py-2">Reason</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {periodExpenses.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-neutral-400 text-xs">No expenses in this range.</td></tr>
                ) : (
                  periodExpenses.map((ex, exIdx) => (
                    <tr key={`${ex.id}-${exIdx}`} className="border-b border-neutral-50 text-xs">
                      <td className="py-2">{ex.title}</td>
                      <td className="py-2 text-neutral-500">{ex.reason || "—"}</td>
                      <td className="py-2 text-right font-medium">{formatMoney(ex.amount)}</td>
                      <td className="py-2 text-right">
                        {canEditLedgers && ex.date === todayStr ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteExpense(ex.id)}
                            className="text-red-500 hover:text-red-700 font-medium px-2 py-1"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-w-0 border border-neutral-200 bg-white p-4 space-y-4 sm:p-5">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xs tracking-[0.25em] text-neutral-500 uppercase">Credits</h2>
              <p className="text-sm font-semibold mt-1">Total: {formatMoney(totalCreditsAmount)}</p>
            </div>
          </div>

          {canEditLedgers ? (
          <form onSubmit={handleAddCredit} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-neutral-100">
            <input
              type="text"
              placeholder="Credit title..."
              value={newCredTitle}
              onChange={(e) => setNewCredTitle(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-1.5 text-sm outline-none focus:border-black"
            />
            <input
              type="text"
              placeholder="Reason..."
              value={newCredReason}
              onChange={(e) => setNewCredReason(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-1.5 text-sm outline-none focus:border-black"
            />
            <input
              type="number"
              placeholder="Amount (₱)"
              value={newCredAmount}
              onChange={(e) => setNewCredAmount(e.target.value)}
              className="border border-neutral-300 rounded px-3 py-1.5 text-sm outline-none focus:border-black"
            />
            <button
              type="submit"
              className="sm:col-span-3 bg-black text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 transition"
            >
              Add Credit
            </button>
          </form>
          ) : null}

          <div className="overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-400 text-xs border-b border-neutral-100">
                <tr>
                  <th className="py-2">Title</th>
                  <th className="py-2">Reason</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {periodCredits.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-neutral-400 text-xs">No credits in this range.</td></tr>
                ) : (
                  periodCredits.map((cr, crIdx) => (
                    <tr key={`${cr.id}-${crIdx}`} className="border-b border-neutral-50 text-xs">
                      <td className="py-2">{cr.title}</td>
                      <td className="py-2 text-neutral-500">{cr.reason || "—"}</td>
                      <td className="py-2 text-right font-medium">{formatMoney(cr.amount)}</td>
                      <td className="py-2 text-right">
                        {canEditLedgers && cr.date === todayStr ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteCredit(cr.id)}
                            className="text-red-500 hover:text-red-700 font-medium px-2 py-1"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="text-neutral-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
            Drinks sold
          </h2>
          <button
            type="button"
            onClick={() => setDrinksOpen((open) => !open)}
            className="rounded border border-neutral-300 px-2 py-1 text-[10px] font-medium tracking-wide text-neutral-600 uppercase transition hover:border-black hover:text-black"
          >
            {drinksOpen ? "Minimize" : "Expand"}
          </button>
        </div>
        {drinksOpen ? (
          <>
            {drinkSoldRows.length === 0 ? (
              <p className="mt-4 py-6 text-center text-sm text-neutral-500">
                No drinks sold in this range.
              </p>
            ) : (
              <div className="mt-4">
                <div className="hidden grid-cols-5 gap-x-4 border-b border-neutral-200 pb-2 text-xs text-neutral-500 sm:grid">
                  <p className="min-w-0">Drink</p>
                  <p className="min-w-0 text-right">Iced</p>
                  <p className="min-w-0 text-right">Hot</p>
                  <p className="min-w-0 text-right">Sold</p>
                  <p className="min-w-0 text-right">Sales</p>
                </div>
                <div className="divide-y divide-neutral-200">
                  {drinkSoldRows.map((item) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-5 sm:items-start sm:gap-x-4"
                    >
                      <p className="min-w-0 text-sm font-medium">{item.name}</p>
                      <p className="min-w-0 text-sm text-neutral-600 sm:text-right">
                        <span className="sm:hidden">Iced: </span>
                        {item.iced}
                      </p>
                      <p className="min-w-0 text-sm text-neutral-600 sm:text-right">
                        <span className="sm:hidden">Hot: </span>
                        {item.hot}
                      </p>
                      <p className="min-w-0 text-sm text-neutral-700 sm:text-right">{item.qty}</p>
                      <p className="min-w-0 text-sm font-semibold sm:text-right">
                        {formatMoney(item.sales)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </section>

      <section className="min-w-0 border border-neutral-200 bg-white p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-[10px] tracking-[0.2em] text-neutral-500 uppercase sm:text-xs sm:tracking-[0.25em]">
            Recent orders
          </h2>
          <button
            type="button"
            onClick={() => setOrdersOpen((open) => !open)}
            className="rounded border border-neutral-300 px-2 py-1 text-[10px] font-medium tracking-wide text-neutral-600 uppercase transition hover:border-black hover:text-black"
          >
            {ordersOpen ? "Minimize" : "Expand"}
          </button>
        </div>
        {ordersOpen ? (
          latest.length === 0 ? (
            <p className="mt-4 py-6 text-center text-sm text-neutral-500">
              No recent orders found for the selected range.
            </p>
          ) : (
          <div className="mt-4">
            <div className="hidden grid-cols-8 gap-x-4 border-b border-neutral-200 pb-2 text-xs text-neutral-500 lg:grid">
              <p className="min-w-0">Time</p>
              <p className="min-w-0">Cashier</p>
              <p className="min-w-0">Order ID</p>
              <p className="min-w-0">Items</p>
              <p className="min-w-0">Status</p>
              <p className="min-w-0">Reason</p>
              <p className="min-w-0">Payment</p>
              <p className="min-w-0 text-right">Total</p>
            </div>
            <div className="divide-y divide-neutral-200">
              {latest.map((order: Order, ordIdx: number) => (
                <div
                  key={`${order.id}-${ordIdx}`}
                  className="grid grid-cols-1 gap-2 py-3 lg:grid-cols-8 lg:items-start lg:gap-x-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm leading-5 text-neutral-700">
                      {new Date(order.createdAt).toLocaleString("en-US", {
                        timeZone: "Asia/Manila",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500 lg:hidden">{order.baristaName}</p>
                    {isVoided(order) ? (
                      <p className="mt-0.5 text-sm font-medium text-neutral-400 line-through lg:hidden">
                        {orderIdLabel(order)}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-sm font-medium lg:hidden">{orderIdLabel(order)}</p>
                    )}
                  </div>
                  <p className="hidden min-w-0 break-words text-sm text-neutral-700 lg:block">
                    {order.baristaName}
                  </p>
                  <p className="hidden min-w-0 text-sm font-medium lg:block">
                    {isVoided(order) ? (
                      <span className="text-neutral-400 line-through">{orderIdLabel(order)}</span>
                    ) : (
                      orderIdLabel(order)
                    )}
                  </p>
                  <ul className="min-w-0 list-disc space-y-1 pl-4 text-xs leading-relaxed text-neutral-600 lg:text-sm">
                    {order.items.map((item, itemIdx) => (
                      <li key={`${order.id}-${item.productId}-${itemIdx}`} className="break-words">
                        {item.qty}× {orderLineListLabel(item)}
                      </li>
                    ))}
                  </ul>
                  <div className="min-w-0">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-[10px] font-medium lg:text-xs ${
                        isVoided(order)
                          ? "bg-red-100 text-red-700"
                          : "bg-black text-white"
                      }`}
                    >
                      {isVoided(order) ? "Void" : "Completed"}
                    </span>
                  </div>
                  <p className="min-w-0 break-words text-xs text-neutral-500 lg:text-sm">
                    <span className="lg:hidden">Reason: </span>
                    {isVoided(order) ? order.voidReason?.trim() || "—" : "—"}
                  </p>
                  <p className="min-w-0 text-xs text-neutral-500 lg:text-sm">
                    <span className="lg:hidden">Payment: </span>
                    {paymentLabel(order.paymentMethod)}
                  </p>
                  <p className="min-w-0 text-sm font-semibold lg:text-right">
                    <span className="font-normal text-neutral-500 lg:hidden">Total: </span>
                    {formatMoney(order.total)}
                  </p>
                </div>
              ))}
            </div>
          </div>
          )
        ) : null}
      </section>
    </div>
  );
}
