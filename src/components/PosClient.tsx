"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "@/actions/auth";
import { punchBaristaShift } from "@/actions/users";
import {
  createOrder,
  openPos,
} from "@/actions/pos";
import {
  SalePurchaseTransactions,
  type InventoryTab,
} from "@/components/SalePurchaseTransactions";
import {
  addonAllowsQty,
  cartLineKey,
  cartLineUnitPrice,
  drinkDisplayName,
  drinkStyleLabel,
  formatMoney,
  menuSizePrice,
  normalizeMenuAddons,
  normalizeMenuSizes,
  normalizeMenuStyles,
  orderLineListLabel,
  orderLineOptionsLabel,
  resolveOrderAddons,
} from "@/lib/menu";
import { phDateString, phDateTimeLabel } from "@/lib/datetime";
import { PAYMENT_METHODS, parsePayment, paymentLabel } from "@/lib/payments";
import type {
  DrinkStyle,
  MenuItem,
  Order,
  OrderAddon,
  OrderItem,
  PaymentMethod,
  PosState,
  Session,
  StoreData,
} from "@/lib/types";

type PosClientProps = {
  session: Session;
  pos: PosState;
  menu: MenuItem[];
  categories: string[];
  orders: Order[];
  clockedInBaristas: { id: string; name: string; username: string }[];
  inventoryStore: Pick<
    StoreData,
    | "orders"
    | "inventory"
    | "usageLogs"
    | "restocks"
    | "costings"
    | "recipes"
    | "recipeCostings"
    | "menu"
  >;
};

type PosPanel = "pos" | Extract<InventoryTab, "stock" | "restock">;

const CASH_PRESETS = [500, 1000, 2000];
const CHECKOUT_KEY = "coffeezz_pos_checkout";
type SavedCheckout = {
  userId: string;
  cart: OrderItem[];
  tendered: string;
  paymentMethod: PaymentMethod;
};

function readCheckout(userId: string, menu: MenuItem[]): SavedCheckout | null {
  try {
    const raw = window.localStorage.getItem(CHECKOUT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedCheckout;
    if (saved.userId !== userId || !Array.isArray(saved.cart)) return null;

    const catalog = new Map(menu.map((item) => [item.id, item]));
    const cart = saved.cart.flatMap((item) => {
      const product = catalog.get(item.productId);
      if (!product || product.available === false) return [];
      const qty = Math.floor(Number(item.qty));
      if (!Number.isFinite(qty) || qty < 1) return [];
      const sizes = normalizeMenuSizes(product.sizes);
      const selectedSize = sizes.find((size) => size.label === item.size) ?? sizes[0];
      const style = item.style === "hot" || item.style === "iced" ? item.style : undefined;
      const addons = resolveOrderAddons(product, item.addons);
      return [
        {
          productId: product.id,
          name: product.name,
          qty,
          price: selectedSize?.price ?? product.price,
          size: selectedSize?.label,
          style,
          addons,
        },
      ];
    });

    return {
      userId,
      cart,
      tendered: typeof saved.tendered === "string" ? saved.tendered : "",
      paymentMethod: parsePayment(saved.paymentMethod),
    };
  } catch {
    return null;
  }
}

function writeCheckout(value: SavedCheckout) {
  window.localStorage.setItem(CHECKOUT_KEY, JSON.stringify(value));
}

export function PosClient({
  session,
  pos,
  menu,
  categories,
  orders,
  clockedInBaristas,
  inventoryStore,
}: PosClientProps) {
  const router = useRouter();
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [tendered, setTendered] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [message, setMessage] = useState<string | null>(null);
  const [baristaModalOpen, setBaristaModalOpen] = useState(false);
  const [baristaUsername, setBaristaUsername] = useState("");
  const [baristaPassword, setBaristaPassword] = useState("");
  const [baristaNotice, setBaristaNotice] = useState<string | null>(null);
  const [onShift, setOnShift] = useState(clockedInBaristas);
  const [drinkPick, setDrinkPick] = useState<{
    item: MenuItem;
    style?: DrinkStyle;
    size?: string;
    addons: Record<string, number>;
    qty?: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<PosPanel>("pos");
  const [managerSearch, setManagerSearch] = useState("");
  const [managerTodayOnly, setManagerTodayOnly] = useState(true);

  // Helper function to normalize category strings (combines "Non Coffee" and "Non-Coffee")
  const normalizeCat = (catName: string) => catName.replace(/^non\s*coffee$/i, "Non-Coffee");
  const isAddOnCategory = (catName: string) => {
    const normalized = catName.replace(/[^a-z]/gi, "").toLowerCase();
    return normalized === "addons" || normalized === "addson";
  };

  // Deduplicate categories for the filter buttons
  const floorCategories = useMemo(() => {
    const set = new Set<string>();
    categories.forEach((cat) => {
      if (isAddOnCategory(cat)) return;
      set.add(normalizeCat(cat));
    });
    return ["All", ...Array.from(set)];
  }, [categories]);

  // Filter items based on query and normalized category match
  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return menu.filter((item) => {
      if (!item.available) return false;
      if (isAddOnCategory(item.category)) return false;

      const itemCatNormalized = normalizeCat(item.category);
      const selectedCatNormalized = normalizeCat(category);

      const matchesCategory =
        category === "All" || itemCatNormalized === selectedCatNormalized;
      const matchesQuery = !needle || item.name.toLowerCase().includes(needle);

      return matchesCategory && matchesQuery;
    });
  }, [menu, category, query]);

  useEffect(() => {
    setOnShift((current) => {
      const ids = new Set(clockedInBaristas.map((entry) => entry.id));
      return [...clockedInBaristas, ...current.filter((entry) => !ids.has(entry.id))];
    });
  }, [clockedInBaristas]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const saved = readCheckout(session.userId, menu);
      if (saved) {
        setCart(saved.cart);
        setTendered(saved.tendered);
        setPaymentMethod(saved.paymentMethod);
      }
      setCheckoutReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session.userId, menu]);

  useEffect(() => {
    if (!checkoutReady) return;
    writeCheckout({
      userId: session.userId,
      cart,
      tendered,
      paymentMethod,
    });
  }, [checkoutReady, session.userId, cart, tendered, paymentMethod]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const subtotal = cart.reduce((sum, item) => sum + cartLineUnitPrice(item) * item.qty, 0);
  const total = subtotal;
  const isCash = paymentMethod === "cash";
  const paid = isCash ? Number(tendered) || 0 : total;
  const change = isCash && paid >= total ? paid - total : 0;
  const isManager = session.role === "manager";
  const canCharge =
    !isManager &&
    pos.isOpen &&
    cart.length > 0 &&
    (!isCash || paid >= total);
  const managerOrders = useMemo(() => {
    const needle = managerSearch.trim().toLowerCase();
    const today = phDateString();
    return [...orders]
      .filter((order) => !managerTodayOnly || phDateString(order.createdAt) === today)
      .filter((order) => {
        if (!needle) return true;
        const text = [
          String(order.ticketNo ?? ""),
          order.baristaName,
          formatMoney(order.total),
          ...order.items.map((item) => `${item.qty} ${orderLineListLabel(item)}`),
        ].join(" ").toLowerCase();
        return text.includes(needle);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, managerSearch, managerTodayOnly]);
  function selectedAddonsFor(item: MenuItem, selected: Record<string, number>): OrderAddon[] {
    return resolveOrderAddons(
      item,
      normalizeMenuAddons(item).map((addon) => ({
        id: addon.id,
        name: addon.name,
        price: addon.price,
        qty: selected[addon.id] ?? 0,
      })),
    );
  }

  function addItem(
    id: string,
    name: string,
    price: number,
    size?: string,
    style?: DrinkStyle,
    addons: OrderAddon[] = [],
  ) {
    if (!pos.isOpen || isManager) {
      return;
    }
    const nextLine = { productId: id, name, qty: 1, price, size, style, addons };
    const nextKey = cartLineKey(nextLine);
    setCart((current) => {
      const existing = current.find((item) => cartLineKey(item) === nextKey);
      if (existing) {
        return current.map((item) =>
          cartLineKey(item) === nextKey ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [...current, nextLine];
    });
    setMessage(null);
  }

 function handleMenuTap(item: MenuItem) {
    const styles = normalizeMenuStyles(item);
    const addons = normalizeMenuAddons(item);
    const sizes = normalizeMenuSizes(item.sizes);
    if (sizes.length > 1 || styles.length > 1 || addons.length > 0) {
      setDrinkPick({
        item,
        style: styles.length === 1 ? styles[0] : undefined,
        size: sizes.length === 1 ? sizes[0].label : undefined,
        addons: {},
        qty: 1,
      });
      return;
    }
    addItem(
      item.id,
      item.name,
      menuSizePrice(item, sizes[0]?.label),
      sizes[0]?.label,
      styles[0],
    );
  }

  return (
    <div className="pos-root relative flex h-svh flex-col overflow-hidden bg-neutral-100 text-black">
      <div className="pos-screen flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-3 bg-black px-3 text-white">
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white transition hover:bg-neutral-800"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 stroke-current" fill="none">
              {menuOpen ? (
                <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" />
              ) : (
                <path d="M5 8h14M5 12h14M5 16h14" strokeWidth="1.8" />
              )}
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              setActivePanel("pos");
              setMenuOpen(false);
            }}
            className="text-base font-bold tracking-tight"
          >
            Coffee ZZ
          </button>
          {activePanel !== "pos" ? (
            <p className="truncate text-sm font-medium text-white/70">
              {activePanel === "stock" ? "Stock inventory" : "Restock"}
            </p>
          ) : null}
        </header>

        <button
          type="button"
          tabIndex={menuOpen ? 0 : -1}
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
            menuOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="POS menu"
          aria-hidden={!menuOpen}
          className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white text-black shadow-[0_18px_50px_rgba(0,0,0,0.18)] transition-transform duration-200 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
            <button
              type="button"
              onClick={() => {
                setActivePanel("pos");
                setMenuOpen(false);
              }}
              className="text-sm font-semibold tracking-tight"
            >
              Coffee ZZ
            </button>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 transition hover:border-black hover:bg-black hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 stroke-current" fill="none">
                <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <button
              type="button"
              aria-current={activePanel === "pos" ? "page" : undefined}
              onClick={() => {
                setActivePanel("pos");
                setMenuOpen(false);
              }}
              className={`mb-3 w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                activePanel === "pos"
                  ? "bg-black text-white"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-black"
              }`}
            >
              POS
            </button>
            {!isManager ? (
              <div>
                <p className="px-4 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
                  Inventory
                </p>
                {(
                  [
                    ["stock", "Stock inventory"],
                    ["restock", "Restock"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={activePanel === id ? "page" : undefined}
                    onClick={() => {
                      setActivePanel(id);
                      setMenuOpen(false);
                    }}
                    className={`mb-1 w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                      activePanel === id
                        ? "bg-black text-white"
                        : "text-neutral-600 hover:bg-neutral-100 hover:text-black"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-4 border-t border-neutral-100 pt-4">
              <p className="px-4 pb-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
                Baristas
              </p>
              {onShift.map((barista) => (
                <div
                  key={barista.id}
                  className="mb-1 flex items-center justify-between gap-2 rounded-2xl px-4 py-2.5"
                >
                  <p className="min-w-0 truncate text-sm font-medium">In - {barista.name}</p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await punchBaristaShift({ type: "logout", userId: barista.id });
                        if (result && "error" in result && result.error) {
                          setMessage(result.error);
                          return;
                        }
                        setOnShift((current) => current.filter((entry) => entry.id !== barista.id));
                        setMessage(`${barista.name} clocked out.`);
                        router.refresh();
                      })
                    }
                    className="shrink-0 rounded-full border border-neutral-300 px-3 py-1 text-xs font-medium hover:border-black disabled:opacity-40"
                  >
                    Out
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setBaristaUsername("");
                  setBaristaPassword("");
                  setBaristaNotice(null);
                  setBaristaModalOpen(true);
                  setMenuOpen(false);
                }}
                className="w-full rounded-2xl px-4 py-3 text-left text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-black"
              >
                {onShift.length === 0 ? "Barista in" : "Barista in / out"}
              </button>
            </div>
          </div>

          <div className="border-t border-neutral-200 p-3">
            <p className="px-4 py-2 text-sm font-medium text-neutral-900">
              {session.name}
              <span className="ml-2 text-xs font-normal text-neutral-400">
                {isManager ? "manager" : "cashier"}
              </span>
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (cart.length > 0) {
                  setMessage("Finish checkout before logging out.");
                  setMenuOpen(false);
                  return;
                }
                startTransition(async () => await logout());
              }}
              className="w-full rounded-2xl px-4 py-3 text-left text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-black disabled:opacity-40"
            >
              {pending ? "Logging out..." : "Log out"}
            </button>
          </div>
        </aside>

        {drinkPick ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
              <button
                type="button"
                aria-label="Close drink options"
                onClick={() => setDrinkPick(null)}
                className="absolute top-5 right-5 flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-black"
              >
                ×
              </button>
              <h2 className="text-xl font-semibold tracking-tight">{drinkPick.item.name}</h2>
              {normalizeMenuSizes(drinkPick.item.sizes).length > 1 ? (
                <>
                  <p className="mt-1 text-sm text-neutral-500">Choose a size.</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {normalizeMenuSizes(drinkPick.item.sizes).map((size) => (
                      <button
                        key={size.label}
                        type="button"
                        onClick={() => setDrinkPick({ ...drinkPick, size: size.label })}
                        className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                          drinkPick.size === size.label
                            ? "border-black bg-black text-white"
                            : "border-neutral-200 hover:border-black hover:bg-black hover:text-white"
                        }`}
                      >
                        <span className="block">{size.label}</span>
                        <span className="mt-1 block text-xs opacity-75">{formatMoney(size.price)}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {normalizeMenuStyles(drinkPick.item).length > 1 ? (
                <>
                  <p className="mt-1 text-sm text-neutral-500">Choose Iced or Hot.</p>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    {normalizeMenuStyles(drinkPick.item).map((style) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => {
                          const next = { ...drinkPick, style };
                          setDrinkPick(next);
                        }}
                        className={`rounded-2xl border px-4 py-4 text-sm font-medium ${
                          drinkPick.style === style
                            ? "border-black bg-black text-white"
                            : "border-neutral-200 hover:border-black hover:bg-black hover:text-white"
                        }`}
                      >
                        {drinkStyleLabel(style)}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-neutral-500">Add extras if you want them.</p>
              )}

              {/* Quantity Selector para sa Item */}
              <div className="mt-5 flex items-center justify-between rounded-2xl border border-neutral-200 px-4 py-3">
                <span className="text-sm font-medium text-neutral-700">Quantity</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDrinkPick({
                        ...drinkPick,
                        qty: Math.max(1, (drinkPick.qty ?? 1) - 1),
                      })
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-sm hover:border-black"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-medium">
                    {drinkPick.qty ?? 1}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDrinkPick({
                        ...drinkPick,
                        qty: Math.min(99, (drinkPick.qty ?? 1) + 1),
                      })
                    }
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-sm hover:border-black"
                  >
                    +
                  </button>
                </div>
              </div>

              {normalizeMenuAddons(drinkPick.item).length > 0 ? (
                <div className="mt-5 space-y-2">
                  <p className="text-sm text-neutral-500">Add-ons</p>
                  {normalizeMenuAddons(drinkPick.item).map((addon) => {
                    const qty = drinkPick.addons[addon.id] ?? 0;
                    const on = qty > 0;
                    const canQty = addonAllowsQty(addon);
                    return (
                      <button
                        key={addon.id}
                        type="button"
                        onClick={() =>
                          setDrinkPick({
                            ...drinkPick,
                            addons: { ...drinkPick.addons, [addon.id]: on ? 0 : 1 },
                          })
                        }
                        className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                          on ? "border-black bg-neutral-50" : "border-neutral-200 bg-white"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{addon.name}</p>
                          <p className="mt-0.5 text-[11px] text-neutral-500">
                            {qty > 1
                              ? `x${qty} · +₱${(addon.price || 0) * qty}`
                              : `+₱${addon.price || 0}${canQty ? " each" : ""}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {canQty && on ? (
                            <div
                              className="flex items-center gap-1"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <span
                                role="button"
                                onClick={() =>
                                  setDrinkPick({
                                    ...drinkPick,
                                    addons: {
                                      ...drinkPick.addons,
                                      [addon.id]: Math.max(0, qty - 1),
                                    },
                                  })
                                }
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 text-sm"
                              >
                                −
                              </span>
                              <span className="w-4 text-center text-xs font-medium">{qty}</span>
                              <span
                                role="button"
                                onClick={() =>
                                  setDrinkPick({
                                    ...drinkPick,
                                    addons: {
                                      ...drinkPick.addons,
                                      [addon.id]: Math.min(9, qty + 1),
                                    },
                                  })
                                }
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 text-sm"
                              >
                                +
                              </span>
                            </div>
                          ) : null}
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                              on ? "border-black" : "border-neutral-300"
                            }`}
                          >
                            {on ? <span className="h-2.5 w-2.5 rounded-full bg-black" /> : null}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <button
                type="button"
                disabled={
                  (normalizeMenuSizes(drinkPick.item.sizes).length > 1 && !drinkPick.size) ||
                  (normalizeMenuStyles(drinkPick.item).length > 1 && !drinkPick.style)
                }
                onClick={() => {
                  const q = drinkPick.qty ?? 1;
                  for (let i = 0; i < q; i++) {
                    addItem(
                      drinkPick.item.id,
                      drinkPick.item.name,
                      menuSizePrice(drinkPick.item, drinkPick.size),
                      drinkPick.size,
                      drinkPick.style,
                      selectedAddonsFor(drinkPick.item, drinkPick.addons)
                    );
                  }
                  setDrinkPick(null);
                }}
                className="mt-5 w-full rounded-2xl bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
              >
                Add to checkout
              </button>
            </div>
          </div>
        ) : null}

        {baristaModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <div className="relative flex w-full max-w-md flex-col rounded-3xl bg-white p-6 shadow-2xl">
              <button
                type="button"
                aria-label="Close barista login"
                onClick={() => setBaristaModalOpen(false)}
                className="absolute top-5 right-5 flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-black transition"
              >
                ×
              </button>
              <h2 className="text-xl font-semibold tracking-tight">Baristas</h2>

              {onShift.length > 0 ? (
                <div className="mt-5 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">On shift</p>
                  {onShift.map((barista) => (
                    <div
                      key={barista.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{barista.name}</p>
                        <p className="truncate text-xs text-neutral-400">{barista.username}</p>
                      </div>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await punchBaristaShift({ type: "logout", userId: barista.id });
                            if (result && "error" in result && result.error) {
                              setBaristaNotice(result.error);
                              return;
                            }
                            setOnShift((current) => current.filter((entry) => entry.id !== barista.id));
                            setBaristaNotice(null);
                            setMessage(`${barista.name} clocked out.`);
                            router.refresh();
                          })
                        }
                        className="shrink-0 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:border-black disabled:opacity-40"
                      >
                        Out
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm text-neutral-500">No barista is on shift yet.</p>
              )}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  startTransition(async () => {
                    const result = await punchBaristaShift({
                      type: "login",
                      username: baristaUsername,
                      password: baristaPassword,
                    });
                    if (result && "error" in result && result.error) {
                      if ("id" in result && result.id) {
                        setOnShift((current) =>
                          current.some((entry) => entry.id === result.id)
                            ? current
                            : [...current, { id: result.id, name: result.name, username: result.username }],
                        );
                      }
                      setBaristaNotice(result.error);
                      return;
                    }
                    if ("id" in result && result.id) {
                      setOnShift((current) =>
                        current.some((entry) => entry.id === result.id)
                          ? current
                          : [...current, { id: result.id, name: result.name, username: result.username }],
                      );
                    }
                    setBaristaUsername("");
                    setBaristaPassword("");
                    setBaristaNotice(null);
                    setMessage(`${"name" in result ? result.name : "Barista"} clocked in.`);
                    router.refresh();
                  });
                }}
                className="mt-5 border-t border-neutral-100 pt-5"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Clock in
                </p>
                <label className="mt-3 block text-xs font-medium text-neutral-600">
                  <span className="mb-1.5 block">Username</span>
                  <input
                    value={baristaUsername}
                    onChange={(event) => setBaristaUsername(event.target.value)}
                    className="w-full rounded-xl border border-neutral-200 px-3.5 py-2.5 text-sm outline-none focus:border-black"
                    autoComplete="username"
                    required
                  />
                </label>
                <label className="mt-3 block text-xs font-medium text-neutral-600">
                  <span className="mb-1.5 block">Password</span>
                  <input
                    type="password"
                    value={baristaPassword}
                    onChange={(event) => setBaristaPassword(event.target.value)}
                    className="w-full rounded-xl border border-neutral-200 px-3.5 py-2.5 text-sm outline-none focus:border-black"
                    autoComplete="current-password"
                    required
                  />
                </label>
                {baristaNotice ? <p className="mt-3 text-sm text-red-600">{baristaNotice}</p> : null}
                <button
                  type="submit"
                  disabled={pending}
                  className="mt-5 w-full rounded-full bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {pending ? "Saving..." : "Clock in"}
                </button>
              </form>
            </div>
          </div>
        ) : null}

        {!isManager && activePanel !== "pos" ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-100 p-2 sm:p-4">
            <SalePurchaseTransactions
              store={inventoryStore}
              tabs={["stock", "restock"]}
              activeTab={activePanel}
              onTabChange={(tab) => {
                if (tab === "stock" || tab === "restock") {
                  setActivePanel(tab);
                }
              }}
              showTabs={false}
            />
          </div>
        ) : (
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          {!pos.isOpen ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-neutral-100 px-6 text-center">
              <p className="font-serif text-4xl italic sm:text-5xl">Closed</p>
              <p className="mt-3 max-w-sm text-sm text-neutral-500">
                Open the POS to take orders.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => openPos())}
                className="mt-8 rounded-full bg-black px-8 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-neutral-800"
              >
                Open POS
              </button>
            </div>
          ) : null}

          {isManager ? (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-100">
              <div className="shrink-0 border-b border-neutral-200 bg-white px-4 py-4 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">Order history</h2>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      {managerOrders.length} {managerOrders.length === 1 ? "order" : "orders"}
                      {managerTodayOnly ? " today" : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex rounded-full border border-neutral-200 bg-neutral-50 p-1">
                      <button
                        type="button"
                        onClick={() => setManagerTodayOnly(true)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          managerTodayOnly ? "bg-black text-white" : "text-neutral-600 hover:text-black"
                        }`}
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => setManagerTodayOnly(false)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                          !managerTodayOnly ? "bg-black text-white" : "text-neutral-600 hover:text-black"
                        }`}
                      >
                        All
                      </button>
                    </div>
                    <div className="relative sm:w-72">
                      <svg
                        viewBox="0 0 24 24"
                        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 stroke-neutral-400"
                        fill="none"
                      >
                        <circle cx="11" cy="11" r="6" strokeWidth="1.6" />
                        <path d="M16 16l4 4" strokeWidth="1.6" />
                      </svg>
                      <input
                        value={managerSearch}
                        onChange={(event) => setManagerSearch(event.target.value)}
                        placeholder="Search ticket, item, or cashier"
                        className="w-full rounded-full border border-neutral-300 bg-white py-2 pr-4 pl-10 text-sm outline-none placeholder:text-neutral-400 focus:border-black"
                      />
                    </div>
                  </div>
                </div>
                {message ? <p className="mt-3 text-sm text-neutral-600">{message}</p> : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                {managerOrders.length === 0 ? (
                  <div className="flex h-full min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white text-sm text-neutral-400">
                    No orders found.
                  </div>
                ) : (
                  <>
                    <div className="space-y-3 md:hidden">
                      {managerOrders.map((order) => (
                        <article key={order.id} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-semibold">
                                #{order.ticketNo ?? order.id.slice(-4)}
                              </p>
                              <p className="mt-0.5 text-xs text-neutral-500">
                                {phDateTimeLabel(order.createdAt)} · {order.baristaName}
                              </p>
                            </div>
                            <p className="text-base font-semibold">{formatMoney(order.total)}</p>
                          </div>
                          <p className="mt-2 text-sm text-neutral-700">
                            {order.items.map((item) => `${item.qty}× ${orderLineListLabel(item)}`).join(", ")}
                          </p>
                          <p className="mt-1 text-xs text-neutral-400">{paymentLabel(order.paymentMethod)}</p>
                        </article>
                      ))}
                    </div>

                    <div className="hidden overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm md:block">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-black text-xs font-semibold tracking-wide text-white uppercase">
                          <tr>
                            <th className="px-4 py-3">Ticket</th>
                            <th className="px-4 py-3">Time</th>
                            <th className="px-4 py-3">Cashier</th>
                            <th className="px-4 py-3">Items</th>
                            <th className="px-4 py-3">Pay</th>
                            <th className="px-4 py-3 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managerOrders.map((order) => (
                            <tr key={order.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                              <td className="px-4 py-4 font-semibold whitespace-nowrap">
                                #{order.ticketNo ?? order.id.slice(-4)}
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-neutral-600">
                                {phDateTimeLabel(order.createdAt)}
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">{order.baristaName}</td>
                              <td className="max-w-[320px] px-4 py-4 text-neutral-700">
                                {order.items.map((item) => `${item.qty}× ${orderLineListLabel(item)}`).join(", ")}
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-neutral-500">
                                {paymentLabel(order.paymentMethod)}
                              </td>
                              <td className="px-4 py-4 text-right font-semibold whitespace-nowrap">
                                {formatMoney(order.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </section>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {/* Menu Catalog Section */}
          <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3 px-4 py-2">
              <div className="relative ml-auto w-full max-w-sm">
                <svg
                  viewBox="0 0 24 24"
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 stroke-neutral-400"
                  fill="none"
                >
                  <circle cx="11" cy="11" r="6" strokeWidth="1.6" />
                  <path d="M16 16l4 4" strokeWidth="1.6" />
                </svg>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search item..."
                  className="w-full rounded-full border border-neutral-300 bg-white py-2 pr-4 pl-10 text-xs outline-none placeholder:text-neutral-400 focus:border-black"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
              {items.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-neutral-400">
                  No items found in this category.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleMenuTap(item)}
                      disabled={isManager}
                      className="rounded-2xl border border-neutral-300 bg-white p-3 text-center transition hover:border-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <p className="text-xs font-medium">{item.name}</p>
                      {normalizeMenuStyles(item).length > 0 ? (
                        <p className="mt-0.5 text-[10px] text-neutral-400">
                          {normalizeMenuStyles(item).map(drinkStyleLabel).join(" / ")}
                          {normalizeMenuAddons(item).length > 0 ? " · Add-ons" : ""}
                        </p>
                      ) : normalizeMenuAddons(item).length > 0 ? (
                        <p className="mt-0.5 text-[10px] text-neutral-400">Add-ons</p>
                      ) : null}
                      <div className={`mt-1 grid gap-1 ${normalizeMenuSizes(item.sizes).length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                        {normalizeMenuSizes(item.sizes).length > 0
                          ? normalizeMenuSizes(item.sizes).map((size) => (
                              <span key={size.label} className="rounded-lg bg-neutral-100 px-1 py-1 text-[10px] leading-tight text-neutral-600">
                                <span className="block text-[9px] text-neutral-400">{size.label}</span>
                                <span className="font-medium text-neutral-800">{formatMoney(size.price)}</span>
                              </span>
                            ))
                          : <span className="text-xs text-neutral-600">{formatMoney(item.price)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Category Navigation */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-200 px-4 py-2">
              {floorCategories.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setCategory(name)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    category === name
                      ? "border-black bg-black text-white"
                      : "border-neutral-300 bg-white hover:border-black"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </section>

          {/* Checkout Panel Sidebar */}
          <aside className="flex min-h-0 w-full flex-col border-t border-neutral-200 bg-white md:w-[320px] lg:w-[350px] md:border-t-0 md:border-l">
            <h2 className="shrink-0 py-2.5 text-center text-lg font-semibold">
              Checkout
            </h2>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 text-[10px] tracking-wide text-neutral-400 uppercase">
              <span>Name</span>
              <span className="w-16 text-center">Qty</span>
              <span className="w-16 text-right">Price</span>
            </div>
            
            {/* Scrollable Order List */}
            <ul className="min-h-[100px] flex-1 overflow-y-auto px-3 py-1">
              {cart.length === 0 ? (
                <li className="py-6 text-center text-xs text-neutral-400">
                  No items yet.
                </li>
              ) : (
                cart.map((item) => (
                  <li
                    key={cartLineKey(item)}
                    className="grid grid-cols-[1fr_auto_auto] items-start gap-x-3 border-b border-neutral-100 py-1.5 last:border-none"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs">{drinkDisplayName(item)}</p>
                      {orderLineOptionsLabel(item) ? (
                        <p className="text-[10px] leading-4 text-neutral-600">
                          {orderLineOptionsLabel(item)}
                        </p>
                      ) : null}
                    </div>
                    <span className="w-16 text-center text-xs">{item.qty}</span>
                    <span className="w-16 text-right text-xs">
                      {formatMoney(cartLineUnitPrice(item) * item.qty)}
                    </span>
                  </li>
                ))
              )}
            </ul>

            {/* Scrollable / Compact Bottom Controls */}
            <div className="shrink-0 max-h-[60vh] overflow-y-auto space-y-2 border-t border-neutral-200 px-3 py-3 text-xs">
              <div>
                <p className="mb-1 text-xs text-neutral-500">Pay with</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {PAYMENT_METHODS.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setPaymentMethod(method.id)}
                      className={`rounded-lg border py-1.5 text-xs transition ${
                        paymentMethod === method.id
                          ? "border-black bg-black text-white"
                          : "border-neutral-300 bg-white hover:border-black"
                      }`}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
              </div>

              {isCash ? (
                <>
                  <label className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-neutral-500">Amount</span>
                    <input
                      inputMode="numeric"
                      value={tendered}
                      onChange={(event) =>
                        setTendered(event.target.value.replace(/[^\d]/g, ""))
                      }
                      placeholder="0"
                      className="w-24 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right outline-none focus:border-black"
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTendered(String(total || ""))}
                      className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-[11px] hover:border-black"
                    >
                      Exact
                    </button>
                    {CASH_PRESETS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTendered(String(value))}
                        className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-[11px] hover:border-black"
                      >
                        {formatMoney(value)}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-neutral-500">
                  {paymentLabel(paymentMethod)} · exact {formatMoney(total)}
                </p>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-500">Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-500">Total</span>
                <span className="text-base font-semibold">{formatMoney(total)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-500">{isCash ? "Change" : "Paid"}</span>
                <span>{formatMoney(isCash ? change : total)}</span>
              </div>

              <button
                type="button"
                disabled={pending || !canCharge}
                onClick={() =>
                  startTransition(async () => {
                    const result = await createOrder(cart, paymentMethod, paid);
                    if (!result.ok) {
                      setMessage(result.error);
                      return;
                    }
                    setCart([]);
                    setTendered("");
                    setPaymentMethod("cash");
                    setMessage(`Paid ${formatMoney(result.total ?? 0)}.`);
                  })
                }
                className="relative w-full rounded-xl border-2 border-black py-2.5 text-xs font-medium transition active:scale-[0.99] disabled:opacity-40"
              >
                Proceed Order
              </button>

              {message ? (
                <p className="text-center text-xs text-neutral-500">{message}</p>
              ) : null}
            </div>
          </aside>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
