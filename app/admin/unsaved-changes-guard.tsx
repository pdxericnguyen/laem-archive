"use client";

import { useEffect, useRef } from "react";

type Props = {
  selector: string;
};

function snapshotForm(form: HTMLFormElement) {
  const data = new FormData(form);
  const pairs: string[] = [];
  data.forEach((value, key) => {
    const normalizedValue = typeof value === "string" ? value : value.name;
    pairs.push(`${key}=${normalizedValue}`);
  });
  pairs.sort();
  return pairs.join("&");
}

export default function UnsavedChangesGuard({ selector }: Props) {
  const dirtyRef = useRef(false);
  const baselineRef = useRef(new Map<HTMLFormElement, string>());

  useEffect(() => {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>(selector));
    for (const form of forms) {
      baselineRef.current.set(form, snapshotForm(form));
    }

    function refreshDirtyFlag() {
      dirtyRef.current = forms.some((form) => {
        const baseline = baselineRef.current.get(form);
        return baseline !== snapshotForm(form);
      });
    }

    function onInput() {
      refreshDirtyFlag();
    }

    function onSubmit(event: Event) {
      const target = event.currentTarget;
      if (!(target instanceof HTMLFormElement)) {
        return;
      }
      baselineRef.current.set(target, snapshotForm(target));
      refreshDirtyFlag();
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    function onClick(event: MouseEvent) {
      if (!dirtyRef.current) {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const anchor = target.closest("a[href]");
      if (!anchor) {
        return;
      }
      if (!window.confirm("You have unsaved changes. Leave this page?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    for (const form of forms) {
      form.addEventListener("input", onInput);
      form.addEventListener("change", onInput);
      form.addEventListener("submit", onSubmit);
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);

    return () => {
      for (const form of forms) {
        form.removeEventListener("input", onInput);
        form.removeEventListener("change", onInput);
        form.removeEventListener("submit", onSubmit);
      }
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [selector]);

  return null;
}
