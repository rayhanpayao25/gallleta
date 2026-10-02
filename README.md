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

## POS printers

The POS treats cup labels and customer receipts as separate printer roles. Each
role has its own Web Serial connection, ESC/POS adapter, paper width, baud rate,
and persisted print jobs.

- Connect the label and receipt printers independently from the POS header.
- Paper width and baud rate can be changed in the Print dialog. Disconnect a
  printer before changing its baud rate, then reconnect it.
- Completing an order saves its print jobs before attempting either printer.
  Disconnected or failed jobs remain available under Print for an independent
  retry; successful jobs are not retried automatically.
- Test labels remain manual and are available only when
  `NEXT_PUBLIC_TEST_PRINTER=true`.

The initial adapters target ESC/POS over Web Serial. Actual USB, Bluetooth,
network, or vendor-specific printer support may require another transport or
protocol adapter; checkout and persisted job logic should not need to change.
