"use client";

import { useMemo, useState } from "react";

type Row = {
  slug: string;
  title: string;
  stock: number;
};

type Props = {
  rows: Row[];
};

function normalizeStock(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export default function BulkStockEditor({ rows }: Props) {
  const [bulkMode, setBulkMode] = useState(false);
  const [stockDrafts, setStockDrafts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [applyValue, setApplyValue] = useState("0");
  const [currentRows, setCurrentRows] = useState(rows);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changedCount = useMemo(() => {
    return currentRows.reduce((count, row) => {
      const draft = stockDrafts[row.slug];
      if (typeof draft === "number" && draft !== row.stock) {
        return count + 1;
      }
      return count;
    }, 0);
  }, [currentRows, stockDrafts]);

  const selectedCount = useMemo(() => {
    return currentRows.reduce((count, row) => (selected[row.slug] ? count + 1 : count), 0);
  }, [currentRows, selected]);

  const selectedChangedCount = useMemo(() => {
    return currentRows.reduce((count, row) => {
      if (!selected[row.slug]) {
        return count;
      }
      const draft = stockDrafts[row.slug];
      if (typeof draft === "number" && draft !== row.stock) {
        return count + 1;
      }
      return count;
    }, 0);
  }, [currentRows, selected, stockDrafts]);

  const allSelected = currentRows.length > 0 && selectedCount === currentRows.length;

  function setDraft(slug: string, stock: number) {
    setStockDrafts((prev) => ({
      ...prev,
      [slug]: normalizeStock(stock)
    }));
  }

  function toggleSelected(slug: string) {
    setSelected((prev) => ({
      ...prev,
      [slug]: !prev[slug]
    }));
  }

  function setAllSelected(nextValue: boolean) {
    setSelected(() => {
      const next: Record<string, boolean> = {};
      for (const row of currentRows) {
        next[row.slug] = nextValue;
      }
      return next;
    });
  }

  function applyToSelected(nextStock: number) {
    const normalized = normalizeStock(nextStock);
    const selectedSlugs = currentRows.filter((row) => selected[row.slug]).map((row) => row.slug);
    if (selectedSlugs.length === 0) {
      setError("Select at least one row first.");
      setMessage(null);
      return;
    }

    setStockDrafts((prev) => {
      const next = { ...prev };
      for (const slug of selectedSlugs) {
        next[slug] = normalized;
      }
      return next;
    });

    setError(null);
    setMessage(`Applied stock ${normalized} to ${selectedSlugs.length} selected row(s).`);
  }

  function collectUpdates(scope: "all" | "selected") {
    return currentRows
      .map((row) => {
        if (scope === "selected" && !selected[row.slug]) {
          return null;
        }
        const draft = stockDrafts[row.slug];
        if (typeof draft !== "number" || draft === row.stock) {
          return null;
        }
        return { slug: row.slug, stock: normalizeStock(draft) };
      })
      .filter((item): item is { slug: string; stock: number } => Boolean(item));
  }

  async function save(scope: "all" | "selected") {
    const updates = collectUpdates(scope);

    if (scope === "selected" && selectedCount === 0) {
      setMessage("No selected rows.");
      setError(null);
      return;
    }

    if (scope === "selected" && updates.length === 0) {
      setMessage("No changes in selected rows.");
      setError(null);
      return;
    }

    if (updates.length === 0) {
      setMessage("No stock changes.");
      setError(null);
      return;
    }

    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/products/stock-bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates })
      });

      if (!response.ok) {
        const text = await response.text();
        setError(text || "Bulk stock update failed.");
        return;
      }

      setCurrentRows((prev) =>
        prev.map((row) => {
          const update = updates.find((item) => item.slug === row.slug);
          return update ? { ...row, stock: update.stock } : row;
        })
      );
      setStockDrafts((prev) => {
        const next = { ...prev };
        for (const update of updates) {
          delete next[update.slug];
        }
        return next;
      });
      setMessage(
        scope === "selected"
          ? `Saved ${updates.length} selected stock update(s).`
          : `Saved ${updates.length} stock update(s).`
      );
    } catch {
      setError("Bulk stock update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  if (currentRows.length === 0) {
    return null;
  }

  return (
    <section className="border border-neutral-200 p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Bulk Stock</h2>
          <p className="text-xs text-neutral-500">
            Edit stock across products, apply values to selected rows, and save in one request.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50"
            onClick={() => setBulkMode((value) => !value)}
          >
            {bulkMode ? "Exit Bulk Mode" : "Bulk Mode"}
          </button>
          <button
            type="button"
            className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-60"
            disabled={!bulkMode || isSaving || selectedChangedCount === 0}
            onClick={() => save("selected")}
          >
            {isSaving ? "Saving..." : `Save Selected (${selectedChangedCount})`}
          </button>
          <button
            type="button"
            className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-60"
            disabled={isSaving || changedCount === 0}
            onClick={() => save("all")}
          >
            {isSaving ? "Saving..." : `Save All (${changedCount})`}
          </button>
        </div>
      </div>

      {bulkMode ? (
        <div className="flex flex-wrap items-center gap-2 border border-neutral-200 p-3">
          <input
            type="number"
            min={0}
            className="h-9 w-28 border border-neutral-300 px-2 text-sm"
            value={applyValue}
            onChange={(event) => setApplyValue(event.target.value)}
          />
          <button
            type="button"
            className="h-9 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50"
            onClick={() => applyToSelected(Number(applyValue))}
          >
            Apply To Selected
          </button>
          <button
            type="button"
            className="h-9 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50"
            onClick={() => setAllSelected(true)}
          >
            Select All
          </button>
          <button
            type="button"
            className="h-9 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50"
            onClick={() => setAllSelected(false)}
          >
            Clear Selection
          </button>
          <span className="text-xs text-neutral-500">{selectedCount} selected</span>
        </div>
      ) : null}

      {message ? <p className="text-xs text-neutral-600">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="overflow-x-auto border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr className="text-left">
              {bulkMode ? (
                <th className="p-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => setAllSelected(event.target.checked)}
                    aria-label="Select all rows"
                  />
                </th>
              ) : null}
              <th className="p-3">Slug</th>
              <th className="p-3">Title</th>
              <th className="p-3">Stock</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.map((r) => (
              <tr key={r.slug} className="border-t border-neutral-200">
                {bulkMode ? (
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[r.slug])}
                      onChange={() => toggleSelected(r.slug)}
                      aria-label={`Select ${r.slug}`}
                    />
                  </td>
                ) : null}
                <td className="p-3 font-mono text-xs">{r.slug}</td>
                <td className="p-3">{r.title}</td>
                <td className="p-3">
                  {bulkMode ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        className="h-9 w-24 border border-neutral-300 px-2 text-sm"
                        value={stockDrafts[r.slug] ?? r.stock}
                        onChange={(e) => setDraft(r.slug, Number(e.target.value))}
                      />
                      <button
                        type="button"
                        className="h-9 px-2 border border-neutral-300 text-xs font-semibold"
                        onClick={() => setDraft(r.slug, (stockDrafts[r.slug] ?? r.stock) + 1)}
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        className="h-9 px-2 border border-neutral-300 text-xs font-semibold"
                        onClick={() => setDraft(r.slug, (stockDrafts[r.slug] ?? r.stock) + 5)}
                      >
                        +5
                      </button>
                      <button
                        type="button"
                        className="h-9 px-2 border border-neutral-300 text-xs font-semibold"
                        onClick={() => setDraft(r.slug, 0)}
                      >
                        0
                      </button>
                    </div>
                  ) : (
                    r.stock
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
