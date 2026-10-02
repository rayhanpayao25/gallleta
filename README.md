git status# Coffee ZZ

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
   categories and items with the printed Coffee ZZ menu, adds 16oz/22oz prices
   and order-size persistence, and configures size-specific cup inventory.
   It deletes off-menu catalog rows; historical order snapshots remain intact.
