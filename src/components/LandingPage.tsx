import Image from "next/image";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { SocialLinks } from "@/components/SocialLinks";
import { CAFE } from "@/lib/cafe";
import { DEFAULT_MENU, formatMoney, normalizeMenuSizes } from "@/lib/menu";
import type { MenuItem } from "@/lib/types";

function Eyebrow({ children }: { children: string }) {
  return (
    <p className="px-2 text-[10px] tracking-[0.22em] text-neutral-500 uppercase sm:text-[11px] sm:tracking-[0.42em]">
      {children}
    </p>
  );
}

function Photo({
  src,
  alt,
  className,
  sizes,
  loading,
}: {
  src: string;
  alt: string;
  className?: string;
  sizes: string;
  loading?: "eager" | "lazy";
}) {
  return (
    <article className={`group relative overflow-hidden bg-neutral-900 ${className ?? ""}`}>
      <Image
        src={src}
        alt={alt}
        fill
        loading={loading}
        sizes={sizes}
        className="object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
      />
    </article>
  );
}

export function LandingPage({
  menu = DEFAULT_MENU,
}: {
  menu?: MenuItem[];
}) {
  const bestSellers = menu
    .filter((item) => item.available !== false)
    .slice(0, 5);

  return (
    <div className="bg-black text-white">
      <section className="relative min-h-svh overflow-hidden">
        <Image
          src="/images/hero-wide.jpg"
          alt="Galleta Café cafe bar"
          fill
          loading="eager"
          quality={95}
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/70" />
        <SiteNav />
        <div className="relative z-10 flex min-h-svh flex-col items-center justify-end px-5 pb-10 text-center sm:px-6 sm:pb-16">
          <p className="font-script text-2xl text-white/90 sm:text-4xl">
            have a seat, take a sip
          </p>
          <h1 className="font-display mt-3 max-w-5xl text-[2.7rem] leading-[0.9] tracking-[0.08em] text-white uppercase drop-shadow-[0_10px_30px_rgba(0,0,0,0.65)] sm:mt-5 sm:text-7xl sm:tracking-[0.12em] md:text-8xl">
            Iced drinks
            <br />
            and more
          </h1>
          <div className="mt-5 sm:mt-7">
            <p className="text-[10px] tracking-[0.28em] text-white/55 uppercase">
              Open Hours
            </p>
            <p className="mt-1.5 text-[11px] tracking-[0.22em] text-white/90 uppercase sm:text-sm sm:tracking-[0.28em]">
              {CAFE.hours} · {CAFE.hoursNote}
            </p>
          </div>
          <p className="mt-2 text-[10px] tracking-[0.22em] text-white/65 uppercase sm:text-[11px] sm:tracking-[0.38em]">
            W2J4+H82, Sinunoc · Zamboanga City, Zamboanga del Sur
          </p>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0b0b0b] px-3 py-10 sm:px-6 sm:py-24">
        <div className="mx-auto grid max-w-6xl items-stretch gap-3 sm:gap-4 md:grid-cols-12">
          <article className="relative min-h-[280px] overflow-hidden bg-black sm:min-h-[420px] md:col-span-7 md:min-h-[640px]">
            <Image
              src="/images/open.jpg"
              alt={`${CAFE.name} open ${CAFE.hours}`}
              fill
              sizes="(max-width: 768px) 100vw, 58vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
            <div className="absolute bottom-0 left-0 p-5 sm:p-10">
              <p className="font-serif text-5xl italic tracking-tight sm:text-8xl">
                OPEN!
              </p>
              <p className="mt-2 text-[10px] tracking-[0.12em] text-white/80 uppercase sm:mt-3 sm:text-sm sm:tracking-[0.28em]">
                {CAFE.hours} · {CAFE.hoursNote}
              </p>
            </div>
          </article>
          <Photo
            src="/images/drinks.jpg"
            alt="Signature iced drinks at Galleta Café"
            className="min-h-[240px] sm:min-h-[360px] md:col-span-5 md:min-h-[640px]"
            sizes="(max-width: 768px) 100vw, 42vw"
          />
        </div>
      </section>

      <section className="px-3 py-12 sm:px-6 sm:py-28">
        <div className="mx-auto mb-8 max-w-6xl px-2 text-center sm:mb-12">
          <p className="font-script text-3xl sm:text-5xl">have a seat, take a sip</p>
          <Eyebrow>{CAFE.tagline}</Eyebrow>
        </div>
        <div className="mx-auto grid max-w-6xl gap-3 sm:gap-4 md:grid-cols-2">
          <Photo
            src="/images/cups.jpg"
            alt="Iced latte and matcha at Galleta Café"
            className="min-h-[260px] sm:min-h-[440px] md:min-h-[520px]"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
          <Photo
            src="/images/signatures.jpg"
            alt="Sea salt cream, Spanish latte, and brownie"
            className="min-h-[260px] sm:min-h-[440px] md:min-h-[520px]"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
          <Photo
            src="/images/matcha-umami.jpg"
            alt="New in the menu: Matcha Umami"
            className="min-h-[300px] sm:min-h-[520px]"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
          <Photo
            src="/images/carrier.jpg"
            alt="Have a seat, take a sip"
            className="min-h-[300px] sm:min-h-[520px]"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        </div>
      </section>

      <section
        id="menu"
        className="border-y border-white/10 bg-[#111] px-4 py-12 sm:px-6 sm:py-28"
      >
        <div className="mx-auto grid max-w-6xl items-start gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <Eyebrow>Best Sellers</Eyebrow>
            <h2 className="mt-4 font-serif text-4xl italic sm:text-5xl">
              ICED DRINKS AND MORE
            </h2>
            <p className="mt-4 max-w-md text-neutral-400">
              Signatures from the bar: iced, crumbled, and pulled to share.
            </p>

            <ul className="mt-8 divide-y divide-white/10">
              {bestSellers.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 py-4 sm:gap-6"
                >
                  <div>
                    <p className="font-medium tracking-wide text-white">{item.name}</p>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-right">
                    {normalizeMenuSizes(item.sizes).length > 0
                      ? normalizeMenuSizes(item.sizes).map((size) => (
                          <div key={size.label}>
                            <p className="text-[10px] uppercase tracking-wider text-neutral-500">{size.label}</p>
                            <p className="font-medium text-neutral-200">{formatMoney(size.price)}</p>
                          </div>
                        ))
                      : <p className="font-medium text-neutral-200">{formatMoney(item.price)}</p>}
                  </div>
                </li>
              ))}
            </ul>

          <div className="mt-8 flex flex-wrap items-center gap-4">
  <Link
    href="/drinks"
    className="inline-flex items-center justify-center rounded-full bg-white px-7 py-3.5 text-xs font-semibold uppercase tracking-[0.22em] text-black transition hover:bg-neutral-200"
  >
    View Galleta Café Drinks
  </Link>
  <a
    href="https://taximaxim.onelink.me/KKXl?pid=refferalmztall&af_dp=maximzakaz%3A%2F%2F&af_web_dp=https%3A%2F%2Ftaximaxim.com%2Fapp&c=menumzt"
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center justify-center rounded-full border border-white/25 px-7 py-3.5 text-xs font-semibold uppercase tracking-[0.22em] text-white transition hover:bg-white hover:text-black"
  >
    Get your drink on Maxim!
  </a>
</div>
            
          </div>
          <Photo
            src="/images/menu-carrier.jpg"
            alt="Biscoff latte, caramel macchiato, Spanish latte, sea salt cream"
            className="min-h-[280px] sm:min-h-[520px] lg:min-h-[680px]"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        </div>
      </section>

      <section id="about" className="px-4 py-12 sm:px-6 sm:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <Photo
            src="/images/storefront.jpg"
            alt="Galleta Café cafe storefront at night"
            className="min-h-[280px] sm:min-h-[480px] lg:min-h-[620px]"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
          <div className="max-w-lg lg:pl-6">
            <Eyebrow>About Us</Eyebrow>
            <Image
              src="/images/logo.jpg"
              alt={CAFE.name}
              width={200}
              height={200}
              className="mt-8 h-20 w-20 rounded-full object-cover"
            />
            <h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{CAFE.name}</h2>
            <p className="mt-3 text-[10px] tracking-[0.18em] text-neutral-500 uppercase sm:text-[11px] sm:tracking-[0.32em]">
              {CAFE.tagline}
            </p>
            <p className="mt-8 text-base leading-7 text-neutral-300 sm:text-lg sm:leading-8">
              Every cup tells a story, and every sip brings us closer together. A
              quiet industrial house in Sinunoc. Matcha umami, sea salt cream,
              panini, and a table meant to be shared.
            </p>
          </div>
        </div>
      </section>

      <section
        id="contact"
        className="border-t border-white/10 bg-[#0b0b0b] px-3 py-12 sm:px-6 sm:py-28"
      >
        <div className="mx-auto mb-8 max-w-6xl px-2 text-center sm:mb-12">
          <Eyebrow>Contact Us</Eyebrow>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-4xl">
            Where to find us?
          </h2>
        </div>
        <div className="mx-auto grid max-w-6xl gap-3 sm:gap-4 lg:grid-cols-12">
          <div className="flex flex-col justify-between border border-white/10 bg-black/40 px-5 py-8 sm:px-8 sm:py-10 lg:col-span-5">
            <div>
              <p className="text-[11px] tracking-[0.28em] text-neutral-500 uppercase">
                Visit
              </p>
              <a
                href={CAFE.mapsHref}
                target="_blank"
                rel="noreferrer"
                className="mt-6 block text-lg leading-relaxed text-white transition hover:text-neutral-300 sm:text-xl"
              >
                {CAFE.street}
                <span className="mt-2 block text-base text-neutral-300">
                  {CAFE.city}
                </span>
              </a>
            </div>
            <div className="mt-12 space-y-3 text-sm text-neutral-300">
              <p className="text-[10px] tracking-[0.12em] uppercase sm:tracking-[0.18em]">
                {CAFE.hours} · {CAFE.hoursNote}
              </p>
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
              <div className="pt-4">
                <p className="text-[10px] tracking-[0.28em] text-neutral-500 uppercase">
                  Follow
                </p>
                <div className="mt-3">
                  <SocialLinks />
                </div>
              </div>
            </div>
          </div>
          <Photo
            src="/images/open-now.jpg"
            alt="We're open now at Galleta Café"
            loading="eager"
            className="min-h-[220px] sm:min-h-[360px] lg:col-span-4 lg:min-h-[560px]"
            sizes="(max-width: 1024px) 100vw, 33vw"
          />
          <Photo
            src="/images/collage.jpg"
            alt="Galleta Café cafe moments"
            className="min-h-[220px] sm:min-h-[360px] lg:col-span-3 lg:min-h-[560px]"
            sizes="(max-width: 1024px) 100vw, 25vw"
          />
        </div>
      </section>

      <section className="border-t border-white/10 bg-black">
        <div className="mx-auto flex max-w-6xl items-end justify-between gap-4 px-5 py-6 sm:px-6 sm:py-8">
          <div>
            <p className="text-[11px] tracking-[0.28em] text-neutral-500 uppercase">
              Find us
            </p>
            <p className="mt-2 text-sm text-neutral-300">
              {CAFE.street}, {CAFE.city}
            </p>
          </div>
          <a
            href={CAFE.mapsHref}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-full border border-white/25 px-4 py-2 text-[10px] tracking-[0.18em] text-white uppercase transition hover:bg-white hover:text-black"
          >
            Open in Maps
          </a>
        </div>
        <div className="relative h-[260px] overflow-hidden border-t border-white/10 sm:h-[380px] lg:h-[460px]">
          <iframe
            title="Galleta Café on Google Maps"
            src={CAFE.mapsEmbed}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 h-full w-full border-0 grayscale contrast-125"
          />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}