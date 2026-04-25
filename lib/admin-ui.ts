const ACTIVE_TAB_CLASS = "border-neutral-900 bg-neutral-900 text-white";
const INACTIVE_TAB_CLASS = "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50";

export function getAdminFilterTabClass(active: boolean) {
  return active ? ACTIVE_TAB_CLASS : INACTIVE_TAB_CLASS;
}

export function getAdminFilterCountClass(active: boolean) {
  return active ? "bg-white/15 text-white" : "bg-neutral-100 text-neutral-600";
}

export function getAdminQueueButtonClass(active: boolean) {
  return active
    ? "h-9 border px-3 text-xs font-semibold uppercase tracking-[0.12em] border-neutral-900 bg-neutral-900 text-white"
    : "h-9 border px-3 text-xs font-semibold uppercase tracking-[0.12em] border-neutral-300 text-neutral-700 hover:bg-neutral-50";
}
