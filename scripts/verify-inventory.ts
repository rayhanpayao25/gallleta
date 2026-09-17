import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

type InventoryRow = {
  id: string;
  name: string;
  unit: string | null;
  cost: number | string | null;
  stock: number | string | null;
  max_stock: number | string | null;
};

async function verifyInventory() {
  const supabase = createClient(
    getEnv("SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, name, unit, cost, stock, max_stock")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to read inventory_items: ${error.message}`);
  }

  const inventory = (data ?? []) as InventoryRow[];
  const invalidRows = inventory.filter((item) => {
    const cost = Number(item.cost);
    const stock = Number(item.stock);
    const maxStock = Number(item.max_stock);

    return (
      !item.id?.trim() ||
      !item.name?.trim() ||
      !Number.isFinite(cost) ||
      !Number.isFinite(stock) ||
      !Number.isFinite(maxStock) ||
      cost < 0 ||
      stock < 0 ||
      maxStock < 0 ||
      stock > maxStock
    );
  });

  const duplicateIds = inventory
    .map((item) => item.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);

  const duplicateNames = inventory
    .map((item) => item.name.trim().toLowerCase())
    .filter((name, index, names) => names.indexOf(name) !== index);

  const result = {
    valid: invalidRows.length === 0 && duplicateIds.length === 0 && duplicateNames.length === 0,
    source: "Supabase inventory_items",
    count: inventory.length,
    items: inventory,
    issues: {
      invalidRows: invalidRows.map((item) => item.id),
      duplicateIds: [...new Set(duplicateIds)],
      duplicateNames: [...new Set(duplicateNames)],
    },
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.valid) {
    process.exitCode = 1;
  }
}

verifyInventory().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export { verifyInventory };
export type { InventoryRow };
  