"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type CartItem = {
  slug: string;
  title: string;
  priceCents: number;
  image: string;
  stock: number;
  quantity: number;
};

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotalCents: number;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  setQuantity: (slug: string, quantity: number) => void;
  removeItem: (slug: string) => void;
  clear: () => void;
};

const STORAGE_KEY = "laem_cart_v1";
const CartContext = createContext<CartContextValue | null>(null);

function clampQuantity(value: number, maxStock: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(Math.floor(value), Math.max(1, Math.floor(maxStock || 1))));
}

function normalizeItems(input: unknown): CartItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const rows: CartItem[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const item = row as Record<string, unknown>;
    const slug = typeof item.slug === "string" ? item.slug.trim() : "";
    const title = typeof item.title === "string" ? item.title : "";
    const image = typeof item.image === "string" ? item.image : "";
    const priceCents =
      typeof item.priceCents === "number" && Number.isFinite(item.priceCents)
        ? Math.max(0, Math.floor(item.priceCents))
        : 0;
    const stock =
      typeof item.stock === "number" && Number.isFinite(item.stock) ? Math.max(0, Math.floor(item.stock)) : 0;
    const quantity =
      typeof item.quantity === "number" && Number.isFinite(item.quantity)
        ? clampQuantity(item.quantity, stock || 1)
        : 1;

    if (!slug || !title || !image) {
      continue;
    }

    rows.push({
      slug,
      title,
      image,
      priceCents,
      stock,
      quantity
    });
  }

  return rows;
}

function loadFromStorage(): CartItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return normalizeItems(parsed);
  } catch {
    return [];
  }
}

function saveToStorage(items: CartItem[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(loadFromStorage());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    saveToStorage(items);
  }, [items, hydrated]);

  const addItem = useCallback((item: Omit<CartItem, "quantity">, quantity = 1) => {
    setItems((prev) => {
      const index = prev.findIndex((row) => row.slug === item.slug);
      if (index < 0) {
        return [
          ...prev,
          {
            ...item,
            quantity: clampQuantity(quantity, item.stock || 1)
          }
        ];
      }

      const current = prev[index];
      const nextQuantity = clampQuantity(current.quantity + quantity, item.stock || current.stock || 1);
      const next = [...prev];
      next[index] = {
        ...current,
        ...item,
        quantity: nextQuantity
      };
      return next;
    });
  }, []);

  const setQuantity = useCallback((slug: string, quantity: number) => {
    setItems((prev) =>
      prev
        .map((item) => {
          if (item.slug !== slug) {
            return item;
          }
          return {
            ...item,
            quantity: clampQuantity(quantity, item.stock || 1)
          };
        })
        .filter((item) => item.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((slug: string) => {
    setItems((prev) => prev.filter((item) => item.slug !== slug));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );
  const subtotalCents = useMemo(
    () => items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0),
    [items]
  );

  const value = useMemo(
    () => ({
      items,
      itemCount,
      subtotalCents,
      addItem,
      setQuantity,
      removeItem,
      clear
    }),
    [addItem, clear, itemCount, items, removeItem, setQuantity, subtotalCents]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within CartProvider");
  }
  return context;
}
