"use client";

import { useEffect, useState } from "react";

type StockItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  cost: number;
  stock: number;
  maxStock: number;
  totalUsed?: number;
  totalStock?: number;
};

const STORAGE_KEY = "cafe_stocks_data";

export function StockManager({ title = "Inventory Management" }: { title?: string }) {
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [maxStock, setMaxStock] = useState("");
  const [restockQuantities, setRestockQuantities] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editCost, setEditCost] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editMaxStock, setEditMaxStock] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) setStocks(parsed as StockItem[]);
    } catch (error) {
      console.error("Failed to parse saved inventory", error);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stocks));
  }, [stocks]);

  const clearForm = () => {
    setName("");
    setCategory("");
    setUnit("");
    setCost("");
    setStock("");
    setMaxStock("");
  };

  const handleAdd = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !category.trim() || !unit.trim()) return;

    const numericCost = Number(cost);
    const numericStock = Number(stock);
    const numericMaxStock = Number(maxStock);
    if (![numericCost, numericStock, numericMaxStock].every(Number.isFinite)) return;
    if (numericCost < 0 || numericStock < 0 || numericMaxStock < 0) return;

    setStocks((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        category: category.trim(),
        unit: unit.trim(),
        cost: numericCost,
        stock: numericStock,
        maxStock: numericMaxStock,
        totalStock: numericStock,
        totalUsed: 0,
      },
    ]);
    clearForm();
  };

  const handleDelete = (id: string) => {
    setStocks((current) => current.filter((item) => item.id !== id));
  };

  const handleRestock = (id: string) => {
    const quantity = Number(restockQuantities[id]);
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    setStocks((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              stock: item.stock + quantity,
              totalStock: (item.totalStock ?? item.stock + (item.totalUsed ?? 0)) + quantity,
            }
          : item,
      ),
    );
    setRestockQuantities((current) => ({ ...current, [id]: "" }));
  };

  const startEdit = (item: StockItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditCategory(item.category);
    setEditUnit(item.unit);
    setEditCost(String(item.cost));
    setEditStock(String(item.stock));
    setEditMaxStock(String(item.maxStock));
  };

  const handleUpdate = (id: string) => {
    const numericCost = Number(editCost);
    const numericStock = Number(editStock);
    const numericMaxStock = Number(editMaxStock);
    if (!editName.trim() || !editCategory.trim() || !editUnit.trim()) return;
    if (![numericCost, numericStock, numericMaxStock].every(Number.isFinite)) return;
    if ([numericCost, numericStock, numericMaxStock].some((value) => value < 0)) return;

    setStocks((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              name: editName.trim(),
              category: editCategory.trim(),
              unit: editUnit.trim(),
              cost: numericCost,
              stock: numericStock,
              maxStock: numericMaxStock,
            }
          : item,
      ),
    );
    setEditingId(null);
  };

  return (
    <section className="space-y-6 p-6">
      <header>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-neutral-500">Magdagdag at mamahala ng inventory items.</p>
      </header>

      <form onSubmit={handleAdd} className="grid grid-cols-1 gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2 md:grid-cols-7">
        <input required placeholder="Item Name" value={name} onChange={(event) => setName(event.target.value)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <input required placeholder="Category" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <input required placeholder="Unit (kg, L, pcs)" value={unit} onChange={(event) => setUnit(event.target.value)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <input required min="0" type="number" placeholder="Cost" value={cost} onChange={(event) => setCost(event.target.value)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <input required min="0" type="number" placeholder="Current Stock" value={stock} onChange={(event) => setStock(event.target.value)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <input required min="0" type="number" placeholder="Max Capacity" value={maxStock} onChange={(event) => setMaxStock(event.target.value)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
        <button type="submit" className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 md:col-span-7">Add Inventory Item</button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[850px] border-collapse text-left text-sm">
          <thead><tr className="border-b border-neutral-200 bg-neutral-50 text-neutral-500"><th className="p-4">Item Name</th><th className="p-4">Category</th><th className="p-4 text-right">Remaining</th><th className="p-4 text-right">Total Used</th><th className="p-4 text-right">Total Stock</th><th className="p-4 text-center">Restock</th><th className="p-4 text-right">Actions</th></tr></thead>
          <tbody>
            {stocks.map((item) => {
              const editing = editingId === item.id;
              return <tr key={item.id} className="border-b border-neutral-100 hover:bg-neutral-50/50">
                <td className="p-4">{editing ? <input value={editName} onChange={(event) => setEditName(event.target.value)} className="w-full rounded border px-2 py-1" /> : <span className="font-medium">{item.name}</span>}</td>
                <td className="p-4">{editing ? <input value={editCategory} onChange={(event) => setEditCategory(event.target.value)} className="w-full rounded border px-2 py-1" /> : item.category}</td>
                <td className="p-4 text-right">{editing ? <input type="number" min="0" value={editStock} onChange={(event) => setEditStock(event.target.value)} className="w-24 rounded border px-2 py-1 text-right" /> : item.stock}</td>
                <td className="p-4 text-right text-red-600">{item.totalUsed ?? 0}</td>
                <td className="p-4 text-right font-semibold">{item.totalStock ?? item.stock + (item.totalUsed ?? 0)}</td>
                <td className="p-4 text-center">{editing ? <input type="number" min="0" value={editMaxStock} onChange={(event) => setEditMaxStock(event.target.value)} className="w-20 rounded border px-2 py-1 text-center" /> : <div className="flex justify-center gap-2"><input type="number" min="1" placeholder="+Qty" value={restockQuantities[item.id] ?? ""} onChange={(event) => setRestockQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="w-20 rounded border px-2 py-1 text-center" /><button onClick={() => handleRestock(item.id)} className="rounded bg-black px-3 py-1 text-xs text-white">Add</button></div>}</td>
                <td className="space-x-3 p-4 text-right">{editing ? <><button onClick={() => handleUpdate(item.id)} className="text-xs font-medium hover:underline">Save</button><button onClick={() => setEditingId(null)} className="text-xs text-neutral-500 hover:underline">Cancel</button></> : <><button onClick={() => startEdit(item)} className="text-xs font-medium hover:underline">Edit</button><button onClick={() => handleDelete(item.id)} className="text-xs font-medium text-red-600 hover:underline">Delete</button></>}</td>
              </tr>;
            })}
          </tbody>
        </table>
        {stocks.length === 0 && <p className="p-8 text-center text-sm text-neutral-500">No inventory items yet. Add your first item above.</p>}
      </div>
    </section>
  );
}

export type { StockItem };
export default StockManager;
