import Image from "next/image";
import Link from "next/link";
import { CAFE } from "@/lib/cafe";
import { SocialLinks } from "@/components/SocialLinks";

export function SiteFooter() {
  return (
    <footer
      suppressHydrationWarning
      className="border-t border-white/10 bg-black px-5 py-12 sm:px-6 sm:py-16"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-10 lg:flex-row lg:items-start lg:gap-16">
        <div className="lg:w-52 lg:shrink-0">
          <Link href="/" className="inline-block">
            <Image
              src="/images/logo.jpg"
              alt={CAFE.name}
              width={160}
              height={160}
              className="h-14 w-14 rounded-full object-cover sm:h-16 sm:w-16"
            />
          </Link>
          <p className="mt-5 text-xl font-bold tracking-tight">{CAFE.name}</p>
          <p className="mt-4 text-[10px] tracking-[0.18em] text-neutral-500 uppercase sm:tracking-[0.28em]">
            {CAFE.tagline}
          </p>
        </div>

        <div className="grid flex-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          <div>
            <p className="text-[11px] tracking-[0.28em] text-neutral-500 uppercase">
              Visit
            </p>
            <a
              href={CAFE.mapsHref}
              target="_blank"
              rel="noreferrer"
              className="mt-4 block text-sm leading-6 text-neutral-300 hover:text-white"
            >
              {CAFE.street}
              <br />
              {CAFE.city}
            </a>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.28em] text-neutral-500 uppercase">
              Hours
            </p>
            <p className="mt-4 text-sm leading-6 text-neutral-300">
              {CAFE.hours}
              <br />
              {CAFE.hoursNote}
            </p>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.28em] text-neutral-500 uppercase">
              Connect
            </p>
            <div className="mt-4 space-y-2 text-sm break-words text-neutral-300">
              <p>
                <a href={CAFE.phoneHref} className="hover:text-white">
                  {CAFE.phone}
                </a>
              </p>
              <p>
                <a href={CAFE.emailHref} className="hover:text-white">
                  {CAFE.email}
                </a>
              </p>
            </div>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.28em] text-neutral-500 uppercase">
              Follow
            </p>
            <div className="mt-4">
              <SocialLinks />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-10 flex max-w-6xl flex-col gap-3 border-t border-white/10 pt-6 text-[10px] tracking-[0.14em] text-neutral-600 uppercase sm:mt-14 sm:flex-row sm:items-center sm:justify-between sm:tracking-[0.18em]">
        <p>© {new Date().getFullYear()} Galleta Café, W2J4+H82, Sinunoc, Zamboanga City</p>
        <p>have a seat, take a sip</p>
      </div>
    </footer>
  );
}