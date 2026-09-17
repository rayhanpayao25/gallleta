import { redirect } from "next/navigation";
import { PosClient } from "@/components/PosClient";
import { getSession } from "@/lib/auth";
import { openBaristaShifts } from "@/lib/staff-sessions";
import { getStore } from "@/lib/store";
import type { Order, PrintJob, VoidRequest } from "@/lib/types";

const POS_HISTORY_MS = 14 * 24 * 60 * 60 * 1000;

function withinPosWindow(iso: string | undefined) {
  if (!iso) return false;
  const at = Date.parse(iso);
  return Number.isFinite(at) && Date.now() - at <= POS_HISTORY_MS;
}

function posOrders(orders: Order[]) {
  return orders.filter((order) => withinPosWindow(order.createdAt));
}

function posPrintJobs(jobs: PrintJob[], orderIds: Set<string>) {
  return jobs.filter(
    (job) =>
      orderIds.has(job.orderId) ||
      job.status === "pending" ||
      job.status === "failed",
  );
}

function posVoidRequests(requests: VoidRequest[]) {
  return requests.filter((request) => withinPosWindow(request.requestedAt));
}

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const session = await getSession();
  if (!session || (session.role !== "cashier" && session.role !== "manager")) {
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
  const orderIds = new Set(orders.map((order) => order.id));
  const printJobs = posPrintJobs(store.printJobs ?? [], orderIds);
  const voidRequests = posVoidRequests(store.voidRequests ?? []);

  return (
    <main className="h-svh overflow-hidden bg-neutral-100 text-black">
      <PosClient
        session={session}
        pos={store.pos ?? { isOpen: false, openedAt: null, openedBy: null }}
        menu={store.menu ?? []}
        categories={store.categories ?? []}
        promotions={store.promotions ?? []}
        orders={orders}
        clockedInBaristas={clockedInBaristas}
        printJobs={printJobs}
        voidRequests={voidRequests}
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
