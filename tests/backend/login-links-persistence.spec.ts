import { test, expect } from "@playwright/test";
import { supabaseTestClient, e2eId } from "../e2e/utils";
import { getFreshStore, updateStore } from "@/lib/store";

test("login links persist to Supabase and a fresh read uses the stored paths", async () => {
  const supabase = supabaseTestClient();
  const initial = await getFreshStore();
  const originalGates = initial.loginGates;
  const tag = e2eId("gates").slice(-14);
  const savedPaths = {
    admin: `admin-${tag}`,
    cashier: `cashier-${tag}`,
  };
  const externallyUpdatedPaths = {
    admin: `fresh-admin-${tag}`,
    cashier: `fresh-cashier-${tag}`,
  };
  let pathsChanged = false;

  try {
    pathsChanged = true;
    const { error: deleteError } = await supabase
      .from("login_links")
      .delete()
      .eq("id", "coffeezz-coffee");
    if (deleteError) throw deleteError;

    // updateStore must recreate the singleton when the row is missing.
    await updateStore((store) => {
      store.loginGates = savedPaths;
    });

    const { data: persisted, error: readError } = await supabase
      .from("login_links")
      .select("admin_path, cashier_path")
      .eq("id", "coffeezz-coffee")
      .single();
    if (readError) throw readError;
    expect(persisted).toEqual({
      admin_path: savedPaths.admin,
      cashier_path: savedPaths.cashier,
    });

    // An external write must win over any snapshot held by this process.
    const { error: updateError } = await supabase
      .from("login_links")
      .update({
        admin_path: externallyUpdatedPaths.admin,
        cashier_path: externallyUpdatedPaths.cashier,
      })
      .eq("id", "coffeezz-coffee");
    if (updateError) throw updateError;

    const freshStore = await getFreshStore();
    expect(freshStore.loginGates).toEqual(externallyUpdatedPaths);
  } finally {
    if (pathsChanged) {
      const { error } = await supabase
        .from("login_links")
        .upsert({
          id: "coffeezz-coffee",
          admin_path: originalGates.admin,
          cashier_path: originalGates.cashier,
        }, { onConflict: "id" });
      if (error) throw error;
      await getFreshStore();
    }
  }
});
