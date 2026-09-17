"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { addonIdFromName, isFoodOrPastry, menuItemId, normalizeMenuAddons, normalizeMenuStyles } from "@/lib/menu";
import type { DrinkStyle, MenuAddon } from "@/lib/types";
import {
  deleteMenuCategoryRecord,
  deleteMenuItemRecord,
  getStore,
  renameMenuCategoryAtomic,
  updateStore,
  uploadPublicMenuPhoto,
} from "@/lib/store";

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    throw new Error("Only an admin can edit the menu.");
  }
  return session;
}

function refresh() {
  revalidatePath("/pos");
  revalidatePath("/admin");
  revalidatePath("/drinks");
  revalidatePath("/");
}

function isSafeImage(src: string) {
  return (
    src.startsWith("/images/") ||
    src.startsWith("/uploads/menu/") ||
    src.includes(".supabase.co/storage/")
  );
}

function readText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function saveMenuPhoto(file: File, id: string) {
  const ext = PHOTO_TYPES[file.type];
  if (!ext) {
    return { error: "Use a JPG, PNG, WEBP, or GIF photo." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: "Keep photos under 5MB." };
  }

  const safeId = id.replace(/[^a-z0-9-]/gi, "") || "item";
  const filename = `${safeId}-${Date.now().toString(36)}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const src = await uploadPublicMenuPhoto(filename, bytes, file.type);
    return { src };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not upload photo.",
    };
  }
}

function photoFromForm(formData: FormData) {
  const photo = formData.get("photo");
  return photo instanceof File && photo.size > 0 ? photo : null;
}

function stylesFromForm(formData: FormData, category: string): DrinkStyle[] {
  if (isFoodOrPastry(category)) return [];
  const selected: DrinkStyle[] = formData.getAll("styles").flatMap((value) => {
    const style = String(value);
    return style === "iced" || style === "hot" ? [style] : [];
  });
  return normalizeMenuStyles({ category, styles: selected });
}

function addonsFromForm(formData: FormData): MenuAddon[] {
  const packed = formData.get("addons");
  if (typeof packed === "string" && packed.trim()) {
    try {
      const parsed = JSON.parse(packed) as MenuAddon[];
      if (Array.isArray(parsed)) return normalizeMenuAddons({ addons: parsed });
    } catch {
      // Fall through to the field list below.
    }
  }
  const names = formData.getAll("addonName").map((value) => String(value ?? "").trim());
  const prices = formData.getAll("addonPrice").map((value) => String(value ?? "").trim());
  const ids = formData.getAll("addonId").map((value) => String(value ?? "").trim());
  const qtyFlags = formData.getAll("addonQtyEnabled").map((value) => String(value ?? "").trim());
  return normalizeMenuAddons({
    addons: names.flatMap((name, index) => {
      if (!name) return [];
      const price = Number(prices[index]);
      return [
        {
          id: ids[index] || addonIdFromName(name, index),
          name,
          price: Number.isFinite(price) ? price : 0,
          qtyEnabled: qtyFlags[index] === "1",
        },
      ];
    }),
  });
}

export async function addMenuCategory(name: string) {
  await requireAdmin();
  const category = name.trim();
  if (!category) {
    return { error: "Enter a category name." };
  }

  let error: string | undefined;
  await updateStore((store) => {
    const exists = store.categories.some(
      (entry) => entry.toLowerCase() === category.toLowerCase(),
    );
    if (exists) {
      error = "That category is already on the board.";
      return;
    }
    store.categories.push(category);
  });
  if (error) return { error };
  refresh();
  return { ok: true };
}

export async function renameMenuCategory(from: string, to: string) {
  await requireAdmin();
  const prev = from.trim();
  const next = to.trim();
  if (!prev) return { error: "Category not found." };
  if (!next) return { error: "Enter a category name." };

  const store = await getStore();
  const taken = store.categories.some(
    (entry) => entry.toLowerCase() === next.toLowerCase() && entry.toLowerCase() !== prev.toLowerCase(),
  );
  if (taken) {
    return { error: "That category is already on the board." };
  }

  // rename_menu_category_atomic updates the existing row in place (same
  // slug) or inserts the new one, repoints menu_items.category_id, and
  // deletes the old row - all in one transaction, so no duplicate/orphaned
  // category row can be left behind the way the old insert-only path could.
  const result = await renameMenuCategoryAtomic(prev, next);
  if (!result.ok) return { error: result.error };

  refresh();
  return { ok: true };
}

export async function deleteMenuCategory(name: string) {
  await requireAdmin();
  const category = name.trim();
  if (!category) return { error: "Category not found." };

  const store = await getStore();
  const inUse = store.menu.some(
    (item) => item.category.toLowerCase() === category.toLowerCase(),
  );
  if (inUse) {
    return { error: "Move or delete drinks in this category first." };
  }

  try {
    await deleteMenuCategoryRecord(category);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not delete that category." };
  }
  refresh();
  return { ok: true };
}

export async function createMenuItem(formData: FormData) {
  await requireAdmin();
  const name = readText(formData, "name");
  const category = readText(formData, "category");
  const price = Number(readText(formData, "price"));
  const available = readText(formData, "available") !== "false";
  const photo = photoFromForm(formData);

  if (!name || !category) {
    return { error: "Name and category are required." };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "Enter a valid price." };
  }

  const id = menuItemId(name);
  let image = "/images/logo.jpg";
  if (photo) {
    const saved = await saveMenuPhoto(photo, id);
    if ("error" in saved && saved.error) return { error: saved.error };
    if ("src" in saved && saved.src) image = saved.src;
  }

  await updateStore((store) => {
    if (!store.categories.some((entry) => entry.toLowerCase() === category.toLowerCase())) {
      store.categories.push(category);
    }
    store.menu.push({
      id,
      name,
      price: Math.round(price),
      category,
      image,
      available,
      styles: stylesFromForm(formData, category),
      addons: addonsFromForm(formData),
    });
  });
  refresh();
  return { ok: true };
}

export async function updateMenuItem(formData: FormData) {
  await requireAdmin();
  const id = readText(formData, "id");
  const name = readText(formData, "name");
  const category = readText(formData, "category");
  const price = Number(readText(formData, "price"));
  const available = readText(formData, "available") !== "false";
  const photo = photoFromForm(formData);

  if (!id) return { error: "Item not found." };
  if (!name || !category) {
    return { error: "Name and category are required." };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "Enter a valid price." };
  }

  let uploaded: string | undefined;
  if (photo) {
    const saved = await saveMenuPhoto(photo, id);
    if ("error" in saved && saved.error) return { error: saved.error };
    if ("src" in saved) uploaded = saved.src;
  }

  let error: string | undefined;
  await updateStore((store) => {
    const item = store.menu.find((entry) => entry.id === id);
    if (!item) {
      error = "Item not found.";
      return;
    }
    item.name = name;
    item.price = Math.round(price);
    item.category = category;
    item.available = available;
    item.styles = stylesFromForm(formData, category);
    item.addons = addonsFromForm(formData);
    if (uploaded) {
      item.image = uploaded;
    } else if (!isSafeImage(item.image)) {
      item.image = "/images/logo.jpg";
    }
    if (!store.categories.some((entry) => entry.toLowerCase() === category.toLowerCase())) {
      store.categories.push(category);
    }
  });
  if (error) return { error };
  refresh();
  return { ok: true };
}

export async function setMenuItemAvailable(id: string, available: boolean) {
  await requireAdmin();
  await updateStore((store) => {
    const item = store.menu.find((entry) => entry.id === id);
    if (item) item.available = available;
  });
  refresh();
  return { ok: true };
}

export async function deleteMenuItem(id: string) {
  await requireAdmin();
  await deleteMenuItemRecord(id);
  refresh();
  return { ok: true };
}
