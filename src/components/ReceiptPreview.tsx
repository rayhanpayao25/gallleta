"use client";

import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { CAFE } from "@/lib/cafe";
import {
  drinkReceipts,
  itemCount,
  receiptMoney,
  receiptWhen,
  type PaperWidth,
  type ReceiptTicket,
} from "@/lib/escpos";
import { drinkDisplayName, orderLineOptionsLabel } from "@/lib/menu";
import { paymentLabel } from "@/lib/payments";
import type { PrintJob } from "@/lib/types";

type ReceiptPreviewProps = {
  ticket: ReceiptTicket;
  orderId: string;
  orderOptions: { id: string; label: string }[];
  printJobs: PrintJob[];
  labelPaperWidth: PaperWidth;
  receiptPaperWidth: PaperWidth;
  labelBaudRate: number;
  receiptBaudRate: number;
  labelPrinterReady: boolean;
  receiptPrinterReady: boolean;
  testPrinterEnabled: boolean;
  pending: boolean;
  onClose: () => void;
  onSelectOrder: (orderId: string) => void;
  onPrintLabels: () => void;
  onPrintReceipt: () => void;
  onRetryJob: (job: PrintJob) => void;
  onSetLabelPaperWidth: (width: PaperWidth) => void;
  onSetReceiptPaperWidth: (width: PaperWidth) => void;
  onSetLabelBaudRate: (baudRate: number) => void;
  onSetReceiptBaudRate: (baudRate: number) => void;
};

function Slip({
  title,
  paperWidth,
  children,
}: {
  title: string;
  paperWidth: PaperWidth;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center">
      <p className="mb-2 text-[11px] tracking-[0.18em] text-neutral-500 uppercase">
        {title}
      </p>
      <div
        className="bg-white px-4 py-5 text-black shadow-xl"
        style={{ width: paperWidth === 58 ? 220 : 300 }}
      >
        <div className="font-mono text-[11px] leading-4">{children}</div>
      </div>
    </div>
  );
}

function Rule() {
  return <p className="my-2 overflow-hidden text-neutral-400">{"-".repeat(42)}</p>;
}

function Row({ left, right, strong }: { left: string; right: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <span>{left}</span>
      <span className="shrink-0">{right}</span>
    </p>
  );
}

function CustomerSlip({ ticket }: { ticket: ReceiptTicket }) {
  return (
    <>
      <div className="flex justify-center">
        <Image
          src="/images/logo.jpg"
          alt={CAFE.name}
          width={64}
          height={64}
          className="h-16 w-16 rounded-full object-cover"
        />
      </div>
      <p className="mt-3 text-center text-[10px] tracking-[0.12em]">
        {CAFE.tagline}
      </p>
      <p className="mt-2 text-center">{CAFE.street}</p>
      <p className="text-center">{CAFE.city}</p>
      <p className="text-center">Tel {CAFE.phone}</p>
      <Rule />
      <p className="text-center text-base font-bold">Order No. {ticket.ticketNo}</p>
      <p className="text-center">{receiptWhen(ticket.at)}</p>
      <p className="text-center">Cashier: {ticket.barista}</p>
      <Rule />
      <Row left="Item" right="Amount" strong />
      {ticket.items.map((item, index) => (
        <div key={`${item.productId}-${index}`} className="mt-2">
          <p>{drinkDisplayName(item)}</p>
          {orderLineOptionsLabel(item) ? (
            <p className="text-[10px] text-neutral-600">{orderLineOptionsLabel(item)}</p>
          ) : null}
          <Row
            left={`  ${item.qty} x ${receiptMoney(item.price)}`}
            right={receiptMoney(item.price * item.qty)}
          />
        </div>
      ))}
      <Rule />
      <Row left="Subtotal" right={receiptMoney(ticket.subtotal)} />
      <Row left="TOTAL" right={receiptMoney(ticket.total)} strong />
      <Rule />
      <Row left="Payment" right={paymentLabel(ticket.paymentMethod)} />
      <Row
        left={ticket.paymentMethod === "cash" ? "Cash / Tendered" : "Paid"}
        right={receiptMoney(ticket.paid ?? ticket.total)}
      />
      <Row left="Change" right={receiptMoney(ticket.change ?? 0)} />
      <Rule />
      <p className="text-center lowercase">{CAFE.tagline.toLowerCase()}</p>
      <p className="mt-1 text-center">have a seat, take a sip</p>
      <p className="mt-1 text-center">Thank you. Please come again.</p>
    </>
  );
}

function JobRow({
  job,
  pending,
  onRetry,
}: {
  job: PrintJob;
  pending: boolean;
  onRetry: () => void;
}) {
  const statusClass =
    job.status === "printed"
      ? "bg-emerald-100 text-emerald-800"
      : job.status === "failed"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800";
  const title =
    job.type === "customer-receipt"
      ? "Customer receipt"
      : `${job.label?.name ?? "Cup label"} #${(job.label?.copyIndex ?? 0) + 1}`;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{title}</span>
        <span className={`rounded-full px-2 py-0.5 capitalize ${statusClass}`}>
          {job.status}
        </span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2 text-neutral-500">
        <span className="min-w-0">
          {job.lastError || `${job.attempts} ${job.attempts === 1 ? "attempt" : "attempts"}`}
        </span>
        {job.status === "pending" || job.status === "failed" ? (
          <button
            type="button"
            disabled={pending}
            onClick={onRetry}
            className="shrink-0 rounded-md border border-neutral-300 px-2 py-1 text-black disabled:opacity-40"
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BaristaSlip({ ticket }: { ticket: ReceiptTicket }) {
  const drinks = itemCount(ticket.items);
  return (
    <>
      <p className="text-center text-[10px]">MAKE THESE DRINKS</p>
      <Rule />
      <p className="text-center font-bold">ORDER NO. {ticket.ticketNo}</p>
      <p className="text-center">{receiptWhen(ticket.at)}</p>
      <Rule />
      <p className="flex gap-2 font-semibold text-neutral-500">
        <span className="w-8 shrink-0">Qty</span>
        <span>Drink</span>
      </p>
      <ul className="mt-1">
        {ticket.items.map((item) => (
          <li
            key={item.productId}
            className="flex items-baseline gap-2 border-b border-dashed border-neutral-200 py-1"
          >
            <span className="w-8 shrink-0 font-bold">{item.qty}x</span>
            <span className="min-w-0 leading-4 uppercase">
              {drinkDisplayName(item)}
              {orderLineOptionsLabel(item) ? (
                <span className="mt-0.5 block text-[10px] font-normal normal-case text-neutral-600">
                  {orderLineOptionsLabel(item)}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-center text-[10px] font-semibold">
        {drinks} {drinks === 1 ? "DRINK" : "DRINKS"} TO MAKE
      </p>
    </>
  );
}

function TestLabel({
  ticket,
  index,
}: {
  ticket: ReceiptTicket;
  index: number;
}) {
  return (
    <div className="test-print-label flex w-full max-w-[400px] flex-col items-center">
      <p className="test-print-screen-only mb-2 text-[11px] tracking-[0.18em] text-neutral-500 uppercase">
        Label {index + 1}
      </p>
      <div className="test-print-page aspect-[5/3] w-full overflow-hidden rounded-md border border-neutral-300 bg-[#fdfdf8] text-black shadow-xl">
        <div className="mx-auto h-full w-[96%] px-4 py-3 font-mono text-[10px] leading-3">
          <BaristaSlip ticket={ticket} />
        </div>
      </div>
      <p className="test-print-screen-only mt-2 text-[10px] text-neutral-500">
        50 × 30 mm · 48 mm printable width · 384 dots
      </p>
    </div>
  );
}

export function ReceiptPreview({
  ticket,
  orderId,
  orderOptions,
  printJobs,
  labelPaperWidth,
  receiptPaperWidth,
  labelBaudRate,
  receiptBaudRate,
  labelPrinterReady,
  receiptPrinterReady,
  testPrinterEnabled,
  pending,
  onClose,
  onSelectOrder,
  onPrintLabels,
  onPrintReceipt,
  onRetryJob,
  onSetLabelPaperWidth,
  onSetReceiptPaperWidth,
  onSetLabelBaudRate,
  onSetReceiptBaudRate,
}: ReceiptPreviewProps) {
  const receipts = drinkReceipts(ticket);
  const receiptJobs = printJobs.filter((job) => job.type === "customer-receipt");
  const labelJobs = printJobs.filter((job) => job.type === "cup-label");
  const receiptNeedsRetry = receiptJobs.some(
    (job) => job.status === "pending" || job.status === "failed",
  );
  const labelsNeedRetry = labelJobs.some(
    (job) => job.status === "pending" || job.status === "failed",
  );
  const [showTestOutput, setShowTestOutput] = useState(false);
  const labelsRef = useRef<HTMLDivElement>(null);

  function printTestLabels() {
    const pages = labelsRef.current?.querySelectorAll<HTMLElement>(
      ".test-print-page",
    );
    if (!pages?.length) return;

    const styles = Array.from(
      document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
        'link[rel="stylesheet"], style',
      ),
    )
      .map((node) => node.outerHTML)
      .join("\n");
    const labels = Array.from(pages)
      .map((page) => `<section class="test-print-sheet">${page.outerHTML}</section>`)
      .join("\n");
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "1px";
    frame.style.height = "1px";
    frame.style.border = "0";

    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) {
        frame.remove();
        return;
      }
      printWindow.addEventListener("afterprint", () => frame.remove(), {
        once: true,
      });
      printWindow.focus();
      printWindow.print();
    };
    frame.srcdoc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Test drink labels</title>
    ${styles}
    <style>
      @page { size: 50mm 30mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body { width: 50mm; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .test-print-sheet {
        display: block;
        width: 50mm;
        height: 30mm;
        margin: 0;
        overflow: hidden;
        break-after: page;
        page-break-after: always;
      }
      .test-print-sheet:last-child {
        break-after: auto;
        page-break-after: auto;
      }
      .test-print-page {
        width: 400px !important;
        height: 240px !important;
        max-width: none !important;
        transform: scale(0.472440945);
        transform-origin: top left;
      }
    </style>
  </head>
  <body>${labels}</body>
</html>`;
    document.body.append(frame);
  }

  return (
    <div
      className={`absolute inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center ${
        showTestOutput ? "test-print-active" : ""
      }`}
    >
      <div className="receipt-preview-dialog flex max-h-[90svh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-neutral-200 text-black shadow-2xl">
        <div className="receipt-preview-header flex shrink-0 items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">
              {showTestOutput ? "Test printer output" : "Print order"}
            </h3>
            <p className="text-xs text-neutral-500">
              {showTestOutput ? (
                <>
                  {receipts.length} virtual {receipts.length === 1 ? "label" : "labels"} ·
                  50 × 30 mm
                </>
              ) : (
                "Receipt and cup-label jobs are independent"
              )}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor">
              <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" />
            </svg>
          </button>
        </div>
        <div className="receipt-preview-body min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {showTestOutput ? (
            <div
              ref={labelsRef}
              className="receipt-preview-labels flex flex-wrap items-start justify-center gap-8 py-2"
            >
              {receipts.map((receipt, index) => (
                  <TestLabel
                    key={`${receipt.items[0].productId}-${index}`}
                    ticket={receipt}
                    index={index}
                  />
                ))}
            </div>
          ) : (
            <>
              <label className="mb-4 block text-xs text-neutral-600">
                Completed order
                <select
                  value={orderId}
                  onChange={(event) => onSelectOrder(event.target.value)}
                  className="mt-1 block w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-black"
                >
                  {orderOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid items-start gap-5 lg:grid-cols-2">
                <section className="rounded-2xl bg-neutral-100 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">Customer receipt</h4>
                      <p className="text-[11px] text-neutral-500">
                        {receiptPrinterReady ? "Receipt printer connected" : "Receipt printer disconnected"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <select
                        aria-label="Receipt printer baud rate"
                        disabled={receiptPrinterReady}
                        value={receiptBaudRate}
                        onChange={(event) => onSetReceiptBaudRate(Number(event.target.value))}
                        className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {[9600, 19200, 38400, 115200].map((rate) => (
                          <option key={rate} value={rate}>{rate} baud</option>
                        ))}
                      </select>
                      <select
                        aria-label="Receipt paper width"
                        value={receiptPaperWidth}
                        onChange={(event) =>
                          onSetReceiptPaperWidth(Number(event.target.value) as PaperWidth)
                        }
                        className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value={58}>58 mm</option>
                        <option value={80}>80 mm</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-center overflow-x-auto py-2">
                    <Slip title="Customer copy" paperWidth={receiptPaperWidth}>
                      <CustomerSlip ticket={ticket} />
                    </Slip>
                  </div>
                  <div className="mt-3 space-y-2">
                    {receiptJobs.length === 0 ? (
                      <p className="text-center text-[11px] text-neutral-500">No receipt job yet.</p>
                    ) : (
                      receiptJobs.slice().reverse().slice(0, 4).map((job) => (
                        <JobRow
                          key={job.id}
                          job={job}
                          pending={pending}
                          onRetry={() => onRetryJob(job)}
                        />
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-2xl bg-neutral-100 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">Cup labels</h4>
                      <p className="text-[11px] text-neutral-500">
                        {labelPrinterReady ? "Label printer connected" : "Label printer disconnected"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <select
                        aria-label="Label printer baud rate"
                        disabled={labelPrinterReady}
                        value={labelBaudRate}
                        onChange={(event) => onSetLabelBaudRate(Number(event.target.value))}
                        className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {[9600, 19200, 38400, 115200].map((rate) => (
                          <option key={rate} value={rate}>{rate} baud</option>
                        ))}
                      </select>
                      <select
                        aria-label="Label printer width"
                        value={labelPaperWidth}
                        onChange={(event) =>
                          onSetLabelPaperWidth(Number(event.target.value) as PaperWidth)
                        }
                        className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value={58}>58 mm</option>
                        <option value={80}>80 mm</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-start justify-center gap-4 py-2">
                    {receipts.length === 0 ? (
                      <p className="py-8 text-xs text-neutral-500">This order has no cup labels.</p>
                    ) : (
                      receipts.map((receipt, index) => (
                        <Slip
                          key={`${receipt.items[0].productId}-${index}`}
                          title={`Label ${index + 1}`}
                          paperWidth={labelPaperWidth}
                        >
                          <BaristaSlip ticket={receipt} />
                        </Slip>
                      ))
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    {labelJobs.length === 0 ? (
                      <p className="text-center text-[11px] text-neutral-500">No label jobs yet.</p>
                    ) : (
                      labelJobs.slice().reverse().slice(0, 12).map((job) => (
                        <JobRow
                          key={job.id}
                          job={job}
                          pending={pending}
                          onRetry={() => onRetryJob(job)}
                        />
                      ))
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
        <div className="receipt-preview-footer flex shrink-0 gap-2 border-t border-neutral-300 bg-white p-4">
          {showTestOutput ? (
            <>
              <button
                type="button"
                onClick={() => setShowTestOutput(false)}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm"
              >
                Back
              </button>
              <button
                type="button"
                onClick={printTestLabels}
                className="flex-1 rounded-xl bg-black py-2.5 text-sm text-white"
              >
                Print test labels
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm"
              >
                Close
              </button>
              {testPrinterEnabled ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setShowTestOutput(true)}
                  className="flex-1 rounded-xl border border-black py-2.5 text-sm disabled:opacity-40"
                >
                  Test print
                </button>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={onPrintReceipt}
                className="flex-1 rounded-xl border border-black py-2.5 text-sm disabled:opacity-40"
              >
                {receiptNeedsRetry ? "Retry receipt" : "Reprint receipt"}
              </button>
              <button
                type="button"
                disabled={pending || receipts.length === 0}
                onClick={onPrintLabels}
                className="flex-1 rounded-xl bg-black py-2.5 text-sm text-white disabled:opacity-40"
              >
                {labelsNeedRetry ? "Retry labels" : "Reprint labels"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
