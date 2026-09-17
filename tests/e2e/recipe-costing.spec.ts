import { test, expect } from "@playwright/test";
import { loginAsAdmin, openAdminPanel, reloadIntoAdminPanel, supabaseTestClient, pollUntil, e2eId } from "./utils";

test("Recipe Costing: create, reload persists, edit, reload persists, delete, reload stays gone", async ({ page }) => {
  const supabase = supabaseTestClient();
  const recipeName = `E2E Recipe ${e2eId("rc")}`;

  await loginAsAdmin(page);
  await openAdminPanel(page, "Inventory");
  await page.click('button:has-text("Costing")');
  await page.waitForSelector('button:has-text("Add recipe")', { timeout: 10000 });

  await page.click('button:has-text("Add recipe")');
  const editingSection = page.locator('section:has(input[placeholder="Recipe name"])');
  await editingSection.locator('input[placeholder="Recipe name"]').fill(recipeName);

  const firstMenuCheckbox = editingSection.locator('label:has(input[type="checkbox"])').first();
  await firstMenuCheckbox.locator('input[type="checkbox"]').check();

  const ingredientSelect = editingSection.locator('select:has(option:has-text("Select ingredient"))').first();
  const inventoryOptionValue = await ingredientSelect.locator("option").nth(1).getAttribute("value");
  await ingredientSelect.selectOption(inventoryOptionValue!);
  await editingSection.locator('input[placeholder="Qty"]').first().fill("2");
  await editingSection.locator('input[placeholder="Unit"]').first().fill("grams");

  await page.locator("button", { hasText: /^Save$/ }).click();
  await page.waitForTimeout(2000);

  const created = await pollUntil(async () => (await supabase.from("recipe_costings").select("*").eq("name", recipeName).maybeSingle()).data, 15000);
  expect(created, "recipe costing should persist to DB").toBeTruthy();
  const recipeId = created!.id as string;

  await reloadIntoAdminPanel(page, "Inventory", "recipes");
  await page.waitForSelector('button:has-text("Add recipe")', { timeout: 10000 });
  await expect(page.locator(`text=${recipeName}`)).toBeVisible();

  // Edit: change the recipe's name and ingredient amount.
  await page.click(`button:has-text("${recipeName}")`);
  await page.waitForTimeout(300);
  const editedName = `${recipeName} EDITED`;
  const nameInput = editingSection.locator('input[placeholder="Recipe name"]');
  await nameInput.fill("");
  await nameInput.fill(editedName);
  await editingSection.locator('input[placeholder="Qty"]').first().fill("");
  await editingSection.locator('input[placeholder="Qty"]').first().fill("9");
  await page.locator("button", { hasText: /^Save$/ }).click();
  await page.waitForTimeout(2000);

  const edited = await pollUntil(async () => {
    const r = await supabase.from("recipe_costings").select("*").eq("id", recipeId).maybeSingle();
    return r.data?.name === editedName ? r.data : null;
  }, 15000);
  expect(edited, "edited name should persist").toBeTruthy();

  await reloadIntoAdminPanel(page, "Inventory", "recipes");
  await page.waitForSelector('button:has-text("Add recipe")', { timeout: 10000 });
  await expect(page.locator(`text=${editedName}`)).toBeVisible();
  const ingredientsAfterEdit = await supabase.from("recipe_costing_ingredients").select("*").eq("recipe_costing_id", recipeId);
  expect(ingredientsAfterEdit.data, "ingredients should be replaced, not duplicated").toHaveLength(1);
  expect(Number(ingredientsAfterEdit.data![0].amount)).toBe(9);

  // Delete.
  const deleteButton = page.locator(`[aria-label="Delete ${editedName}"]`);
  await deleteButton.click();
  await pollUntil(async () => {
    const rows = await supabase.from("recipe_costings").select("id").eq("id", recipeId);
    return (rows.data ?? []).length === 0 ? true : null;
  });

  await reloadIntoAdminPanel(page, "Inventory", "recipes");
  await page.waitForSelector('button:has-text("Add recipe")', { timeout: 10000 });
  await expect(page.locator(`text=${editedName}`)).toHaveCount(0);

  const stillGone = await supabase.from("recipe_costings").select("id").eq("id", recipeId);
  expect(stillGone.data ?? []).toHaveLength(0);
  const ingredientsGone = await supabase.from("recipe_costing_ingredients").select("id").eq("recipe_costing_id", recipeId);
  expect(ingredientsGone.data ?? []).toHaveLength(0);
});
