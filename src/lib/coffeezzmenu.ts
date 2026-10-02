import { DEFAULT_MENU } from "@/lib/menu";
import type { MenuItem } from "@/lib/types";

// Signature drinks and selected categories from the default menu.
export const COFFEE_ZZ_MENU: MenuItem[] = DEFAULT_MENU.filter(
  (item) =>
    item.category === "Signature Coffee" ||
    item.category === "Non-Coffee / Matcha" ||
    item.category === "Classic Coffee"
);