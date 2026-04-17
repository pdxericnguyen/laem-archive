"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Command = {
  id: string;
  label: string;
  href: string;
  keywords: string;
};

const COMMANDS: Command[] = [
  { id: "admin", label: "Go to Admin Home", href: "/admin", keywords: "dashboard home" },
  { id: "orders", label: "Go to Orders", href: "/admin/orders", keywords: "orders fulfillment shipping" },
  { id: "products", label: "Go to Products", href: "/admin/products", keywords: "catalog stock inventory" },
  { id: "visuals", label: "Go to Site Visuals", href: "/admin/visuals", keywords: "visuals campaign banners" }
];

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

export default function AdminCommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingGoto, setPendingGoto] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return COMMANDS;
    }
    return COMMANDS.filter((command) => {
      const haystack = `${command.label} ${command.keywords}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }

      if (!isEditableTarget(target) && key === "/") {
        event.preventDefault();
        setOpen(true);
        return;
      }

      if (!isEditableTarget(target) && key === "g" && !open) {
        setPendingGoto(true);
        window.setTimeout(() => setPendingGoto(false), 800);
        return;
      }

      if (!isEditableTarget(target) && pendingGoto && !open) {
        if (key === "o") {
          router.push("/admin/orders");
          setPendingGoto(false);
          return;
        }
        if (key === "p") {
          router.push("/admin/products");
          setPendingGoto(false);
          return;
        }
        if (key === "v") {
          router.push("/admin/visuals");
          setPendingGoto(false);
          return;
        }
      }

      if (open && key === "escape") {
        event.preventDefault();
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pendingGoto, router]);

  function execute(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
        <button
          type="button"
          className="h-8 border border-neutral-300 px-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          onClick={() => setOpen(true)}
        >
          Jump (Cmd/Ctrl+K)
        </button>
        <span>Shortcuts: `g o` Orders, `g p` Products, `g v` Visuals</span>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 bg-black/25 p-4">
          <div className="mx-auto mt-12 max-w-xl border border-neutral-300 bg-white p-3 shadow-xl">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full border border-neutral-300 px-3 text-sm"
              placeholder="Jump to admin page..."
            />
            <div className="mt-2 grid gap-1">
              {filtered.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  onClick={() => execute(command.href)}
                  className="h-10 border border-neutral-200 px-3 text-left text-sm hover:bg-neutral-50"
                >
                  {command.label}
                </button>
              ))}
              {filtered.length === 0 ? <p className="px-2 py-1 text-xs text-neutral-500">No matches.</p> : null}
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="h-8 border border-neutral-300 px-2 text-xs font-semibold hover:bg-neutral-50"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
