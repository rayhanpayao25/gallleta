import { getStore } from "@/lib/store";
import { DrinksMenu } from "@/components/DrinksMenu";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DrinksPage() {
  const store = await getStore();
  const menu = store.menu.filter((item) => item.available !== false);

  return (
    <main className="min-h-screen bg-black text-white px-4 py-12 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-5">
          <div>
            <p className="font-script text-2xl text-neutral-400">have a seat, take a sip</p>
            <h1 className="font-serif text-3xl italic sm:text-5xl mt-1">Galleta Café Drinks</h1>
          </div>
          <Link
            href="/#menu"
            aria-label="Back to Home"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/25 transition hover:bg-white hover:text-black sm:h-auto sm:w-auto sm:px-5 sm:py-2.5 sm:text-xs sm:uppercase sm:tracking-[0.18em]"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5 stroke-current sm:hidden"
            >
              <path
                d="M15 18l-6-6 6-6"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="hidden sm:inline">Back to Home</span>
          </Link>
        </div>

        <DrinksMenu items={menu} categories={store.categories} />
      </div>
    </main>
  );
}
