-- Phase 3: persist the InventoryItem fields the Stock Inventory UI already
-- reads/writes client-side (openingStock, purchaseUnitSize, cupUsageAmount,
-- cupsMake) but that src/lib/store.ts never sent to or read from Supabase.
-- All four are optional on the TypeScript type, so they stay nullable here
-- and existing rows are left null - the application already has fallback
-- logic for that case (SalePurchaseTransactions.tsx's persistedStocks
-- mapping), which this migration does not change.

alter table public.inventory_items
  add column if not exists opening_stock numeric null,
  add column if not exists purchase_unit_size numeric null,
  add column if not exists cup_usage_amount numeric null,
  add column if not exists cups_make numeric null;
