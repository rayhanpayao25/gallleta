import { redirect } from "next/navigation";
import { PosClient } from "@/components/PosClient";
import { getSession } from "@/lib/auth";
import { openBaristaShifts } from "@/lib/staff-sessions";
import { getStore } from "@/lib/store";
import type { Order } from "@/lib/types";

const POS_HISTORY_MS = 14 * 24 * 60 * 60 * 1000;

function withinPosWindow(iso: string | undefined) {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && Date.now() - at <= POS_HISTORY_MS;
}

function posOrders(orders: Order[]) {
  return orders.filter((order) => withinPosWindow(order.createdAt));
}

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const session = await getSession();
  if (!session) {
    redirect("/pos/auto-login");
  }
  if (session.role !== "cashier" && session.role !== "manager") {
    redirect("/");
  }

  let store;
  try {
    store = await getStore();
  } catch (error) {
    console.error("POS store load failed", error);
    return (
      <main className="flex h-svh flex-col items-center justify-center bg-neutral-100 px-6 text-center text-black">
        <p className="text-lg font-medium">POS could not load</p>
        <p className="mt-2 max-w-sm text-sm text-neutral-500">
          The store data did not come back from the server. Reload this page.
        </p>
      </main>
    );
  }

  let clockedInBaristas: { id: string; name: string; username: string }[] = [];
  try {
    clockedInBaristas = openBaristaShifts(store.loginActivity ?? []).map((shift) => ({
      id: shift.userId,
      name: shift.name,
      username: shift.username,
    }));
  } catch (error) {
    console.error("POS barista shifts failed", error);
  }

  const orders = posOrders(store.orders ?? []);
  return (
    <main className="h-svh overflow-hidden bg-neutral-100 text-black">
      <PosClient
        session={session}
        pos={store.pos ?? { isOpen: false, openedAt: null, openedBy: null }}
        menu={store.menu ?? []}
        categories={store.categories ?? []}
        orders={orders}
        clockedInBaristas={clockedInBaristas}
        inventoryStore={{
          orders,
          inventory: store.inventory ?? [],
          usageLogs: store.usageLogs ?? [],
          restocks: store.restocks ?? [],
          costings: store.costings ?? [],
          recipes: store.recipes ?? {},
          recipeCostings: store.recipeCostings ?? [],
          menu: store.menu ?? [],
        }}
      />
    </main>
  );
}
