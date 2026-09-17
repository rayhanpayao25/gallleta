"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { logout } from "@/actions/auth";
import type { Session } from "@/lib/types";

export type AdminPanel = "sales" | "menu" | "transactions" | "staff" | "voids";

const TABS: { id: AdminPanel; label: string }[] = [
  { id: "sales", label: "Sales" },
  { id: "menu", label: "Menu" },
  { id: "transactions", label: "Inventory" },
  { id: "staff", label: "Staff" },
  { id: "voids", label: "Void request approval" },
];

type StaffHeaderProps = {
  session: Session;
  panel: AdminPanel;
  onPanelChange: (panel: AdminPanel) => void;
};

export function StaffHeader({ session, panel, onPanelChange }: StaffHeaderProps) {
  const [open, setOpen] = useState(false);
  const current = TABS.find((tab) => tab.id === panel)?.label ?? "Sales";

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function go(id: AdminPanel) {
    onPanelChange(id);
    setOpen(false);
  }

  return (
    <>
      <header className="relative z-40 border-b border-neutral-200 bg-white px-3 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-neutral-800 transition hover:border-black hover:bg-black hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 stroke-current" fill="none">
                {open ? (
                  <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" />
                ) : (
                  <path d="M5 8h14M5 12h14M5 16h14" strokeWidth="1.8" />
                )}
              </svg>
            </button>
            <BrandLogo size="sm" align="start" />
            <p className="truncate text-sm font-medium text-neutral-900">{current}</p>
        </div>
      </header>

      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label="Close menu"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Admin menu"
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-white shadow-[0_18px_50px_rgba(0,0,0,0.18)] transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <p className="text-sm font-semibold tracking-tight lowercase">commune</p>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 transition hover:border-black hover:bg-black hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 stroke-current" fill="none">
              <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {TABS.map((tab) => {
            const active = panel === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => go(tab.id)}
                className={`rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                  active ? "bg-black text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-black"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-neutral-200 p-3">
          <p className="px-4 pb-2 text-sm text-neutral-400">{session.name}</p>
          <div className="flex flex-col gap-1">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="rounded-2xl px-4 py-3 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-black"
            >
              Website
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="w-full rounded-2xl px-4 py-3 text-left text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-black"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
