import { CAFE } from "@/lib/cafe";
import { ordersOnDay } from "@/lib/analytics";
import { paymentLabel } from "@/lib/payments";
import { drinkDisplayName, orderLineOptionsLabel } from "@/lib/menu";
import type { MenuItem, Order, OrderItem, PaymentMethod } from "@/lib/types";

export type PaperWidth = 58 | 80;

export type ReceiptItem = OrderItem;

export type ReceiptTicket = {
  ticketNo: string;
  barista: string;
  items: ReceiptItem[];
  subtotal: number;
  total: number;
  paymentMethod?: PaymentMethod;
  paid?: number;
  change?: number;
  at: Date;
};

type Align = 0 | 1 | 2;
type Size = "normal" | "wide" | "tall" | "huge";

type PrintLine =
  | { kind: "text"; text: string; align?: Align; size?: Size; bold?: boolean }
  | { kind: "rule" }
  | { kind: "feed" }
  | { kind: "bitmap"; bytes: Uint8Array };

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const SIZE_BYTE: Record<Size, number> = {
  normal: 0x00,
  wide: 0x20,
  tall: 0x10,
  huge: 0x30,
};

export function paperColumns(width: PaperWidth): number {
  return width === 58 ? 32 : 42;
}

export function nextTicketNo(orders: Order[], now = new Date()): string {
  return String(ordersOnDay(orders, now).length + 1).padStart(3, "0");
}

function sameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function ticketNoForOrder(orders: Order[], order: Order): string {
  if (order.ticketNo) return order.ticketNo;
  const day = new Date(order.createdAt);
  const same = [...orders]
    .filter((entry) => sameCalendarDay(new Date(entry.createdAt), day))
    .sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  const index = same.findIndex((entry) => entry.id === order.id);
  return String(Math.max(index, 0) + 1).padStart(3, "0");
}

export function receiptFromOrder(
  order: Order,
  orders: Order[] = [],
  menu: MenuItem[] = [],
): ReceiptTicket {
  const subtotal =
    order.subtotal ??
    order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const paid = order.paid ?? order.total;
  const digital =
    order.paymentMethod === "gcash" || order.paymentMethod === "maya";
  return {
    ticketNo: ticketNoForOrder(orders, order),
    barista: order.baristaName,
    items: order.items.map((item) => ({
      ...item,
      category:
        item.category ??
        menu.find((menuItem) => menuItem.id === item.productId)?.category,
    })),
    subtotal,
    total: order.total,
    paymentMethod: order.paymentMethod,
    paid,
    change: order.change ?? (digital ? 0 : Math.max(0, paid - order.total)),
    at: new Date(order.createdAt),
  };
}

export function receiptMoney(amount: number): string {
  return `P${Math.round(amount).toLocaleString("en-PH")}`;
}

export function receiptWhen(date: Date): string {
  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function itemCount(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0);
}

export function isDrinkCategory(category?: string): boolean {
  return Boolean(category && !/food|pastr/i.test(category));
}

export function drinkReceipts(ticket: ReceiptTicket): ReceiptTicket[] {
  return ticket.items.flatMap((item) => {
    if (!isDrinkCategory(item.category)) return [];
    return Array.from({ length: item.qty }, () => ({
      ...ticket,
      items: [{ ...item, qty: 1 }],
    }));
  });
}

function toPrinterText(value: string): string {
  return value
    .replace(/₱/g, "P")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?");
}

function padLine(left: string, right: string, width: number): string {
  const cleanLeft = toPrinterText(left);
  const cleanRight = toPrinterText(right);
  if (cleanLeft.length + 1 + cleanRight.length <= width) {
    return (
      cleanLeft +
      " ".repeat(width - cleanLeft.length - cleanRight.length) +
      cleanRight
    );
  }
  const wrapAt = Math.max(8, width - cleanRight.length - 1);
  const first = cleanLeft.slice(0, wrapAt);
  const rest = cleanLeft.slice(wrapAt).trim();
  const lined =
    first + " ".repeat(width - first.length - cleanRight.length) + cleanRight;
  return rest ? `${lined}\n${padLine(rest, "", width)}` : lined;
}

function dash(width: number): string {
  return "-".repeat(width);
}

function encode(text: string): number[] {
  const bytes: number[] = [];
  for (const char of toPrinterText(text)) {
    bytes.push(char.charCodeAt(0));
  }
  return bytes;
}

function buildBytes(lines: PrintLine[], width: number): Uint8Array {
  const bytes: number[] = [ESC, 0x40, ESC, 0x74, 0x00, ESC, 0x32];

  for (const line of lines) {
    if (line.kind === "feed") {
      bytes.push(LF);
      continue;
    }
    if (line.kind === "bitmap") {
      bytes.push(...line.bytes, LF);
      continue;
    }
    if (line.kind === "rule") {
      bytes.push(ESC, 0x61, 0x00, ESC, 0x21, 0x00, ...encode(dash(width)), LF);
      continue;
    }

    bytes.push(ESC, 0x61, line.align ?? 0);
    bytes.push(ESC, 0x21, SIZE_BYTE[line.size ?? "normal"] | (line.bold ? 0x08 : 0));
    const chunks = line.text.split("\n");
    for (const chunk of chunks) {
      bytes.push(...encode(chunk), LF);
    }
    bytes.push(ESC, 0x21, 0x00, ESC, 0x61, 0x00);
  }

  bytes.push(LF, LF, GS, 0x56, 0x00);
  return Uint8Array.from(bytes);
}

function shopHeader(logo?: Uint8Array): PrintLine[] {
  const lines: PrintLine[] = [];
  if (logo) {
    lines.push({ kind: "bitmap", bytes: logo });
  }
  lines.push(
    { kind: "text", text: CAFE.tagline, align: 1 },
    { kind: "text", text: CAFE.street, align: 1 },
    { kind: "text", text: CAFE.city, align: 1 },
    { kind: "text", text: `Tel ${CAFE.phone}`, align: 1 },
    { kind: "rule" },
  );
  return lines;
}

export function customerLines(
  ticket: ReceiptTicket,
  width: number,
  logo?: Uint8Array,
): PrintLine[] {
  const lines: PrintLine[] = [
    ...shopHeader(logo),
    { kind: "text", text: `Order No. ${ticket.ticketNo}`, align: 1, size: "tall", bold: true },
    { kind: "text", text: receiptWhen(ticket.at), align: 1 },
    { kind: "text", text: `Cashier: ${ticket.barista}`, align: 1 },
    { kind: "rule" },
    { kind: "text", text: padLine("Item", "Amount", width), bold: true },
  ];

  for (const item of ticket.items) {
    lines.push({ kind: "text", text: drinkDisplayName(item) });
    const options = orderLineOptionsLabel(item);
    if (options) {
      lines.push({ kind: "text", text: `  ${options}` });
    }
    lines.push({
      kind: "text",
      text: padLine(
        `  ${item.qty} x ${receiptMoney(item.price)}`,
        receiptMoney(item.price * item.qty),
        width,
      ),
    });
  }

  lines.push({ kind: "rule" });
  lines.push({
    kind: "text",
    text: padLine("Subtotal", receiptMoney(ticket.subtotal), width),
  });
  lines.push({
    kind: "text",
    text: padLine("TOTAL", receiptMoney(ticket.total), width),
    bold: true,
    size: "tall",
  });

  if (ticket.paid && ticket.paid > 0) {
    lines.push({ kind: "rule" });
    const method = paymentLabel(ticket.paymentMethod);
    lines.push({
      kind: "text",
      text: padLine("Payment", method, width),
    });
    if (ticket.paymentMethod === "gcash" || ticket.paymentMethod === "maya") {
      lines.push({
        kind: "text",
        text: padLine("Paid", receiptMoney(ticket.paid), width),
      });
    } else {
      lines.push({
        kind: "text",
        text: padLine("Cash / Tendered", receiptMoney(ticket.paid), width),
      });
      lines.push({
        kind: "text",
        text: padLine("Change", receiptMoney(ticket.change ?? 0), width),
      });
    }
  }

  lines.push({ kind: "rule" });
  lines.push({ kind: "text", text: CAFE.tagline.toLowerCase(), align: 1 });
  lines.push({ kind: "text", text: "have a seat, take a sip", align: 1 });
  lines.push({ kind: "text", text: "Thank you. Please come again.", align: 1 });
  lines.push({ kind: "feed" });
  lines.push({ kind: "text", text: "Order slip", align: 1 });
  return lines;
}

export function baristaLines(ticket: ReceiptTicket): PrintLine[] {
  const drinks = itemCount(ticket.items);
  const lines: PrintLine[] = [
    { kind: "text", text: "MAKE THESE DRINKS", align: 1, bold: true },
    { kind: "rule" },
    { kind: "text", text: `ORDER NO. ${ticket.ticketNo}`, align: 1, bold: true },
    { kind: "text", text: receiptWhen(ticket.at), align: 1 },
    { kind: "rule" },
    { kind: "text", text: "Qty  Drink", bold: true },
  ];

  for (const item of ticket.items) {
    const qty = `${item.qty}x`;
    const name = drinkDisplayName(item).toUpperCase();
    const options = orderLineOptionsLabel(item);
    lines.push({
      kind: "text",
      text: `${qty.padEnd(4, " ")} ${name}`,
    });
    if (options) {
      lines.push({ kind: "text", text: `     ${options.toUpperCase()}` });
    }
  }

  lines.push({ kind: "rule" });
  lines.push({
    kind: "text",
    text: `${drinks} ${drinks === 1 ? "DRINK" : "DRINKS"} TO MAKE`,
    align: 1,
    bold: true,
  });
  return lines;
}

export function encodeCustomerReceipt(
  ticket: ReceiptTicket,
  paperWidth: PaperWidth,
  logo?: Uint8Array,
): Uint8Array {
  const width = paperColumns(paperWidth);
  return buildBytes(customerLines(ticket, width, logo), width);
}

export function encodeBaristaTicket(
  ticket: ReceiptTicket,
  paperWidth: PaperWidth,
): Uint8Array {
  const width = paperColumns(paperWidth);
  return buildBytes(baristaLines(ticket), width);
}

export function encodeOrderSlips(
  ticket: ReceiptTicket,
  paperWidth: PaperWidth,
): Uint8Array[] {
  return drinkReceipts(ticket).map((drinkTicket) =>
    encodeBaristaTicket(drinkTicket, paperWidth),
  );
}

export function sampleTicket(now = new Date()): ReceiptTicket {
  return {
    ticketNo: "001",
    barista: "Sale In Charge",
    items: [
      {
        productId: "spanish-latte",
        name: "Spanish Latte",
        qty: 2,
        price: 149,
        category: "Special",
      },
      {
        productId: "matcha-umami",
        name: "Matcha Umami",
        qty: 1,
        price: 169,
        category: "Matcha Drinks",
      },
    ],
    subtotal: 467,
    total: 467,
    paymentMethod: "cash",
    paid: 500,
    change: 33,
    at: now,
  };
}
