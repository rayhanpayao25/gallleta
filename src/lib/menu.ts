import type { DrinkStyle, MenuAddon, MenuItem, OrderAddon, OrderItem } from "@/lib/types";

export const MENU_IMAGES = [
  { label: "Logo", src: "/images/logo.jpg" },
] as const;

export const MENU_CATEGORIES = [
  "Special",
  "Classic",
  "Non-Coffee",
  "Fresh Drinks",
  "Matcha Drinks",
  "Food",
  "Pastries",
] as const;

export const DRINK_STYLES: DrinkStyle[] = ["iced", "hot"];

export function isFoodOrPastry(category: string) {
  return /food|pastr/i.test(category);
}

export function drinkStyleLabel(style: DrinkStyle) {
  return style === "hot" ? "Hot" : "Iced";
}

export function normalizeMenuStyles(item: Pick<MenuItem, "category" | "styles">): DrinkStyle[] {
  if (isFoodOrPastry(item.category)) return [];
  const raw = Array.isArray(item.styles) ? item.styles : DRINK_STYLES;
  const next = DRINK_STYLES.filter((style) => raw.includes(style));
  return next.length > 0 ? next : [...DRINK_STYLES];
}

export function drinkStyleLabelList(item: Pick<MenuItem, "category" | "styles">) {
  const styles = normalizeMenuStyles(item);
  return styles.length > 0 ? styles.map(drinkStyleLabel).join(" / ") : "—";
}

export function parseDrinkStyle(value: unknown): DrinkStyle | undefined {
  return value === "hot" || value === "iced" ? value : undefined;
}

export function addonIdFromName(name: string, index = 0) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "addon"}-${index}`;
}

export function parseStoredOrderAddons(value: unknown): OrderAddon[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const name = String(row.name ?? "").trim();
    if (!name) return [];
    const qty = Math.max(1, Math.min(9, Math.floor(Number(row.qty) || 1)));
    const inventoryItemId = String(row.inventoryItemId ?? "").trim();
    const usageAmount = Math.max(0, Number(row.usageAmount) || 0);
    const usageUnit = String(row.usageUnit ?? "").trim();
    return [
      {
        id: String(row.id ?? "").trim() || addonIdFromName(name, index),
        name,
        price: Math.max(0, Math.round(Number(row.price) || 0)),
        qty,
        inventoryItemId: inventoryItemId || undefined,
        usageAmount: usageAmount || undefined,
        usageUnit: usageUnit || undefined,
      },
    ];
  });
}

export function normalizeMenuAddons(item: Pick<MenuItem, "addons"> | undefined): MenuAddon[] {
  if (!Array.isArray(item?.addons)) return [];
  const seen = new Set<string>();
  return item.addons.flatMap((addon, index) => {
    const name = String(addon?.name ?? "").trim();
    if (!name) return [];
    const price = Math.max(0, Math.round(Number(addon.price) || 0));
    let id = String(addon.id ?? "").trim() || addonIdFromName(name, index);
    if (seen.has(id)) id = `${id}-${index}`;
    seen.add(id);
    const inventoryItemId = String(addon.inventoryItemId ?? "").trim();
    const usageAmount = Math.max(0, Number(addon.usageAmount) || 0);
    const usageUnit = String(addon.usageUnit ?? "").trim();
    return [
      {
        id,
        name,
        price,
        qtyEnabled: Boolean(addon.qtyEnabled),
        inventoryItemId: inventoryItemId || undefined,
        usageAmount: usageAmount || undefined,
        usageUnit: usageUnit || undefined,
      },
    ];
  });
}

// Legacy rows written by another branch embed an options payload after this
// marker in menu_items.image. We never write it, but we strip it on read /
// validation so existing rows render and validate cleanly.
const MENU_IMAGE_OPTIONS_MARK = "#cc-opt=";

export function stripMenuImage(image: string) {
  const value = String(image ?? "");
  const index = value.indexOf(MENU_IMAGE_OPTIONS_MARK);
  return (index >= 0 ? value.slice(0, index) : value) || "/images/logo.jpg";
}

// Read-side fallback for legacy "#cc-opt=<base64url JSON>" marker rows that
// predate the menu_items.styles/addons columns (the migration decodes all of
// them, but this keeps any straggler readable). Never used on the write path.
export function parseMenuImageOptions(image: string): { styles: DrinkStyle[]; addons: MenuAddon[] } {
  const value = String(image ?? "");
  const index = value.indexOf(MENU_IMAGE_OPTIONS_MARK);
  if (index < 0) return { styles: [], addons: [] };
  try {
    const payload = value.slice(index + MENU_IMAGE_OPTIONS_MARK.length);
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    const styles = Array.isArray(parsed?.styles)
      ? parsed.styles.flatMap((style: unknown) => (style === "hot" || style === "iced" ? [style] : []))
      : [];
    return { styles, addons: normalizeMenuAddons({ addons: parsed?.addons }) };
  } catch {
    return { styles: [], addons: [] };
  }
}

export function addonAllowsQty(addon: Pick<MenuAddon, "name" | "qtyEnabled">) {
  return /espresso|shot/i.test(addon.name);
}

export function resolveOrderAddons(
  menuItem: MenuItem,
  selected?: OrderAddon[] | null,
): OrderAddon[] {
  const catalog = new Map(normalizeMenuAddons(menuItem).map((addon) => [addon.id, addon]));
  if (!Array.isArray(selected)) return [];
  return selected.flatMap((entry) => {
    const addon = catalog.get(String(entry?.id ?? ""));
    if (!addon) return [];
    const qty = Math.max(0, Math.min(9, Math.floor(Number(entry.qty) || 0)));
    if (qty < 1) return [];
    return [{
      id: addon.id,
      name: addon.name,
      price: addon.price,
      qty: addonAllowsQty(addon) ? qty : 1,
      inventoryItemId: addon.inventoryItemId,
      usageAmount: addon.usageAmount,
      usageUnit: addon.usageUnit,
    }];
  });
}

export function addonExtra(addons?: OrderAddon[] | null) {
  return (addons ?? []).reduce((sum, addon) => sum + addon.price * Math.max(1, addon.qty || 1), 0);
}

export function cartLineUnitPrice(item: Pick<OrderItem, "price" | "addons">) {
  return Number(item.price) + addonExtra(item.addons);
}

function addonPriceLabel(addon: OrderAddon) {
  const qty = Math.max(1, addon.qty || 1);
  const name = qty > 1 ? `${qty}× ${addon.name}` : addon.name;
  if (!addon.price) return name;
  return `${name} ₱${addon.price * qty}`;
}

function parseAddonLabels(raw: string): OrderAddon[] {
  return raw.split(/\s*,\s*/).flatMap((part, index) => {
    const text = part.trim();
    if (!text) return [];
    const match = /^(?:(\d+)\s*[×x]\s*)?(.+?)(?:\s*₱\s*(\d+))?$/i.exec(text);
    if (!match) return [];
    const name = match[2].trim();
    if (!name) return [];
    return [
      {
        id: addonIdFromName(name, index),
        name,
        price: match[3] ? Number(match[3]) : 0,
        qty: match[1] ? Math.max(1, Number(match[1])) : 1,
      },
    ];
  });
}

function cleanOrderItemName(name: string) {
  return name
    .replace(/\s*·\s*(Iced|Hot)(?:\s*\+\s*.*)?$/i, "")
    .replace(/\s*\+\s*.+$/, "")
    .replace(/\s*\((iced|hot)\)$/i, "")
    .trim();
}

export function parseOrderItemSnapshot(name: string): {
  name: string;
  style?: DrinkStyle;
  addons: OrderAddon[];
} {
  const raw = String(name ?? "").trim();
  const withAddons = /^(.*?)\s*·\s*(Iced|Hot)\s*\+\s*(.+)$/i.exec(raw);
  if (withAddons) {
    return {
      name: withAddons[1].trim() || raw,
      style: withAddons[2].toLowerCase() === "hot" ? "hot" : "iced",
      addons: parseAddonLabels(withAddons[3]),
    };
  }
  const styleOnly = /^(.*?)\s*·\s*(Iced|Hot)\s*$/i.exec(raw) || /^(.*?)\s*\((Iced|Hot)\)\s*$/i.exec(raw);
  if (styleOnly) {
    return {
      name: styleOnly[1].trim() || raw,
      style: styleOnly[2].toLowerCase() === "hot" ? "hot" : "iced",
      addons: [],
    };
  }
  const addonsOnly = /^(.*?)\s*\+\s*(.+)$/.exec(raw);
  if (addonsOnly && !/^[+\d]/.test(addonsOnly[1].trim())) {
    return {
      name: addonsOnly[1].trim() || raw,
      addons: parseAddonLabels(addonsOnly[2]),
    };
  }
  return { name: raw, addons: [] };
}

export function hydrateOrderLine<T extends Pick<OrderItem, "name" | "style" | "addons">>(item: T): T {
  const parsed = parseOrderItemSnapshot(item.name);
  const style = parseDrinkStyle(item.style) ?? parsed.style;
  const addons = (item.addons ?? []).length > 0 ? item.addons : parsed.addons;
  return {
    ...item,
    name: cleanOrderItemName(item.name) || parsed.name || item.name,
    style,
    addons,
  };
}

export function orderLineOptionsLabel(item: Pick<OrderItem, "style" | "addons" | "name">) {
  const hydrated = hydrateOrderLine(item);
  const parts: string[] = [];
  if (hydrated.style) parts.push(drinkStyleLabel(hydrated.style));
  for (const addon of hydrated.addons ?? []) {
    if (!addon?.name) continue;
    parts.push(addonPriceLabel(addon));
  }
  return parts.join(", ");
}

export function drinkDisplayName(item: Pick<OrderItem, "name" | "style" | "addons">) {
  return hydrateOrderLine(item).name || item.name;
}

export function orderLineListLabel(item: OrderItem) {
  const options = orderLineOptionsLabel(item);
  const name = drinkDisplayName(item);
  return options ? `${name} (${options})` : name;
}

export type OrderSoldLine = {
  title: string;
  detail?: string;
};

export function orderSoldAsParts(items: OrderItem[]): OrderSoldLine[] {
  return items.map((item) => {
    const options = orderLineOptionsLabel(item);
    return {
      title: `${item.qty}x ${drinkDisplayName(item)}`,
      detail: options || undefined,
    };
  });
}

export function orderSoldAsLines(items: OrderItem[]) {
  return orderSoldAsParts(items).map((line) => (line.detail ? `${line.title} (${line.detail})` : line.title));
}

export function orderSoldAsLabel(items: OrderItem[]) {
  return orderSoldAsLines(items).join(", ");
}

export function cartLineKey(item: Pick<OrderItem, "productId" | "style" | "addons">) {
  const addons = (item.addons ?? [])
    .filter((addon) => addon.qty > 0)
    .map((addon) => `${addon.id}:${addon.qty}`)
    .sort()
    .join(",");
  return `${item.productId}|${item.style ?? ""}|${addons}`;
}

export function pricedOrderLine(
  menuItem: MenuItem,
  line: Pick<OrderItem, "qty" | "name" | "style" | "addons">,
): OrderItem {
  const qty = Number(line.qty);
  const style =
    parseDrinkStyle(line.style) ??
    (/·\s*hot$/i.test(line.name) || /\(hot\)$/i.test(line.name)
      ? "hot"
      : /·\s*iced$/i.test(line.name) || /\(iced\)$/i.test(line.name)
        ? "iced"
        : undefined);
  const allowed = normalizeMenuStyles(menuItem);
  const nextStyle = style && allowed.includes(style) ? style : allowed.length === 1 ? allowed[0] : undefined;
  const addons = resolveOrderAddons(menuItem, line.addons);
  return {
    productId: menuItem.id,
    name: menuItem.name,
    qty,
    price: menuItem.price + addonExtra(addons),
    category: menuItem.category,
    style: nextStyle,
    addons,
  };
}

export const DEFAULT_MENU: MenuItem[] = ([
  // Special
  { id: "commune-signature", name: "Commune Signature", price: 170, category: "Special", available: true },
  { id: "honey-oat", name: "Honey Oat", price: 170, category: "Special", available: true },
  { id: "spanish-latte", name: "Spanish Latte", price: 125, category: "Special", available: true },
  { id: "sea-salt-cream", name: "Sea Salt Cream", price: 135, category: "Special", available: true },

  // Classic Coffee
  { id: "americano-long-black", name: "Americano / Long Black", price: 120, category: "Classic", available: true },
  { id: "latte", name: "Latte", price: 140, category: "Classic", available: true },
  { id: "cappuccino", name: "Cappuccino", price: 150, category: "Classic", available: true },
  { id: "biscoff-latte", name: "Biscoff Latte", price: 150, category: "Classic", available: true },
  { id: "caramel-macchiato", name: "Caramel Macchiato", price: 130, category: "Classic", available: true },
  { id: "hazelnut-blanc", name: "Hazelnut Blanc", price: 130, category: "Classic", available: true },

  // Non-Coffee
  { id: "strawberry-creme", name: "Strawberry Créme", price: 130, category: "Non-Coffee", available: true },
  { id: "oreo-blush", name: "Oreo Blush", price: 120, category: "Non-Coffee", available: true },
  { id: "chocolate", name: "Chocolate", price: 120, category: "Non-Coffee", available: true },

  // Fresh Drinks
  { id: "strawberry-whisper", name: "Strawberry Whisper", price: 120, category: "Fresh Drinks", available: true },
  { id: "watermelon-whisper", name: "Watermelon Whisper", price: 120, category: "Fresh Drinks", available: true },

  // Matcha Drinks
  { id: "matcha-umami", name: "Matcha Umami", price: 190, category: "Matcha Drinks", available: true },
  { id: "matcha-latte", name: "Matcha Latte", price: 155, category: "Matcha Drinks", available: true },
  { id: "hojicha-latte", name: "Hojicha Latte", price: 155, category: "Matcha Drinks", available: true },
  { id: "matcha-creme-latte", name: "Matcha Créme Latte", price: 155, category: "Matcha Drinks", available: true },
  { id: "sea-salt-matcha-cloud", name: "Sea Salt Matcha Cloud", price: 155, category: "Matcha Drinks", available: true },

  // Food
  { id: "fries", name: "Fries", price: 120, category: "Food", available: true },
  { id: "tuna-sandwich", name: "Tuna Sandwich", price: 130, category: "Food", available: true },
  { id: "club-sandwich", name: "Club Sandwich", price: 180, category: "Food", available: true },

  // Pastries
  { id: "choco-chip-cookie", name: "Choco Chip Cookie", price: 80, category: "Pastries", available: true },
  { id: "red-velvet-cookie", name: "Red Velvet Cookie", price: 80, category: "Pastries", available: true },
  { id: "choco-fudge", name: "Choco Fudge", price: 85, category: "Pastries", available: true },
  { id: "revel-bar", name: "Revel Bar", price: 85, category: "Pastries", available: true },
]).map((item) => ({
  ...item,
  image: MENU_IMAGES[0].src,
  styles: isFoodOrPastry(item.category) ? [] : [...DRINK_STYLES],
}));

export const MENU = DEFAULT_MENU;

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function menuItemId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "item"}-${Date.now().toString(36)}`;
}