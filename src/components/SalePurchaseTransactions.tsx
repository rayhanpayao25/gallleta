import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createRestock, deleteAdminRecord, deleteRestock, saveAdminData } from "@/actions/pos";
import { costingIngredientForItem, cupsFromQuantity, formatQty, ingredientsForOrderLine, itemNameEquals, looksLikeCupItem, matchesInventoryRow, perCupAmount, remainingForUsages, roundQty, stockLedgerForRange } from "@/lib/inventory";
import { phDateString, phDateTimeLabel, phIsoFromDate, phPeriodBounds, type PeriodRange } from "@/lib/datetime";
import { isFoodOrPastry, orderSoldAsLabel, orderSoldAsLines, orderSoldAsParts } from "@/lib/menu";
import type { Order, RecipeIngredient, StoreData } from "@/lib/types";

function inventoryUsagePerPiece(item: StockItem, used: number) {
  const unitSize = Number(item.purchaseUnitSize);
  return unitSize > 0 ? `${(used / unitSize).toFixed(2)} pc` : "—";
}

function configuredUsagePerUnit(item: StockItem) {
  const usage = Number(item.cupUsageAmount);
  return usage > 0 ? usage : 0;
}

function configuredCupsLeft(item: StockItem, remaining: number) {
  const usage = configuredUsagePerUnit(item);
  return usage > 0 ? remaining / usage : null;
}

function pieceSize(item: Pick<StockItem, "purchaseUnitSize">) {
  const size = Number(item.purchaseUnitSize);
  return size > 0 ? size : 1;
}

function toPieceQuantity(item: Pick<StockItem, "purchaseUnitSize">, amount: number) {
  return amount / pieceSize(item);
}

function toBaseQuantity(item: Pick<StockItem, "purchaseUnitSize">, pieces: number) {
  return pieces * pieceSize(item);
}

export type InventoryTab = "transactions" | "stock" | "restock" | "costing" | "used" | "units" | "recipes";

type InventoryStore = Pick<
  StoreData,
  "orders" | "inventory" | "usageLogs" | "restocks" | "costings"
> & Partial<Pick<StoreData, "recipes" | "recipeCostings" | "menu">>;

type SalePurchaseTransactionsProps = {
  store: InventoryStore;
  tabs?: readonly InventoryTab[];
  activeTab?: InventoryTab;
  onTabChange?: (tab: InventoryTab) => void;
  showTabs?: boolean;
};

type Transaction = {
  id: string;
  productName: string;
  productLines: { title: string; detail?: string }[];
  type: "Purchase" | "Sale";
  quantity: number;
  price: number;
  amount: number;
  date: string;
  createdAt: string;
};

function ordersToTransactions(orders: Order[]): Transaction[] {
  return orders
    .filter((order) => !order.voided)
    .map((order) => {
      const quantity = order.items.reduce((sum, item) => sum + item.qty, 0);
      const amount = order.total;
      const productLines = orderSoldAsParts(order.items);
      return {
        id: order.id,
        productName: orderSoldAsLines(order.items).join(", "),
        productLines,
        type: (order.recordType === "Purchase" ? "Purchase" : "Sale") as "Purchase" | "Sale",
        quantity,
        price: quantity > 0 ? amount / quantity : amount,
        amount,
        date: phDateString(order.createdAt),
        createdAt: order.createdAt,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition-all hover:bg-neutral-100 hover:text-neutral-900";

function DrinkLines({ lines }: { lines: { title: string; detail?: string }[] }) {
  if (lines.length === 0) return <span>—</span>;
  return (
    <ul className="space-y-1">
      {lines.map((line, index) => (
        <li key={`${line.title}-${index}`} className="break-words">
          <p>{line.title}</p>
          {line.detail ? <p className="text-[11px] font-normal text-neutral-500">{line.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

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

function RowActions({
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  onDeleteMouseDown,
  deleteDisabled,
}: {
  editLabel?: string;
  deleteLabel: string;
  onEdit?: () => void;
  onDelete: () => void;
  onDeleteMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  deleteDisabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center justify-center gap-0.5">
      {onEdit ? (
        <button type="button" aria-label={editLabel} onClick={onEdit} className={iconBtn}>
          <PencilIcon />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={deleteLabel}
        disabled={deleteDisabled}
        onMouseDown={onDeleteMouseDown}
        onClick={onDelete}
        className={`${iconBtn} hover:bg-red-50 hover:text-red-600 disabled:opacity-40`}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function transactionToOrder(transaction: Transaction, existing?: Order): Order {
  const createdAt = phIsoFromDate(transaction.date, existing?.createdAt);
  const sameItems =
    existing &&
    existing.items.reduce((sum, item) => sum + item.qty, 0) === transaction.quantity &&
    orderSoldAsLabel(existing.items) === transaction.productName;

  return {
    id: transaction.id,
    createdAt,
    baristaName: existing?.baristaName ?? "Admin",
    items: sameItems && existing
      ? existing.items
      : [
          {
            productId: existing?.items[0]?.productId ?? `manual-${transaction.id}`,
            name: transaction.productName,
            qty: transaction.quantity,
            price: transaction.price,
          },
        ],
    total: transaction.amount,
    subtotal: existing?.subtotal ?? transaction.amount,
    discount: existing?.discount,
    promoLabel: existing?.promoLabel,
    paymentMethod: existing?.paymentMethod ?? "cash",
    ticketNo: existing?.ticketNo,
    paid: existing?.paid ?? transaction.amount,
    change: existing?.change,
    voided: existing?.voided,
    voidReason: existing?.voidReason,
    recordType: transaction.type,
  };
}

type StockItem = {
  id: string;
  name: string;
  stock: number;
  openingStock?: number;
  unit: string;
  purchaseUnitSize?: number;
  cupUsageAmount?: number;
  cupsMake?: number;
};

type RestockRecord = {
  id: string;
  inventoryItemId?: string;
  itemName: string;
  quantityAdded: number;
  purchaseQty?: number;
  purchaseUnit?: string;
  date: string;
};

  type CostingItem = {
    id: string;
    productName: string;
    ingredients: { name: string; amount: number; unit: string; outputCups?: number }[];
  };

type UsageRecord = {
  id: string;
  orderId?: string;
  inventoryItemId?: string;
  date: string;
  itemName: string;
  usedAmount: number;
  unit: string;
  remaining: number;
  soldAs: string;
};

function usageItemKey(itemName: string, unit: string, orderId?: string) {
  return `${orderId ?? ""}::${itemName.trim().toLowerCase()}::${unit.trim().toLowerCase()}`;
}

function aggregateUsageRows<
  T extends { id: string; orderId?: string; itemName: string; usedAmount: number; unit: string; remaining?: number },
>(rows: T[]): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    const key = usageItemKey(row.itemName, row.unit, row.orderId);
    const existing = merged.get(key);
    if (existing) {
      existing.usedAmount = roundQty(existing.usedAmount + row.usedAmount);
      if (typeof existing.remaining === "number" && typeof row.remaining === "number") {
        existing.remaining = Math.min(existing.remaining, row.remaining);
      }
    } else {
      merged.set(key, { ...row });
    }
  }
  return [...merged.values()];
}

export function SalePurchaseTransactions({
  store,
  tabs = ["transactions", "stock", "restock", "recipes", "used", "units"],
  activeTab: controlledActiveTab,
  onTabChange,
  showTabs = true,
}: SalePurchaseTransactionsProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<InventoryTab>(() => {
    if (typeof window !== "undefined") {
      const savedTab = window.localStorage.getItem("inventory-active-tab");

      if (savedTab && tabs.includes(savedTab as InventoryTab)) {
        return savedTab as InventoryTab;
      }
    }

    return tabs[0] ?? "transactions";
  });

  const activeTab = controlledActiveTab ?? internalActiveTab;

  function setActiveTab(tab: InventoryTab) {
    setInternalActiveTab(tab);

    if (typeof window !== "undefined") {
      window.localStorage.setItem("inventory-active-tab", tab);
    }

    onTabChange?.(tab);
  }
  const persistedTransactions: Transaction[] = ordersToTransactions(store.orders);
  const persistedStocks: StockItem[] = store.inventory.map((item) => ({
    id: item.id,
    name: item.name,
    stock: item.stock,
    openingStock: item.openingStock ?? (item.purchaseUnitSize ? 10 * item.purchaseUnitSize : item.stock),
    unit: item.unit || "pcs",
    purchaseUnitSize: item.purchaseUnitSize,
    cupUsageAmount: item.cupUsageAmount,
    cupsMake: item.cupsMake,
  }));
  const loggedOrderIds = new Set(
    (store.usageLogs ?? [])
      .map((entry) => entry.orderId)
      .filter((orderId): orderId is string => Boolean(orderId)),
  );
  const orderUsageRows = store.orders
    .filter((order) => !order.voided && !loggedOrderIds.has(order.id))
    .flatMap((order) => order.items.flatMap((line) => ingredientsForOrderLine(store, line).map((ingredient, ingredientIndex) => ({
      id: `${order.id}-${line.productId}-${ingredientIndex}`,
      orderId: order.id,
      inventoryItemId: ingredient.inventoryItemId && ingredient.inventoryItemId !== "other" ? ingredient.inventoryItemId : undefined,
      date: order.createdAt,
      itemName: ingredient.name,
      usedAmount: roundQty(Number(ingredient.amount) * line.qty),
      unit: ingredient.unit,
      soldAs: orderSoldAsLabel(order.items),
    }))));
  const extraUsageLogs = (store.usageLogs ?? [])
    .map((entry) => {
      const order = store.orders.find((item) => item.id === entry.orderId);
      return {
        ...entry,
        soldAs: order ? orderSoldAsLabel(order.items) : "",
      };
    });
  const sourceUsages = aggregateUsageRows([...orderUsageRows, ...extraUsageLogs]);
  const reconstructedRemaining = remainingForUsages(
    sourceUsages,
    store.restocks ?? [],
    store.inventory,
  );
  const persistedUsages: UsageRecord[] = sourceUsages
    .map((entry, index) => ({
      ...entry,
      id: entry.id,
      orderId: entry.orderId,
      date: entry.date,
      itemName: entry.itemName,
      usedAmount: entry.usedAmount,
      unit: entry.unit,
      remaining: reconstructedRemaining[index] ?? ("remaining" in entry ? entry.remaining : 0),
      soldAs: "soldAs" in entry ? entry.soldAs : "",
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  const getTodayDate = () => phDateString();

  const [transactions, setTransactions] = useState<Transaction[]>(persistedTransactions);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);

  const [stocks, setStocks] = useState<StockItem[]>(persistedStocks);
  const [unitSetupDrafts, setUnitSetupDrafts] = useState<Record<string, { purchaseUnitSize: string; unit?: string; cupUsageAmount: string }>>({});
  const stocksRef = useRef(stocks);
  stocksRef.current = stocks;

  const [restocks, setRestocks] = useState<RestockRecord[]>(store.restocks ?? []);
  const [costings, setCostings] = useState<CostingItem[]>(store.costings ?? []);

  const [usages, setUsages] = useState<UsageRecord[]>(persistedUsages);

  useEffect(() => {
    setTransactions(persistedTransactions);
    setStocks(persistedStocks);
    setUsages(persistedUsages);
    setRestocks(store.restocks ?? []);
    setCostings(store.costings ?? []);
  }, [store.orders, store.inventory, store.usageLogs, store.restocks, store.costings, store.recipes, store.recipeCostings]);

  const [editStockId, setEditStockId] = useState<string | null>(null);
  const [stockName, setStockName] = useState("");
  const [stockQty, setStockQty] = useState("");
  const [stockUnit, setStockUnit] = useState("");
  const [stockPurchaseUnitSize, setStockPurchaseUnitSize] = useState("");
  const [stockCupUsageAmount, setStockCupUsageAmount] = useState("");

  function resetStockForm() {
    setEditStockId(null);
    setStockName("");
      setStockQty("");
    setStockUnit("");
    setStockPurchaseUnitSize("");
    setStockCupUsageAmount("");
  }

  const [editCostingId, setEditCostingId] = useState<string | null>(null);
  const [costingProduct, setCostingProduct] = useState("");
  const [costingIngs, setCostingIngs] = useState<{ name: string; amount: number; unit: string; outputCups?: number }[]>([
    { name: "", amount: 0, unit: "", outputCups: 0 },
  ]);

  const [inlineRestockValues, setInlineRestockValues] = useState<{ [key: string]: string }>({});
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const [restockingItemId, setRestockingItemId] = useState<string | null>(null);
  const recipeMenu = store.menu ?? [];
  const recipeMap = store.recipes ?? {};
  type Costing = {
    id?: string;
    name: string;
    menuItems: string[];
    ingredients: RecipeIngredient[];
    hotCupInventoryItemId?: string;
    icedCupInventoryItemId?: string;
    otherCupInventoryItemId?: string;
  };
  const [recipeCostings, setRecipeCostings] = useState<Costing[]>([]);
  const [editingCostingIndex, setEditingCostingIndex] = useState<number | null>(null);
  const [savingRecipes, setSavingRecipes] = useState(false);
  const [otherDrinkName, setOtherDrinkName] = useState("");
  const [showOtherDrink, setShowOtherDrink] = useState(false);
  const [showDrinkSearch, setShowDrinkSearch] = useState(false);
  const [drinkSearch, setDrinkSearch] = useState("");
  const [selectedDrinkCategories, setSelectedDrinkCategories] = useState<string[]>([]);
  const hasHydratedCostings = useRef(false);

  useEffect(() => {
    if (hasHydratedCostings.current) return;

    hasHydratedCostings.current = true;

    const saved = store.recipeCostings;

    if (saved && saved.length > 0) {
      setRecipeCostings(saved);
    }
  }, [store.recipeCostings]);

  function updateCosting(index: number, patch: Partial<Costing>) {
    setRecipeCostings((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function updateCostingIngredient(costingIndex: number, ingredientIndex: number, patch: Partial<RecipeIngredient>) {
    setRecipeCostings((rows) => rows.map((row, rowIndex) => rowIndex === costingIndex ? {
      ...row,
      ingredients: row.ingredients.map((ingredient, currentIndex) => currentIndex === ingredientIndex ? { ...ingredient, ...patch } : ingredient),
    } : row));
  }

  function toggleCostingMenuItem(index: number, drink: string) {
    setRecipeCostings((rows) => rows.map((row, rowIndex) => {
      if (rowIndex === index) {
        const menuItems = row.menuItems.includes(drink)
          ? row.menuItems.filter((name) => name !== drink)
          : [...row.menuItems, drink];
        return { ...row, menuItems };
      }
      // A menu item may belong to exactly one costing. Remove stale duplicate assignments.
      return { ...row, menuItems: row.menuItems.filter((name) => name.trim().toLowerCase() !== drink.trim().toLowerCase()) };
    }));
  }

  // const menuDrinks = useMemo(
  //   () => recipeMenu.filter((drink) => {
  //     const normalizedCategory = drink.category.replace(/[^a-z]/gi, "").toLowerCase();
  //     return !isFoodOrPastry(drink.category) && normalizedCategory !== "addons" && normalizedCategory !== "addson";
  //   }),
  //   [recipeMenu],
  // );
  const menuItems = useMemo(
    () =>
      recipeMenu.filter((item) => {
        const normalizedCategory = item.category
          .replace(/[^a-z]/gi, "")
          .toLowerCase();

        return (
          normalizedCategory !== "addons" &&
          normalizedCategory !== "addson"
        );
      }),
    [recipeMenu],
  );
  const assignedMenuItems = useMemo(
    () => new Set(recipeCostings.flatMap((costing) => costing.menuItems.map((name) => name.trim().toLowerCase()))),
    [recipeCostings],
  );
  const menuCategories = useMemo(
    () => Array.from(new Set(menuItems.map((item) => item.category?.trim()).filter(Boolean))).sort(),
    [menuItems],
  );
  const unassignedMenuItems = useMemo(
    () => menuItems.filter((item) => !assignedMenuItems.has(item.name.trim().toLowerCase())),
    [assignedMenuItems, menuItems],
  );
  const filteredUnassignedMenuItems = useMemo(() => {
    const query = drinkSearch.trim().toLowerCase();
    return unassignedMenuItems.filter((item) => {
      const matchesSearch = !query || item.name.toLowerCase().includes(query);
      const matchesCategory = selectedDrinkCategories.length === 0 || selectedDrinkCategories.includes(item.category);
      return matchesSearch && matchesCategory;
    });
  }, [drinkSearch, selectedDrinkCategories, unassignedMenuItems]);

  const cupInventoryItems = useMemo(
    () => store.inventory.filter((item) => looksLikeCupItem(item, recipeCostings)),
    [recipeCostings, store.inventory],
  );

  function addMenuItemToCosting(index: number, drink: string) {
    const name = drink.trim();
    if (!name) return;
    setRecipeCostings((rows) =>
      rows.map((row, rowIndex) => {
        if (rowIndex === index) {
          if (row.menuItems.some((entry) => entry.trim().toLowerCase() === name.toLowerCase())) return row;
          return { ...row, menuItems: [...row.menuItems, name] };
        }
        return { ...row, menuItems: row.menuItems.filter((entry) => entry.trim().toLowerCase() !== name.toLowerCase()) };
      }),
    );
  }

  function addOtherMenuItem(index: number) {
    const drink = otherDrinkName.trim();
    if (!drink) return;
    const alreadyAssigned = recipeCostings.some((costing, costingIndex) => costingIndex !== index && costing.menuItems.some((name) => name.toLowerCase() === drink.toLowerCase()));
    if (alreadyAssigned) return;
    setRecipeCostings((rows) => rows.map((row, rowIndex) => rowIndex === index && !row.menuItems.some((name) => name.toLowerCase() === drink.toLowerCase()) ? { ...row, menuItems: [...row.menuItems, drink] } : row));
    setOtherDrinkName("");
    setShowOtherDrink(false);
  }

  function openCosting(index: number | null) {
    setEditingCostingIndex(index);
    setShowOtherDrink(false);
    setOtherDrinkName("");
  }

  function attachUnassignedMenuItem(drink: string) {
    if (editingCostingIndex !== null) {
      addMenuItemToCosting(editingCostingIndex, drink);
      return;
    }
    if (recipeCostings.length > 0) {
      setEditingCostingIndex(0);
      addMenuItemToCosting(0, drink);
      return;
    }
    setRecipeCostings([{ name: "", menuItems: [drink], ingredients: [{ inventoryItemId: "", name: "", amount: 0, unit: "ml" }] }]);
    setEditingCostingIndex(0);
  }

  async function handleSaveRecipes() {
    setSavingRecipes(true);
    try {
      await saveCostings();
    } finally {
      setSavingRecipes(false);
    }
  }

  async function saveCostings(nextCostings = recipeCostings) {
    const recipes: StoreData["recipes"] = {};

    nextCostings.forEach((costing) =>
      costing.menuItems.forEach((menuItemName) => {
        const ingredients = costing.ingredients.filter(
          (ingredient) =>
            ingredient.name.trim() &&
            Number(ingredient.amount) > 0
        );

        recipes[menuItemName] = ingredients;

        const menuItem = recipeMenu.find(
          (item) =>
            item.name.trim().toLowerCase() ===
              menuItemName.trim().toLowerCase() ||
            item.name.trim().toLowerCase().replace(/s$/, "") ===
              menuItemName.trim().toLowerCase().replace(/s$/, "")
        );

        if (menuItem) {
          recipes[menuItem.id] = ingredients;
        }
      })
    );

    const savedCostings = nextCostings.map((costing, index) => ({
      ...costing,
      id: costing.id || `recipe-costing-${Date.now()}-${index}`,
    }));

    const configuredIngredients = savedCostings
      .flatMap((costing) => costing.ingredients)
      .filter((ingredient) => ingredient.name.trim());

    const nextStocks = [...stocks];

    for (const ingredient of configuredIngredients) {
      const existingIndex = nextStocks.findIndex((item) =>
        itemNameEquals(item.name, ingredient.name)
      );

      const amountPerCup = Number(ingredient.amount);
      const unit = ingredient.unit?.trim() || "pcs";

      if (existingIndex >= 0) {
        nextStocks[existingIndex] = {
          ...nextStocks[existingIndex],
          unit,
          cupUsageAmount:
            Number.isFinite(amountPerCup) && amountPerCup > 0
              ? amountPerCup
              : nextStocks[existingIndex].cupUsageAmount,
        };
      } else {
        nextStocks.push({
          id: `stock-${Date.now()}-${nextStocks.length}`,
          name: ingredient.name.trim(),
          stock: 0,
          unit,
          cupUsageAmount:
            Number.isFinite(amountPerCup) && amountPerCup > 0
              ? amountPerCup
              : undefined,
        });
      }
    }

    setStocks(nextStocks);
    setRecipeCostings(savedCostings);

    await persistInventory(nextStocks);

    await saveAdminData({
      recipes,
      recipeCostings: savedCostings,
    });
  }

  const [filterKeyword, setFilterKeyword] = useState("");
  const [rangeType, setRangeType] = useState<PeriodRange>("today");
  const [filterDate, setFilterDate] = useState(getTodayDate);
  const [filterMode, setFilterMode] = useState<"range" | "date">("range");
  const [openUsageOrders, setOpenUsageOrders] = useState<string[]>([]);

  const handleTotalUsedChange = (itemName: string, value: string) => {
    const nextTotal = Math.max(0, Number(value) || 0);
    const stockIndex = stocks.findIndex((item) => itemNameEquals(item.name, itemName));
    if (stockIndex >= 0) {
      const nextStocks = stocks.map((item, index) =>
        index === stockIndex ? { ...item, cupUsageAmount: nextTotal || undefined } : item,
      );
      setStocks(nextStocks);
      void persistInventory(nextStocks);
    }
    setUsages((currentUsages) => {
      const matching = currentUsages.filter((usage) => itemNameEquals(usage.itemName, itemName) && phDateString(usage.date) === getTodayDate());
      const next = (() => {
        if (matching.length === 0) {
          return nextTotal === 0
            ? currentUsages
            : [{ id: Date.now().toString(), date: getTodayDate(), itemName, usedAmount: nextTotal, unit: stocks.find((item) => itemNameEquals(item.name, itemName))?.unit || "units", remaining: stocks.find((item) => itemNameEquals(item.name, itemName))?.stock ?? 0, soldAs: "" }, ...currentUsages];
        }
        const firstId = matching[0].id;
        const otherUsageTotal = matching.slice(1).reduce((sum, usage) => sum + usage.usedAmount, 0);
        return currentUsages.map((usage) =>
          usage.id === firstId
            ? { ...usage, usedAmount: Math.max(0, nextTotal - otherUsageTotal) }
            : usage,
        );
      })();
      void saveAdminData({
        usageLogs: next.map((entry) => ({
          id: entry.id,
          orderId: store.usageLogs.find((item) => item.id === entry.id)?.orderId || "",
          orderItemId: store.usageLogs.find((item) => item.id === entry.id)?.orderItemId || "",
          inventoryItemId: entry.inventoryItemId ?? store.usageLogs.find((item) => item.id === entry.id)?.inventoryItemId,
          date: entry.date,
          itemName: entry.itemName,
          usedAmount: entry.usedAmount,
          unit: entry.unit,
          remaining: entry.remaining,
        })),
      });
      return next;
    });
  };

  const applyTransactionInventoryEffect = (
    currentStocks: StockItem[],
    currentUsages: UsageRecord[],
    productName: string,
    type: "Purchase" | "Sale",
    quantity: number,
    dateStr: string,
    isRevert = false,
  ) => {
    const nextStocks = currentStocks.map((item) => ({ ...item }));
    let nextUsages = [...currentUsages];

    if (type === "Sale") {
      const costing = costings.find((c) => itemNameEquals(c.productName, productName));
      if (costing) {
        for (const ing of costing.ingredients) {
          const stockIndex = nextStocks.findIndex((s) => itemNameEquals(s.name, ing.name));
          if (stockIndex === -1) continue;
          const totalUsed = roundQty(perCupAmount(ing) * quantity);
          if (totalUsed <= 0) continue;
          nextStocks[stockIndex].stock = roundQty(
            isRevert
              ? nextStocks[stockIndex].stock + totalUsed
              : Math.max(0, nextStocks[stockIndex].stock - totalUsed),
          );
          if (isRevert) {
            const idx = nextUsages.findIndex(
              (usage) =>
                itemNameEquals(usage.itemName, ing.name) &&
                usage.usedAmount === totalUsed &&
                phDateString(usage.date) === phDateString(dateStr),
            );
            if (idx !== -1) nextUsages.splice(idx, 1);
          } else {
            nextUsages = [
              {
                id: `${Date.now()}-${ing.name}-${Math.random()}`,
                date: dateStr,
                itemName: ing.name,
                usedAmount: totalUsed,
                unit: ing.unit,
                remaining: nextStocks[stockIndex].stock,
                soldAs: productName,
              },
              ...nextUsages,
            ];
          }
        }
      }
    } else if (type === "Purchase") {
      const stockIndex = nextStocks.findIndex((s) => itemNameEquals(s.name, productName));
      if (stockIndex !== -1) {
        nextStocks[stockIndex].stock = roundQty(
          isRevert
            ? Math.max(0, nextStocks[stockIndex].stock - quantity)
            : nextStocks[stockIndex].stock + quantity,
        );
      }
    }

    return { nextStocks, nextUsages };
  };

  const persistInventoryAndUsage = async (nextStocks: StockItem[], nextUsages: UsageRecord[]) => {
    setStocks(nextStocks);
    setUsages(nextUsages);
    await persistInventory(nextStocks);
    await saveAdminData({
      usageLogs: nextUsages.map((entry) => ({
        id: entry.id,
        orderId: store.usageLogs.find((item) => item.id === entry.id)?.orderId || "",
        orderItemId: store.usageLogs.find((item) => item.id === entry.id)?.orderItemId || "",
        date: entry.date,
        itemName: entry.itemName,
        usedAmount: entry.usedAmount,
        unit: entry.unit,
        remaining: entry.remaining,
      })),
    });
  };

  const persistOrders = async (nextTransactions: Transaction[]) => {
    const nextById = new Map(nextTransactions.map((item) => [item.id, item]));
    const kept = store.orders.flatMap((order) => {
      if (order.voided) return [order];
      const next = nextById.get(order.id);
      if (!next) return [];
      return [transactionToOrder(next, order)];
    });
    const created = nextTransactions
      .filter((item) => !store.orders.some((order) => order.id === item.id))
      .map((item) => transactionToOrder(item));
    await saveAdminData({ orders: [...kept, ...created] });
  };

  async function persistInventory(nextStocks: StockItem[]) {
    const existingById = new Map(store.inventory.map((item) => [item.id, item]));
    const inventory = nextStocks.map((item) => {
      const existing = existingById.get(item.id);
      return {
        id: item.id,
        name: item.name,
  stock: item.stock,
  openingStock: item.openingStock ?? existing?.openingStock,
  unit: item.unit || existing?.unit || "pcs",
        cost: existing?.cost ?? 0,
      maxStock: existing?.maxStock ?? item.stock,
      purchaseUnitSize: item.purchaseUnitSize,
    cupUsageAmount: item.cupUsageAmount,
    cupsMake: item.cupsMake ?? existing?.cupsMake,
  };
  });
    await saveAdminData({ inventory });
  }

  const handleDeleteTransaction = async (id: string) => {
    if (deletingTransactionId) return;
    setDeletingTransactionId(id);
    const previous = transactions;
    setTransactions((current) => current.filter((t) => t.id !== id));
    try {
      // delete_order_atomic restores stock and removes usage logs. The old
      // persistInventoryAndUsage() rewrite of the whole store made this feel stuck.
      await deleteAdminRecord("order", id);
    } catch (error) {
      setTransactions(previous);
      throw error;
    } finally {
      setDeletingTransactionId(null);
    }
  };

  const handleSaveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockName.trim() || !stockQty) return;
    const pieces = Number(stockQty);
    if (!Number.isFinite(pieces) || pieces < 0) return;
    const unit = stockUnit.trim() || "pcs";
    const purchaseUnitSize = stockPurchaseUnitSize.trim() ? Number(stockPurchaseUnitSize) : undefined;
    const cupUsageAmount = stockCupUsageAmount.trim() ? Number(stockCupUsageAmount) : undefined;
    const cupsMake = unit && purchaseUnitSize !== undefined && cupUsageAmount !== undefined
      ? purchaseUnitSize / cupUsageAmount
      : undefined;
    if ([purchaseUnitSize, cupUsageAmount].some((value) => value !== undefined && (!Number.isFinite(value) || value <= 0))) return;

    if (editStockId) {
      const nextStocks = stocks.map((s) =>
        s.id === editStockId ? { ...s, name: stockName.trim(), stock: toBaseQuantity({ purchaseUnitSize }, pieces), openingStock: toBaseQuantity({ purchaseUnitSize }, pieces), unit, purchaseUnitSize, cupUsageAmount, cupsMake } : s,
      );
      const nextRestocks = restocks.filter((record) =>
        record.inventoryItemId
          ? record.inventoryItemId !== editStockId
          : !itemNameEquals(record.itemName, stockName),
      );
      setStocks(nextStocks);
      setRestocks(nextRestocks);
      await persistInventory(nextStocks);
      await saveAdminData({ restocks: nextRestocks });
      setEditStockId(null);
    } else {
      const newItem: StockItem = {
        id: `stock-${Date.now()}`,
        name: stockName.trim(),
        stock: toBaseQuantity({ purchaseUnitSize }, pieces),
        openingStock: toBaseQuantity({ purchaseUnitSize }, pieces),
        unit,
        purchaseUnitSize,
        cupUsageAmount,
        cupsMake,
      };
      const nextStocks = [...stocks, newItem];
      setStocks(nextStocks);
      await persistInventory(nextStocks);
    }
    resetStockForm();
  };

  const updateUnitSetup = async (id: string, field: "purchaseUnitSize" | "unit" | "cupUsageAmount", value: string) => {
    const parsed = field === "unit" ? value.trim() : value === "" ? undefined : Number(value);
    if (field !== "unit" && parsed !== undefined && (!Number.isFinite(Number(parsed)) || Number(parsed) <= 0)) return;
    const draft = unitSetupDrafts[id];
    const nextStocks = stocks.map((item) => item.id === id ? {
      ...item,
      purchaseUnitSize: draft?.purchaseUnitSize === "" ? undefined : draft?.purchaseUnitSize !== undefined ? Number(draft.purchaseUnitSize) : item.purchaseUnitSize,
      unit: draft?.unit ?? item.unit,
      cupUsageAmount: draft?.cupUsageAmount === "" ? undefined : draft?.cupUsageAmount !== undefined ? Number(draft.cupUsageAmount) : item.cupUsageAmount,
      [field]: parsed,
    } : item);
    setStocks(nextStocks);
    await persistInventory(nextStocks);
  };

  const saveUnitSetup = async () => {
    await persistInventory(stocks);
    setUnitSetupDrafts({});
  };

  const addUnitSetupItem = async () => {
    const name = window.prompt("Item name");
    if (!name?.trim()) return;
    if (stocks.some((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase())) return;
    const nextStocks = [...stocks, { id: `stock-${Date.now()}`, name: name.trim(), stock: 0, unit: "pcs" }];
    setStocks(nextStocks);
    await persistInventory(nextStocks);
  };

  const handleEditStock = (s: StockItem) => {
    setEditStockId(s.id);
    setStockName(s.name);
    setStockQty(toPieceQuantity(s, s.openingStock ?? s.stock).toString());
    setStockUnit(s.unit || "pcs");
    setStockPurchaseUnitSize(s.purchaseUnitSize?.toString() ?? "");
    setStockCupUsageAmount(s.cupUsageAmount?.toString() ?? "");
  };

  const handleDeleteStock = async (id: string) => {
    const previousStocks = stocks;
    setStocks((current) => current.filter((s) => s.id !== id));
    setStockNotice(null);
    try {
      const result = await deleteAdminRecord("inventory", id);
      if (result && "error" in result && result.error) {
        setStocks(previousStocks);
        setStockNotice(result.error);
      }
    } catch (error) {
      setStocks(previousStocks);
      setStockNotice(error instanceof Error ? error.message : "Could not delete that stock item.");
    }
  };

  const handleInlineRestock = async (item: StockItem) => {
    if (restockingItemId) return;
    const pieces = Number(inlineRestockValues[item.id]);
    if (!Number.isFinite(pieces) || pieces <= 0) {
      setStockNotice("Enter a quantity in +Qty, then click Add.");
      return;
    }

    const addQty = toBaseQuantity(item, pieces);
    // Write the PH-local instant as an ISO timestamp so the ledger row lands
    // in the correct PH calendar-day bucket (naive "YYYY-MM-DD HH:mm:ss" was
    // stored as UTC and could shift a day).
    const nowTime = phIsoFromDate(getTodayDate());
    const newRestockId = Date.now().toString() + Math.random();
    const previousStocks = stocks;
    const previousRestocks = restocks;
    const nextStocks = stocks.map((s) => s.id === item.id ? { ...s, stock: s.stock + addQty } : s);
    const newRestock: RestockRecord = {
      id: newRestockId,
      inventoryItemId: item.id,
      itemName: item.name,
      quantityAdded: addQty,
      purchaseQty: pieces,
      purchaseUnit: "pcs",
      date: nowTime,
    };

    setStockNotice(null);
    setRestockingItemId(item.id);
    setStocks(nextStocks);
    setRestocks((current) => [newRestock, ...current]);
    setInlineRestockValues((current) => ({ ...current, [item.id]: "" }));

    try {
      // Ledger row + stock adjustment happen in one DB transaction so they
      // can never diverge (create_restock_atomic).
      await createRestock({ id: newRestockId, inventoryItemId: item.id, itemNameSnapshot: item.name, quantityAdded: addQty, createdAt: nowTime, purchaseQty: pieces, purchaseUnit: "pcs" });
    } catch (error) {
      setStocks(previousStocks);
      setRestocks(previousRestocks);
      setInlineRestockValues((current) => ({ ...current, [item.id]: String(pieces) }));
      setStockNotice(error instanceof Error ? error.message : "Could not restock that item.");
    } finally {
      setRestockingItemId(null);
    }
  };

  const handleDeleteRestock = async (id: string) => {
    const record = restocks.find((item) => item.id === id);
    if (record) {
      const nextStocks = stocks.map((item) =>
        matchesInventoryRow(
          { itemName: record.itemName, inventoryItemId: record.inventoryItemId },
          { name: item.name, inventoryItemId: item.id },
        )
          ? { ...item, stock: Math.max(0, item.stock - record.quantityAdded) }
          : item,
      );
      setStocks(nextStocks);
    }
    setRestocks((current) => current.filter((s) => s.id !== id));
    // delete_restock_atomic locks the persisted row and reverses stock from
    // its own inventory_item_id/quantity_added - the optimistic state update
    // above is display-only and no longer affects correctness.
    await deleteRestock({ id });
  };

  const handleSaveCosting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!costingProduct) return;

    if (editCostingId) {
      const nextCostings = costings.map((c) => c.id === editCostingId ? { ...c, productName: costingProduct, ingredients: costingIngs } : c);
      setCostings(nextCostings);
      await saveAdminData({ costings: nextCostings });
      setEditCostingId(null);
    } else {
      const newCosting: CostingItem = { id: Date.now().toString(), productName: costingProduct, ingredients: costingIngs };
      const nextCostings = [...costings, newCosting];
      setCostings(nextCostings);
      await saveAdminData({ costings: nextCostings });
    }
    setCostingProduct("");
    setCostingIngs([{ name: "", amount: 0, unit: "", outputCups: 0 }]);
  };

  const handleEditCosting = (c: CostingItem) => {
    setEditCostingId(c.id);
    setCostingProduct(c.productName);
    setCostingIngs(c.ingredients);
  };

  const deleteRecipeCosting = async (index: number) => {
    const nextCostings = recipeCostings.filter((_, rowIndex) => rowIndex !== index);
    setRecipeCostings(nextCostings);
    setEditingCostingIndex((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
    await saveCostings(nextCostings);
  };

  const handleDeleteCosting = async (id: string) => {
    const nextCostings = costings.filter((c) => c.id !== id);
    setCostings(nextCostings);
    await saveAdminData({ costings: nextCostings });
  };

  const period = filterMode === "date"
    ? { from: filterDate, to: filterDate }
    : phPeriodBounds(rangeType);
  const rangeStart = period.from;
  const rangeEnd = period.to;
  const isLiveRange = rangeStart === getTodayDate() && rangeEnd === getTodayDate();

  function inDateRange(value: string) {
    const day = phDateString(value);
    return day >= rangeStart && day <= rangeEnd;
  }

  const transactionsInRange = transactions.filter((transaction) => inDateRange(transaction.date));
  const filteredTransactions = transactionsInRange.filter((t) => {
    return t.productName.toLowerCase().includes(filterKeyword.toLowerCase());
  });
  const hasTransactionsInRange = transactionsInRange.length > 0;

  const usageGroups = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase();
    return store.orders
      .filter((order) => !order.voided && inDateRange(order.createdAt))
      .map((order) => {
        const items = aggregateUsageRows(usages.filter((usage) => usage.orderId === order.id));
        const soldAsLines = orderSoldAsParts(order.items);
        const soldAs = orderSoldAsLines(order.items).join(", ");
        return {
          orderId: order.id,
          orderLabel: order.ticketNo != null ? `#${order.ticketNo}` : order.id,
          date: order.createdAt,
          soldAs,
          soldAsLines,
          items,
        };
      })
      .filter((group) => {
        if (!keyword) return true;
        return (
          group.orderId.toLowerCase().includes(keyword) ||
          group.orderLabel.toLowerCase().includes(keyword) ||
          group.soldAs.toLowerCase().includes(keyword) ||
          group.items.some((item) => item.itemName.toLowerCase().includes(keyword))
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.orderId.localeCompare(a.orderId));
  }, [filterKeyword, rangeEnd, rangeStart, store.orders, usages]);

  const dateRangeFilter = (
    <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div
        className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 sm:py-1.5 ${
          filterMode === "range" ? "border-black bg-white ring-1 ring-black" : "border-neutral-400 bg-white opacity-75"
        }`}
      >
        <span className="shrink-0 text-xs font-medium text-neutral-500">Range:</span>
        <select
          value={rangeType}
          onChange={(event) => {
            setRangeType(event.target.value as PeriodRange);
            setFilterMode("range");
          }}
          onClick={() => setFilterMode("range")}
          className="min-w-0 flex-1 cursor-pointer bg-transparent text-sm outline-none"
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
        className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 sm:py-1.5 ${
          filterMode === "date" ? "border-black bg-white ring-1 ring-black" : "border-neutral-400 bg-white opacity-75"
        }`}
      >
        <span className="shrink-0 text-xs font-medium text-neutral-500">Date:</span>
        <input
          type="date"
          value={filterDate}
          onChange={(event) => {
            setFilterDate(event.target.value);
            setFilterMode("date");
          }}
          onClick={() => setFilterMode("date")}
          className="min-w-0 flex-1 cursor-pointer bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen min-w-0 space-y-6 rounded-none border-0 border-neutral-300 bg-white p-3 sm:rounded-xl sm:border sm:p-6">
      {showTabs ? <div className="flex gap-2 overflow-x-auto border-b border-neutral-400 pb-3">
        {tabs.filter((tab) => tab !== "units").map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 px-4 py-1.5 rounded text-xs font-bold transition shadow-sm uppercase ${activeTab === tab ? "bg-black text-white" : "bg-white text-neutral-700 hover:bg-neutral-100"}`}
          >
            {tab === "transactions" ? "Transactions" : tab === "stock" ? "Stock Inventory" : tab === "restock" ? "Restock" : tab === "costing" ? "Costing" : tab === "used" ? "Usage Logbook" : "Costing"}
          </button>
        ))}
      </div> : null}

      {activeTab !== "recipes" && activeTab !== "units" ? dateRangeFilter : null}

      {activeTab === "units" && (
        <section className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-neutral-300 bg-neutral-50 p-4">
            <div><h2 className="text-sm font-bold uppercase text-neutral-800">Unit Setup</h2><p className="mt-1 text-xs text-neutral-600">Set your own unit rules. New items can be added here.</p></div>
            <div className="flex gap-2"><button type="button" onClick={() => void addUnitSetupItem()} className="rounded bg-black px-3 py-2 text-xs font-semibold text-white">Add item</button><button type="button" onClick={() => void saveUnitSetup()} className="rounded border border-black px-3 py-2 text-xs font-semibold text-black">Save setup</button></div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-neutral-300">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead><tr className="bg-black text-xs font-semibold text-white"><th className="p-3">Item</th><th className="p-3">Total Unit Item</th><th className="p-3">Unit Item</th><th className="p-3">Unit</th><th className="p-3">Cups make</th><th className="p-3">Actions</th></tr></thead>
              <tbody>{stocks.map((item) => <tr key={item.id} className="border-b border-neutral-200 last:border-0"><td className="p-3 font-medium"><div className="flex items-center justify-between gap-3"><span>{item.name}</span><button type="button" onClick={() => void handleDeleteStock(item.id)} className="text-xs font-semibold text-red-600 hover:underline">Delete</button></div></td><td className="p-3"><input type="number" min="0" step="any" value={unitSetupDrafts[item.id]?.purchaseUnitSize ?? (item.purchaseUnitSize?.toString() ?? "")} onChange={(event) => { const value = event.target.value; setUnitSetupDrafts((current) => ({ ...current, [item.id]: { purchaseUnitSize: value, unit: current[item.id]?.unit ?? item.unit, cupUsageAmount: current[item.id]?.cupUsageAmount ?? (item.cupUsageAmount?.toString() ?? "") } })); }} onBlur={(event) => void updateUnitSetup(item.id, "purchaseUnitSize", event.target.value)} placeholder="e.g. 1000" className="w-full rounded border border-neutral-300 px-3 py-2" /></td><td className="p-3"><input type="text" value={unitSetupDrafts[item.id]?.unit ?? item.unit} onChange={(event) => { const value = event.target.value; setUnitSetupDrafts((current) => ({ ...current, [item.id]: { purchaseUnitSize: current[item.id]?.purchaseUnitSize ?? (item.purchaseUnitSize?.toString() ?? ""), unit: value, cupUsageAmount: current[item.id]?.cupUsageAmount ?? (item.cupUsageAmount?.toString() ?? "") } })); }} onBlur={(event) => void updateUnitSetup(item.id, "unit", event.target.value)} placeholder="grams, pcs, ml, kg" className="w-full rounded border border-neutral-300 px-3 py-2" /></td><td className="p-3"><input type="number" min="0" step="any" value={unitSetupDrafts[item.id]?.cupUsageAmount ?? (item.cupUsageAmount?.toString() ?? "")} onChange={(event) => { const value = event.target.value; setUnitSetupDrafts((current) => ({ ...current, [item.id]: { purchaseUnitSize: current[item.id]?.purchaseUnitSize ?? (item.purchaseUnitSize?.toString() ?? ""), unit: current[item.id]?.unit ?? item.unit, cupUsageAmount: value } })); }} onBlur={(event) => void updateUnitSetup(item.id, "cupUsageAmount", event.target.value)} placeholder="e.g. 9" className="w-full rounded border border-neutral-300 px-3 py-2" /></td><td className="p-3 text-neutral-600">{(() => { const total = Number(unitSetupDrafts[item.id]?.purchaseUnitSize ?? item.purchaseUnitSize); const perCup = Number(unitSetupDrafts[item.id]?.cupUsageAmount ?? item.cupUsageAmount); return total > 0 && perCup > 0 ? (total / perCup).toFixed(2) : "—"; })()}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "recipes" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-neutral-900">Costing</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const nextIndex = recipeCostings.length;
                  setRecipeCostings((rows) => [
                    ...rows,
                    { name: "", menuItems: [], ingredients: [{ inventoryItemId: "", name: "", amount: 0, unit: "ml" }] },
                  ]);
                  openCosting(nextIndex);
                }}
                className="rounded border border-neutral-400 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
              >
                Add recipe
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRecipes()}
                disabled={savingRecipes}
                className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {savingRecipes ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {unassignedMenuItems.length > 0 && editingCostingIndex === null ? (
            <div className="rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Needs a recipe</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {unassignedMenuItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => attachUnassignedMenuItem(item.name)}
                    className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:border-neutral-900"
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {recipeCostings.map((costing, costingIndex) => {
            const isEditing = editingCostingIndex === costingIndex;
            return (
              <section key={costing.id ?? costingIndex} className={`overflow-hidden rounded-lg border bg-white ${isEditing ? "border-neutral-900" : "border-neutral-300"}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  {isEditing ? (
                    <input
                      value={costing.name}
                      onChange={(event) => updateCosting(costingIndex, { name: event.target.value })}
                      placeholder="Recipe name"
                      className="min-w-0 flex-1 bg-transparent text-base font-medium text-neutral-900 outline-none"
                    />
                  ) : (
                    <button type="button" onClick={() => openCosting(costingIndex)} className="min-w-0 flex-1 text-left text-base font-medium text-neutral-900">
                      {costing.name.trim() || "Untitled recipe"}
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openCosting(isEditing ? null : costingIndex)}
                      className="text-xs font-medium text-neutral-600"
                    >
                      {isEditing ? "Close" : "Edit"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${costing.name || "recipe"}`}
                      title="Delete recipe"
                      onClick={() => void deleteRecipeCosting(costingIndex)}
                      className="rounded p-1 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div className="grid border-t border-neutral-200 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
                    <div className="border-b border-neutral-200 p-4 lg:border-b-0 lg:border-r">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Menu Items</p>
                        <button
                          type="button"
                          onClick={() => setShowDrinkSearch((visible) => !visible)}
                          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-900 hover:text-neutral-900"
                        >
                          Search
                        </button>
                      </div>
                      {showDrinkSearch ? (
                        <input
                          value={drinkSearch}
                          onChange={(event) => setDrinkSearch(event.target.value)}
                          placeholder="Search menu items"
                          aria-label="Search menu items"
                          className="mt-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                        />
                      ) : null}
                      {menuCategories.length > 0 ? (
                        <label className="mt-3 block">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Category</span>
                          <select
                            value={selectedDrinkCategories[0] ?? ""}
                            onChange={(event) => setSelectedDrinkCategories(event.target.value ? [event.target.value] : [])}
                            aria-label="Filter Items by category"
                            className="mt-2 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-700"
                          >
                            <option value="">All categories</option>
                            {menuCategories.map((category) => (
                              <option key={category} value={category}>{category}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <div className="mt-4 border-t border-neutral-100 pt-3">
                        {filteredUnassignedMenuItems.length > 0 || menuItems.some((item) => costing.menuItems.includes(item.name)) ? (
                          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-1">
                            {menuItems
                              .filter((item) => {
                                const query = drinkSearch.trim().toLowerCase();
                                const matchesSearch = !query || item.name.toLowerCase().includes(query);
                                const matchesCategory = selectedDrinkCategories.length === 0 || selectedDrinkCategories.includes(item.category);
                                return matchesSearch && matchesCategory;
                              })
                              .map((item) => {
                                const itemKey = item.name.trim().toLowerCase();
                                const isChecked = costing.menuItems.some((name) => name.trim().toLowerCase() === itemKey);
                                const isAssignedToAnotherCosting = recipeCostings.some(
                                  (otherCosting, otherIndex) => otherIndex !== costingIndex && otherCosting.menuItems.some((name) => name.trim().toLowerCase() === itemKey),
                                );
                                return (
                                  <label
                                    key={item.id}
                                    title={isAssignedToAnotherCosting ? "Already assigned to another costing" : undefined}
                                    className={`flex min-w-0 items-center gap-2 text-sm ${isChecked ? "text-neutral-900" : isAssignedToAnotherCosting ? "cursor-not-allowed text-neutral-300" : "text-neutral-400"}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={isAssignedToAnotherCosting}
                                      onChange={() => toggleCostingMenuItem(costingIndex, item.name)}
                                      className="h-4 w-4 shrink-0 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                    <span className="min-w-0 break-words leading-snug" title={item.name}>{item.name}</span>
                                  </label>
                                );
                              })}
                          </div>
                        ) : (
                          <p className="text-sm text-neutral-500">No items match your filters.</p>
                        )}
                      </div>
                      {showOtherDrink ? (
                        <div className="mt-3 flex gap-2">
                          <input
                            value={otherDrinkName}
                            onChange={(event) => setOtherDrinkName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                                event.preventDefault();
                                addOtherMenuItem(costingIndex);
                              }
                            }}
                            placeholder="Drink name"
                            className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-1.5 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => addOtherMenuItem(costingIndex)}
                            className="rounded border border-neutral-400 px-3 py-1.5 text-sm font-medium text-neutral-700"
                          >
                            Add
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowOtherDrink(true)}
                          className="mt-3 text-xs text-neutral-400 hover:text-neutral-700"
                        >
                          Not on the menu
                        </button>
                      )}
                    </div>

                    <div className="p-4">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Ingredients: </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">

                        {(["hotCupInventoryItemId", "icedCupInventoryItemId", "otherCupInventoryItemId"] as const).map((field) => (
                          <label key={field} className="text-xs text-neutral-600">
                            {field === "hotCupInventoryItemId" ? "Hot cup" : field === "icedCupInventoryItemId" ? "Iced cup" : "Other cup"}
                            <select
                              value={costing[field] ?? ""}
                              onChange={(event) => updateCosting(costingIndex, { [field]: event.target.value || undefined })}
                              className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800"
                            >
                              <option value="">Select cup item</option>
                              {cupInventoryItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                      <div className="mt-3 space-y-2">
                        {costing.ingredients.map((ingredient, ingredientIndex) => (
                          <div key={ingredientIndex} className="grid grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_auto] items-start gap-2">
                            <div>
                              <select
                                value={ingredient.inventoryItemId}
                                onChange={(event) => {
                                  const item = store.inventory.find((stock) => stock.id === event.target.value);
                                  updateCostingIngredient(costingIndex, ingredientIndex, {
                                    inventoryItemId: event.target.value,
                                    name: item?.name ?? ingredient.name,
                                    unit: item?.unit ?? ingredient.unit,
                                  });
                                }}
                                className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                              >
                                <option value="">Select ingredient</option>
                                {store.inventory.map((item) => (
                                  <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                                <option value="other">Other</option>
                              </select>
                              {ingredient.inventoryItemId === "other" ? (
                                <input
                                  value={ingredient.name}
                                  onChange={(event) => updateCostingIngredient(costingIndex, ingredientIndex, { name: event.target.value })}
                                  placeholder="Ingredient name"
                                  className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                                />
                              ) : null}
                            </div>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Qty"
                              value={ingredient.amount === 0 ? "" : ingredient.amount}
                              onChange={(event) => updateCostingIngredient(costingIndex, ingredientIndex, { amount: event.target.value === "" ? 0 : Number(event.target.value) })}
                              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                            />
                            <input
                              placeholder="Unit"
                              value={ingredient.unit}
                              onChange={(event) => updateCostingIngredient(costingIndex, ingredientIndex, { unit: event.target.value })}
                              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => updateCosting(costingIndex, { ingredients: costing.ingredients.filter((_, rowIndex) => rowIndex !== ingredientIndex) })}
                              className="mt-1.5 text-xs font-medium text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => updateCosting(costingIndex, { ingredients: [...costing.ingredients, { inventoryItemId: "", name: "", amount: 0, unit: "ml" }] })}
                        className="mt-3 text-xs font-medium text-neutral-700"
                      >
                        + Add ingredient
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}

          {recipeCostings.length === 0 ? (
            <div className="rounded-lg border border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
              No recipes yet.
            </div>
          ) : null}
        </div>
      )}

      {activeTab === "transactions" && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-4 items-center bg-neutral-50 p-3 rounded-lg border border-neutral-400 text-sm">
            <div className="flex min-w-0 w-full items-center gap-2 sm:flex-1">
              <span className="shrink-0 text-xs text-neutral-600">Search:</span>
              <input type="text" placeholder="Search product..." value={filterKeyword} onChange={(e) => setFilterKeyword(e.target.value)} className="min-w-0 flex-1 bg-white border border-neutral-400 rounded px-2 py-1 text-xs sm:max-w-xs" />
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-neutral-400 bg-white shadow-sm">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-black border-b border-black text-white font-semibold text-xs">
                  <th className="p-3 border-r border-white/15">Date</th>
                  <th className="p-3 border-r border-white/15">Product Name</th>
                  <th className="p-3 border-r border-white/15 text-right">Quantity</th>
                  <th className="p-3 border-r border-white/15 text-right">Price</th>
                  <th className="p-3 border-r border-white/15 text-right">Amount</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.length === 0 ? (
                  <tr><td colSpan={6} className="p-4 text-center text-neutral-500 text-xs">No transactions found for this date range.</td></tr>
                ) : (
                  filteredTransactions.map((t) => (
                    <tr key={t.id} className="border-b border-neutral-200 hover:bg-neutral-50 text-xs">
                      <td className="p-3 border-r border-neutral-200 text-neutral-600 font-medium whitespace-nowrap">
                        {phDateTimeLabel(t.createdAt)}
                      </td>
                      <td className="p-3 border-r border-neutral-200 font-medium">
                        <DrinkLines lines={t.productLines} />
                      </td>
                      <td className="p-3 border-r border-neutral-200 text-right">{t.quantity}</td>
                      <td className="p-3 border-r border-neutral-200 text-right">₱{t.price.toFixed(2)}</td>
                      <td className="p-3 border-r border-neutral-200 text-right font-semibold">₱{t.amount.toFixed(2)}</td>
                      <td className="p-3 text-center">
                        <RowActions
                          deleteLabel={`Delete ${t.productName}`}
                          deleteDisabled={deletingTransactionId === t.id}
                          onDelete={() => void handleDeleteTransaction(t.id)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "stock" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-neutral-300 bg-neutral-50 px-4 py-3">
            <div className="text-xs font-medium text-neutral-500">Total Cups Used</div>
            <div className="mt-1 text-xl font-semibold text-neutral-900">
              {stocks
                .filter((item) => looksLikeCupItem(item, recipeCostings))
                .reduce((total, cupItem) => {
                  const ledger = stockLedgerForRange({ itemName: cupItem.name, inventoryItemId: cupItem.id, liveStock: cupItem.stock, from: rangeStart, to: rangeEnd, restocks, usages });
                  return total + Number(ledger.used || 0);
                }, 0)
                .toFixed(2)} cups
            </div>
          </div>
          {stockNotice ? <p className="text-sm text-red-600">{stockNotice}</p> : null}
          <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-400 space-y-4">
            <h3 className="text-xs font-bold text-neutral-700 uppercase">{editStockId ? "Edit Stock Item" : "Add Stock Item"}</h3>
            <form onSubmit={handleSaveStock} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-7 gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Item Name</label>
                <input type="text" placeholder="e.g. Coffee Beans" value={stockName} onChange={(e) => setStockName(e.target.value)} className="w-full bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Total Unit Item</label>
                <input type="number" placeholder="e.g. 1000" value={stockPurchaseUnitSize} onChange={(e) => setStockPurchaseUnitSize(e.target.value)} className="w-full bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Unit Item</label>
                <input type="number" placeholder="e.g. 9" value={stockCupUsageAmount} onChange={(e) => setStockCupUsageAmount(e.target.value)} className="w-full bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Quantity</label>
                <input type="number" placeholder="0" value={stockQty} onChange={(e) => setStockQty(e.target.value)} className="w-full bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Unit</label>
                <input type="text" placeholder="grams, ml, pcs" value={stockUnit} onChange={(e) => setStockUnit(e.target.value)} className="w-full bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Cups make</label>
                <div className="w-full rounded border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm text-neutral-700">
                  {stockUnit.trim() && Number(stockPurchaseUnitSize) > 0 && Number(stockCupUsageAmount) > 0 ? (Number(stockPurchaseUnitSize) / Number(stockCupUsageAmount)).toFixed(2) : "—"}
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="flex-1 bg-black text-white px-4 py-1.5 rounded text-sm font-medium">{editStockId ? "Update" : "Add"}</button>
                <button type="button" onClick={resetStockForm} className="border border-neutral-300 bg-white text-black hover:bg-neutral-100 px-4 py-1.5 rounded text-sm font-medium">Clear</button>
              </div>
            </form>
          </div>

          <div className="overflow-x-auto rounded-lg border border-neutral-400 bg-white">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="bg-white border-b border-neutral-300 text-black text-xs font-semibold">
                  <th className="p-2 border-r border-neutral-300">Item</th>
                  <th className="p-2 border-r border-neutral-300 text-right">Opening</th>
                  <th className="p-2 border-r border-neutral-300 text-right">Restock</th>
                  <th className="p-2 border-r border-neutral-300 text-right">Used per Unit</th>
                  <th className="p-2 border-r border-neutral-300">Unit</th>
                  <th className="p-2 border-r border-neutral-300 text-right">Used per Pcs</th>
                  <th className="p-2 border-r border-neutral-300 text-right">Remaining</th>
                  <th className="p-2 border-r border-neutral-300 text-right">Cups Left</th>
                  <th className="p-2 border-r border-neutral-300 text-center">Restock</th>
                  <th className="p-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => {
                  const { opening, restocked, used, remaining } = stockLedgerForRange({
                    itemName: s.name,
                    inventoryItemId: s.id,
                    liveStock: s.stock,
                    from: rangeStart,
                    to: rangeEnd,
                    restocks,
                    usages,
                  });
                  const isLiveDate = isLiveRange;
                  const recipe = costingIngredientForItem(costings, s.name);
                  const configuredUsage = configuredUsagePerUnit(s);
                  const cupsLeft = recipe
                    ? cupsFromQuantity(remaining, recipe)
                    : configuredCupsLeft(s, remaining) ??
                      (s.unit.trim().toLowerCase() !== "pcs" && s.cupsMake != null
                        ? Number(s.cupsMake)
                        : null);
                  return (
                    <tr key={s.id} className="border-b border-neutral-200 text-xs">
                      <td className="p-2 border-r border-neutral-200 font-medium">{s.name}</td>
                      <td className="p-2 border-r border-neutral-200 text-right">{toPieceQuantity(s, opening).toFixed(2)} pcs</td>
                      <td className="p-2 border-r border-neutral-200 text-right font-semibold text-black">
                        {restocked > 0 ? `+${toPieceQuantity(s, restocked).toFixed(2)}` : "0.00"} pcs
                      </td>
                      <td className="p-1 border-r border-neutral-200 text-right text-red-600 font-medium">
                        <input
                          aria-label={`Used stock for ${s.name}`}
                          type="number"
                          min="0"
                          value={used}
                          readOnly={!isLiveDate}
                          onChange={(e) => handleTotalUsedChange(s.name, e.target.value)}
                          className="w-24 bg-white border border-neutral-400 rounded px-2 py-1 text-right text-red-600 font-medium"
                        />
                      </td>
                      <td className="p-2 border-r border-neutral-200 text-neutral-600">{s.unit}</td>
                      <td className="p-2 border-r border-neutral-200 text-right text-neutral-600">{inventoryUsagePerPiece(s, Number(used))}</td>
                      <td className="p-2 border-r border-neutral-200 text-right font-bold">
                        <div className="flex items-center justify-end gap-1"><input
                          aria-label={`Remaining stock for ${s.name}`}
                          type="number"
                          min="0"
                          value={toPieceQuantity(s, remaining).toFixed(2)}
                          readOnly={!isLiveDate}
                          onChange={(e) => {
                            if (!isLiveDate) return;
                            const nextStock = Math.max(0, toBaseQuantity(s, Number(e.target.value) || 0));
                            setStocks((currentStocks) =>
                              currentStocks.map((item) => item.id === s.id ? { ...item, stock: nextStock } : item),
                            );
                          }}
                          onBlur={(e) => {
                            if (!isLiveDate) return;
                            const nextStock = Math.max(0, toBaseQuantity(s, Number(e.target.value) || 0));
                            const nextStocks = stocksRef.current.map((item) =>
                              item.id === s.id ? { ...item, stock: nextStock } : item,
                            );
                            setStocks(nextStocks);
                            void persistInventory(nextStocks);
                          }}
                          className="w-24 bg-white border border-neutral-400 rounded px-2 py-1 text-right font-bold"
                        /><span className="font-normal">pcs</span></div>
                      </td>
                      <td className="p-3 border-r border-neutral-200 text-right text-neutral-600">
                        {s.unit.trim().toLowerCase() === "pcs" || cupsLeft == null ? "—" : `${cupsLeft.toFixed(1)} cups`}
                      </td>
                      <td className="p-3 border-r border-neutral-200 text-center">
                        <form
                          className="flex items-center justify-center gap-1"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleInlineRestock(s);
                          }}
                        >
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            placeholder="+Qty"
                            aria-label={`Restock quantity for ${s.name}`}
                            value={inlineRestockValues[s.id] || ""}
                            onChange={(e) => setInlineRestockValues({ ...inlineRestockValues, [s.id]: e.target.value })}
                            className="w-20 bg-white border border-neutral-400 rounded px-2 py-1 text-xs text-right"
                          />
                          <button
                            type="submit"
                            disabled={restockingItemId === s.id}
                            className="bg-black hover:bg-neutral-800 text-white px-2.5 py-1 rounded text-xs font-medium disabled:opacity-40"
                          >
                            {restockingItemId === s.id ? "Adding..." : "Add"}
                          </button>
                        </form>
                      </td>

                      <td className="p-3 text-center">
                        <RowActions
                          editLabel={`Edit ${s.name}`}
                          deleteLabel={`Delete ${s.name}`}
                          onEdit={() => handleEditStock(s)}
                          onDelete={() => void handleDeleteStock(s.id)}
                          onDeleteMouseDown={(event) => event.preventDefault()}
                        />

                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "restock" && (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-lg border border-neutral-400 bg-white">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="bg-black border-b border-black text-white text-xs font-semibold">
                  <th className="p-3 border-r border-white/15">Date & Time</th>
                  <th className="p-3 border-r border-white/15">Item Name</th>
                  <th className="p-3 border-r border-white/15 text-right">Added Qty</th>
                  <th className="p-3 border-r border-white/15">Unit</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filteredRestocks = restocks.filter((r) => inDateRange(r.date));
                  if (filteredRestocks.length === 0) {
                    return <tr><td colSpan={5} className="p-8 text-center text-sm text-neutral-500">No restock data for this date range.</td></tr>;
                  }
                  return filteredRestocks.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-200 text-xs">
                    <td className="p-3 border-r border-neutral-200 text-neutral-600 font-medium">{phDateTimeLabel(r.date)}</td>
                    <td className="p-3 border-r border-neutral-200 font-medium">{r.itemName}</td>
                    <td className="p-3 border-r border-neutral-200 text-right font-bold text-black">
                      {/* New rows persist the purchase-facing entry
                          (purchaseQty/purchaseUnit) so history shows exactly
                          what was entered even if the item's config changes
                          later. Legacy rows fall back to converting
                          quantity_added (base units) via purchaseUnitSize. */}
                      +{formatQty(r.purchaseQty ?? toPieceQuantity(stocks.find((item) => matchesInventoryRow({ itemName: r.itemName, inventoryItemId: r.inventoryItemId }, { name: item.name, inventoryItemId: item.id })) ?? {}, r.quantityAdded))}
                    </td>
                    <td className="p-3 border-r border-neutral-200 text-neutral-600">{r.purchaseUnit ?? "pcs"}</td>
                    <td className="p-3 text-center">
                      <RowActions
                        deleteLabel={`Delete restock ${r.itemName}`}
                        onDelete={() => void handleDeleteRestock(r.id)}
                      />
                    </td>
                  </tr>
                                  ))
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "costing" && (
        <div className="space-y-6">
          <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-400 space-y-4">
            <h3 className="text-xs font-bold text-neutral-700 uppercase">{editCostingId ? "Edit Costing Config" : "Configure Product Costing & Ingredients"}</h3>
            <form onSubmit={handleSaveCosting} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Product Name</label>
                  <input type="text" placeholder="e.g. Iced Latte" value={costingProduct} onChange={(e) => setCostingProduct(e.target.value)} className="w-full bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-neutral-600">
                  Recipe yield: pack amount and how many cups that pack makes. Per cup is calculated automatically.
                </label>
                {costingIngs.map((ing, idx) => (
                  <div key={idx} className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                    <input type="text" placeholder="Ingredient Name (e.g. Coffee Beans)" value={ing.name} onChange={(e) => {
                      const updated = [...costingIngs];
                      updated[idx].name = e.target.value;
                      setCostingIngs(updated);
                    }} className="col-span-2 flex-1 bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
                    <input type="number" min="0" step="0.01" placeholder="Pack amount" value={ing.amount || ""} onChange={(e) => {
                      const updated = [...costingIngs];
                      updated[idx].amount = Number(e.target.value);
                      setCostingIngs(updated);
                    }} className="w-full sm:w-24 bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
                      <input type="text" placeholder="Unit" value={ing.unit} onChange={(e) => {
                      const updated = [...costingIngs];
                      updated[idx].unit = e.target.value;
                      setCostingIngs(updated);
                    }} className="w-full sm:w-28 bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" />
                    <input type="number" min="0" step="0.01" placeholder="Cups produced" value={ing.outputCups || ""} onChange={(e) => {
                      const updated = [...costingIngs];
                      updated[idx].outputCups = Number(e.target.value);
                      setCostingIngs(updated);
                    }} className="w-full sm:w-28 bg-white border border-neutral-400 rounded px-3 py-1.5 text-sm" aria-label="Cups produced" />
                    <button
                      type="button"
                      aria-label="Remove ingredient"
                      onClick={() => setCostingIngs(costingIngs.filter((_, i) => i !== idx))}
                      className={`${iconBtn} hover:bg-red-50 hover:text-red-600`}
                    >
                      
                      <TrashIcon />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setCostingIngs([...costingIngs, { name: "", amount: 0, unit: "", outputCups: 0 }])} className="text-xs border border-neutral-300 bg-white text-black hover:bg-neutral-100 px-3 py-1 rounded">
                  + Add Ingredient
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="submit" className="bg-black text-white px-4 py-1.5 rounded text-sm font-medium">{editCostingId ? "Update Costing" : "Save Costing"}</button>
                <button type="button" onClick={() => { setEditCostingId(null); setCostingProduct(""); setCostingIngs([{ name: "", amount: 0, unit: "", outputCups: 0 }]); }} className="border border-neutral-300 bg-white text-black hover:bg-neutral-100 px-4 py-1.5 rounded text-sm font-medium">Clear</button>
              </div>
            </form>
          </div>

          <div className="overflow-x-auto rounded-lg border border-neutral-400 bg-white">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead>
                <tr className="bg-black border-b border-black text-white text-xs font-semibold">
                  <th className="p-3 border-r border-white/15">Item</th>
                  <th className="p-3 border-r border-white/15">Pack recipe</th>
                  <th className="p-3 border-r border-white/15">Per cup</th>
                  <th className="p-3 border-r border-white/15 text-right">{isLiveRange ? "Used today" : "Used"}</th>
                  <th className="p-3 border-r border-white/15 text-right">Stock</th>
                  <th className="p-3 border-r border-white/15 text-right">Cups left</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {costings.map((c) => {
                  const ing = c.ingredients[0];
                  const stock = stocks.find((item) => itemNameEquals(item.name, c.productName) || (ing ? itemNameEquals(item.name, ing.name) : false));
                  const remaining = stock?.stock ?? 0;
                  const used = hasTransactionsInRange
                    ? usages
                        .filter((entry) => inDateRange(entry.date))
                        .filter((entry) => itemNameEquals(entry.itemName, c.productName) || (ing ? itemNameEquals(entry.itemName, ing.name) : false))
                        .reduce((sum, entry) => sum + entry.usedAmount, 0)
                    : 0;
                  const perCup = ing ? perCupAmount(ing) : 0;
                  const cupsLeft = ing ? cupsFromQuantity(remaining, ing) : 0;
                  const cupsUsed = ing ? cupsFromQuantity(used, ing) : 0;
                  return (
                    <tr key={c.id} className="border-b border-neutral-200 text-xs">
                      <td className="p-3 border-r border-neutral-200 font-medium">{c.productName}</td>
                      <td className="p-3 border-r border-neutral-200">
                        {ing ? `${ing.amount} ${ing.unit} → ${ing.outputCups ?? 0} cups` : "—"}
                      </td>
                      <td className="p-3 border-r border-neutral-200">
                        {ing && perCup > 0 ? `${perCup.toFixed(2)} ${ing.unit}` : "—"}
                      </td>
                      <td className="p-3 border-r border-neutral-200 text-right text-red-600">
                        {used} {ing?.unit} ({cupsUsed.toFixed(1)} cups)
                      </td>
                      <td className="p-3 border-r border-neutral-200 text-right">
                        {remaining} {stock?.unit || ing?.unit}
                      </td>
                      <td className="p-3 border-r border-neutral-200 text-right font-semibold">
                        {cupsLeft.toFixed(1)} cups
                      </td>
                      <td className="p-3 text-center">
                        <RowActions
                          editLabel={`Edit costing ${c.productName}`}
                          deleteLabel={`Delete costing ${c.productName}`}
                          onEdit={() => handleEditCosting(c)}
                          onDelete={() => void handleDeleteCosting(c.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "used" && (
        <div className="space-y-6">
          <div className="overflow-x-auto rounded-lg border border-neutral-400 bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="bg-black border-b border-black text-white text-xs font-semibold">
                  <th className="p-3 border-r border-white/15">Order ID</th>
                  <th className="p-3 border-r border-white/15">Date</th>
                  <th className="p-3">Sold as</th>
                </tr>
              </thead>
              <tbody>
                {usageGroups.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-neutral-500 text-xs">
                      No usage records found.
                    </td>
                  </tr>
                ) : (
                  usageGroups.map((group) => {
                    const open = openUsageOrders.includes(group.orderId);
                    return (
                      <Fragment key={group.orderId}>
                        <tr
                          className="cursor-pointer border-b border-neutral-200 text-xs hover:bg-neutral-50"
                          onClick={() =>
                            setOpenUsageOrders((current) =>
                              current.includes(group.orderId)
                                ? current.filter((id) => id !== group.orderId)
                                : [...current, group.orderId],
                            )
                          }
                        >
                          <td className="p-3 border-r border-neutral-200 font-semibold">
                            <span className="inline-flex items-center gap-2">
                              <svg
                                viewBox="0 0 24 24"
                                className={`h-3.5 w-3.5 stroke-current transition ${open ? "rotate-90" : ""}`}
                                fill="none"
                              >
                                <path d="M9 6l6 6-6 6" strokeWidth="1.8" />
                              </svg>
                              {group.orderLabel}
                            </span>
                          </td>
                          <td className="p-3 border-r border-neutral-200 text-neutral-600 font-medium whitespace-nowrap">
                            {phDateTimeLabel(group.date)}
                          </td>
                          <td className="p-3 text-neutral-600">
                            <DrinkLines lines={group.soldAsLines} />
                          </td>
                        </tr>
                        {open ? (
                          <tr className="border-b border-neutral-200 bg-neutral-50">
                            <td colSpan={3} className="p-0">
                              <table className="w-full text-left text-xs">
                                <thead>
                                  <tr className="text-[10px] tracking-wide text-neutral-500 uppercase">
                                    <th className="px-3 py-2 pl-10">Item Name</th>
                                    <th className="px-3 py-2 text-right">Used Amount</th>
                                    <th className="px-3 py-2 text-center">Unit</th>
                                    <th className="px-3 py-2 text-right">Remaining</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="px-3 py-3 pl-10 text-neutral-500">
                                        No recipe assigned for these items, so no stock was deducted.
                                      </td>
                                    </tr>
                                  ) : (
                                    group.items.map((usage, index) => (
                                      <tr key={`${usage.id}-${index}`}>
                                        <td className="px-3 py-2 pl-10 font-medium">{usage.itemName}</td>
                                        <td className="px-3 py-2 text-right font-bold text-red-600">
                                          -{formatQty(usage.usedAmount)}
                                        </td>
                                        <td className="px-3 py-2 text-center text-neutral-600">{usage.unit}</td>
                                        <td className="px-3 py-2 text-right font-semibold">
                                          {formatQty(usage.remaining)}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}