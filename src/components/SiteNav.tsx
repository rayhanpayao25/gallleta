"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CAFE } from "@/lib/cafe";
import { SocialLinks } from "@/components/SocialLinks";

const ghost =
  "rounded-full px-4 py-2 text-[11px] font-medium tracking-[0.2em] text-white/90 uppercase transition hover:bg-white/15 sm:px-5";

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const links = [
    { href: "/#about", label: "About Us" },
    { href: "/#menu", label: "Menu" },
    { href: "/#contact", label: "Contact Us" },
  ];

  return (
    <header className="absolute inset-x-0 top-0 z-30 px-4 pt-4 sm:pt-7">
      <nav
        suppressHydrationWarning
        className="mx-auto hidden max-w-5xl items-center justify-center md:flex"
      >
        <div className="flex items-center gap-0.5 rounded-full border border-white/25 bg-black/35 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-sm font-bold tracking-tight lowercase text-white"
          >
            <Image
              src="/images/logo.jpg"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-full object-cover"
            />
            {CAFE.name}
          </Link>
          <span className="h-4 w-px bg-white/25" />
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={ghost}>
              {link.label}
            </Link>
          ))}
        </div>
      </nav>

      <div className="relative md:hidden">
        <div className="relative z-50 flex items-center justify-between rounded-full border border-white/25 bg-black/50 px-3 py-1.5 backdrop-blur-xl">
          <Link
            href="/"
            className="flex items-center gap-2 px-1.5 text-[15px] font-bold tracking-tight lowercase"
          >
            <Image
              src="/images/logo.jpg"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-full object-cover"
            />
            {CAFE.name}
          </Link>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/30"
          >
            <span className="sr-only">Menu</span>
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 stroke-white"
              fill="none"
            >
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.6" />
              ) : (
                <path d="M5 8h14M5 12h14M5 16h14" strokeWidth="1.6" />
              )}
            </svg>
          </button>
        </div>

        {open ? (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/45"
            />
            <div className="relative z-50 mt-2 overflow-hidden rounded-2xl border border-white/20 bg-black/80 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <nav className="px-3 py-2">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-2.5 text-[13px] tracking-[0.16em] text-white uppercase transition hover:bg-white/10"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
              <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
                <p className="text-[10px] tracking-[0.28em] text-neutral-500 uppercase">
                  Follow
                </p>
                <SocialLinks />
              </div>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
