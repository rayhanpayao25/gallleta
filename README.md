git status# Galleta Café

Next.js (App Router) + TypeScript project.

## Getting Started

```bashs
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

Edit `src/app/page.tsx` — the page updates as you save.

## Database migrations

Apply the Supabase migrations in timestamp order before deploying:

1. `supabase/migrations/20260920000000_remove_promotions_void_and_off_requests.sql`
   permanently removes promotion/off-request data, void requests, voided
   orders, and their database schema and RPCs.
2. `supabase/migrations/20260921000000_photo_menu_sizes.sql` replaces menu
   categories and items with the previous cafe catalog, adds
   16oz/22oz prices and order-size persistence, and configures size-specific
   cup inventory.
   It deletes off-menu catalog rows; historical order snapshots remain intact.
3. `supabase/migrations/20261005000000_printed_menu_catalog.sql` replaces the
   catalog with the current printed menu, including its categories, prices,
   drink add-ons, and chicken-wing sizes.
4. `supabase/migrations/20261005000001_restore_create_order_atomic.sql`
   ensures the current order-creation RPC signature and service-role grant
   are installed.
5. `supabase/migrations/20261005000002_menu_category_type.sql` adds a Type field
   to menu categories.
6. `supabase/migrations/20261005000003_menu_item_types.sql` adds selectable,
   no-extra-charge types to menu items and persists the chosen type on orders.

## Direct Bluetooth thermal printing

The POS print button sends ESC/POS bytes directly from Chrome on Android using
Web Bluetooth. The printer must support Bluetooth Low Energy (GATT), ESC/POS,
and either service/characteristic pair `18F0/2AF1` or `FF00/FF02`. Bluetooth
Classic/SPP-only printers are not compatible with browser direct printing.
The POS site must be served from HTTPS or localhost.

## Printed menu automation

Preview the menu seed with:

```bash
python automation.py
```

To upsert the printed menu into Supabase, set `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` in the environment, `.env.local`, or `.env`, then run:

```bash
python automation.py --apply
```

To also remove categories and items not listed in the printed catalog, run
`python automation.py --apply --replace`.
