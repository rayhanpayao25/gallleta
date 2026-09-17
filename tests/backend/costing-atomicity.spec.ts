import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";

test("save_costing rollback: invalid save leaves the previous costing fully intact", async () => {
  const supabase = supabaseTestClient();
  const costingId = e2eId("costing");

  try {
    await supabase.rpc("save_costing", {
      p_id: costingId,
      p_product_name: "E2E Baseline Costing",
      p_ingredients: [{ name: "Baseline Ingredient", amount: 5, unit: "grams", outputCups: 1 }],
    });
    const baseline = await supabase.from("costings").select("*").eq("id", costingId).maybeSingle();
    expect(baseline.data?.product_name).toBe("E2E Baseline Costing");

    const badSave = await supabase.rpc("save_costing", {
      p_id: costingId,
      p_product_name: "SHOULD NOT PERSIST",
      p_ingredients: [{ name: "Bad", amount: "not-a-number", unit: "grams", outputCups: 1 }],
    });
    expect(badSave.error).toBeTruthy();

    const afterFail = await supabase.from("costings").select("*").eq("id", costingId).maybeSingle();
    expect(afterFail.data?.product_name, "parent name unchanged after rollback").toBe("E2E Baseline Costing");
    const ingredients = await supabase.from("costing_ingredients").select("*").eq("costing_id", costingId);
    expect(ingredients.data, "ingredients unchanged after rollback").toHaveLength(1);
    expect(ingredients.data![0].name).toBe("Baseline Ingredient");
  } finally {
    await supabase.from("costings").delete().eq("id", costingId);
  }
});

test("save_recipe_costing rollback: invalid save leaves the previous recipe costing fully intact", async () => {
  const supabase = supabaseTestClient();
  const recipeId = e2eId("rc");
  const realMenuItem = (await supabase.from("menu_items").select("id, name").limit(1).single()).data!;
  const realInventoryItem = (await supabase.from("inventory_items").select("id, name").limit(1).single()).data!;

  try {
    await supabase.rpc("save_recipe_costing", {
      p_id: recipeId,
      p_name: "E2E Baseline Recipe",
      p_hot_cup_inventory_item_id: null,
      p_iced_cup_inventory_item_id: null,
      p_other_cup_inventory_item_id: null,
      p_menu_items: [realMenuItem.name],
      p_ingredients: [{ inventoryItemId: realInventoryItem.id, name: realInventoryItem.name, amount: 5, unit: "grams" }],
    });
    const baseline = await supabase.from("recipe_costings").select("*").eq("id", recipeId).maybeSingle();
    expect(baseline.data?.name).toBe("E2E Baseline Recipe");

    const badSave = await supabase.rpc("save_recipe_costing", {
      p_id: recipeId,
      p_name: "SHOULD NOT PERSIST",
      p_hot_cup_inventory_item_id: null,
      p_iced_cup_inventory_item_id: null,
      p_other_cup_inventory_item_id: null,
      p_menu_items: [realMenuItem.name],
      p_ingredients: [{ inventoryItemId: realInventoryItem.id, name: realInventoryItem.name, amount: "not-a-number", unit: "grams" }],
    });
    expect(badSave.error).toBeTruthy();

    const afterFail = await supabase.from("recipe_costings").select("*").eq("id", recipeId).maybeSingle();
    expect(afterFail.data?.name, "parent name unchanged after rollback").toBe("E2E Baseline Recipe");
    const ingredients = await supabase.from("recipe_costing_ingredients").select("*").eq("recipe_costing_id", recipeId);
    expect(ingredients.data, "ingredients unchanged after rollback").toHaveLength(1);
    expect(Number(ingredients.data![0].amount)).toBe(5);
    const menuItems = await supabase.from("recipe_costing_menu_items").select("*").eq("recipe_costing_id", recipeId);
    expect(menuItems.data, "menu item assignment unchanged after rollback").toHaveLength(1);
  } finally {
    await supabase.from("recipe_costings").delete().eq("id", recipeId);
  }
});

test("rename_menu_category: rename in place does not create a duplicate row", async () => {
  const supabase = supabaseTestClient();
  const slug = e2eId("cat").toLowerCase();

  try {
    await supabase.from("menu_categories").insert({ id: slug, name: "E2E Category Original" });
    const rename1 = await supabase.rpc("rename_menu_category", { p_from_slug: slug, p_to_slug: slug, p_to_name: "E2E Category Renamed" });
    expect(rename1.data?.ok).toBe(true);

    const rows = await supabase.from("menu_categories").select("*").eq("id", slug);
    expect(rows.data, "same-slug rename updates in place, no duplicate row").toHaveLength(1);
    expect(rows.data![0].name).toBe("E2E Category Renamed");
  } finally {
    await supabase.from("menu_categories").delete().eq("id", slug);
  }
});
