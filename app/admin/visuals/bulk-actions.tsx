"use client";

import { useRef, useState, type ChangeEvent } from "react";

import {
  IMAGE_UPLOAD_FIELD_FLUSH_EVENT,
  IMAGE_UPLOAD_FIELD_STAGE_EVENT,
  type ImageUploadFieldFlushResult
} from "@/app/admin/products/image-upload-field";
import type { SiteVisualPlacement } from "@/lib/site-visuals";

type VisualPayload = {
  placement: SiteVisualPlacement;
  imageUrl: string;
  altText: string;
  eyebrow: string;
  headline: string;
  body: string;
  linkHref: string;
  linkLabel: string;
  published: boolean;
};

type Props = {
  placements: SiteVisualPlacement[];
  initialPayloads: Record<SiteVisualPlacement, VisualPayload>;
};

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0] || ""
  );
}

function normalizePlacementKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function mapFileToPlacement(fileName: string, placements: SiteVisualPlacement[]) {
  const normalizedFile = normalizePlacementKey(fileName.replace(/\.[^.]+$/, ""));
  for (const placement of placements) {
    const normalizedPlacement = normalizePlacementKey(placement);
    if (normalizedFile === normalizedPlacement || normalizedFile.startsWith(`${normalizedPlacement}.`)) {
      return placement;
    }
  }
  return null;
}

function readTextControl(form: HTMLFormElement, name: string) {
  const control = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `input[name="${name}"], textarea[name="${name}"]`
  );
  if (!control) {
    return "";
  }
  return control.value.trim();
}

function readSingleLineControl(form: HTMLFormElement, name: string) {
  return firstLine(readTextControl(form, name));
}

function readCheckboxControl(form: HTMLFormElement, name: string) {
  const control = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  return Boolean(control?.checked);
}

function setCheckboxControl(form: HTMLFormElement, name: string, value: boolean) {
  const control = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!control) {
    return;
  }
  control.checked = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function isPayloadEqual(a: VisualPayload, b: VisualPayload) {
  return (
    a.placement === b.placement &&
    a.imageUrl === b.imageUrl &&
    a.altText === b.altText &&
    a.eyebrow === b.eyebrow &&
    a.headline === b.headline &&
    a.body === b.body &&
    a.linkHref === b.linkHref &&
    a.linkLabel === b.linkLabel &&
    a.published === b.published
  );
}

function normalizePayload(payload: VisualPayload): VisualPayload {
  return {
    placement: payload.placement,
    imageUrl: firstLine(payload.imageUrl),
    altText: payload.altText.trim(),
    eyebrow: payload.eyebrow.trim(),
    headline: payload.headline.trim(),
    body: payload.body.trim(),
    linkHref: payload.linkHref.trim(),
    linkLabel: payload.linkLabel.trim(),
    published: Boolean(payload.published)
  };
}

function readPayloadFromForm(form: HTMLFormElement): VisualPayload | null {
  const placement = form.getAttribute("data-visual-save-form");
  if (!placement) {
    return null;
  }
  return normalizePayload({
    placement: placement as SiteVisualPlacement,
    imageUrl: readSingleLineControl(form, "imageUrl"),
    altText: readTextControl(form, "altText"),
    eyebrow: readTextControl(form, "eyebrow"),
    headline: readTextControl(form, "headline"),
    body: readTextControl(form, "body"),
    linkHref: readTextControl(form, "linkHref"),
    linkLabel: readTextControl(form, "linkLabel"),
    published: readCheckboxControl(form, "published")
  });
}

function getSaveForms() {
  return Array.from(
    document.querySelectorAll<HTMLFormElement>("form[data-visual-save-form]")
  );
}

export default function AdminVisualBulkActions({ placements, initialPayloads }: Props) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baselineRef = useRef(initialPayloads);
  const bulkInputRef = useRef<HTMLInputElement | null>(null);

  function clearFeedback() {
    setMessage(null);
    setError(null);
  }

  function stageImageFileForPlacement(placement: SiteVisualPlacement, file: File) {
    const detail = {
      name: "imageUrl",
      ownerType: "site_visual" as const,
      ownerId: placement,
      files: [file],
      handled: false
    };
    window.dispatchEvent(new CustomEvent(IMAGE_UPLOAD_FIELD_STAGE_EVENT, { detail }));
    return detail.handled;
  }

  function flushImageFieldForPlacement(placement: SiteVisualPlacement) {
    return new Promise<ImageUploadFieldFlushResult>((resolve, reject) => {
      const detail = {
        name: "imageUrl",
        ownerType: "site_visual" as const,
        ownerId: placement,
        handled: false,
        resolve,
        reject
      };
      window.dispatchEvent(new CustomEvent(IMAGE_UPLOAD_FIELD_FLUSH_EVENT, { detail }));
      if (!detail.handled) {
        reject(new Error("Image field missing"));
      }
    });
  }

  async function flushPendingImageFields(forms: HTMLFormElement[]) {
    const failures: string[] = [];
    let uploadedCount = 0;

    for (const form of forms) {
      const placement = form.getAttribute("data-visual-save-form") as SiteVisualPlacement | null;
      if (!placement) {
        continue;
      }
      try {
        const result = await flushImageFieldForPlacement(placement);
        uploadedCount += result.uploadedCount;
      } catch (flushError) {
        failures.push(
          `${placement}: ${flushError instanceof Error ? flushError.message : "image upload failed"}`
        );
      }
    }

    return {
      failures,
      uploadedCount
    };
  }

  function handleBulkFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.currentTarget.value = "";
    if (files.length === 0 || working) {
      return;
    }

    clearFeedback();
    setWorking(true);

    const mappedByPlacement = new Map<SiteVisualPlacement, File>();
    const unmapped: string[] = [];
    let overwrittenCount = 0;
    for (const file of files) {
      const placement = mapFileToPlacement(file.name, placements);
      if (!placement) {
        unmapped.push(file.name);
        continue;
      }
      if (mappedByPlacement.has(placement)) {
        overwrittenCount += 1;
      }
      mappedByPlacement.set(placement, file);
    }

    if (mappedByPlacement.size === 0) {
      setError("No filenames matched known placements. Use names like home.hero.jpg or shop.banner.png.");
      setWorking(false);
      return;
    }

    let assigned = 0;
    const failed: string[] = [];
    for (const [placement, file] of mappedByPlacement) {
      if (stageImageFileForPlacement(placement, file)) {
        assigned += 1;
      } else {
        failed.push(`${placement} (form missing)`);
      }
    }

    const details: string[] = [];
    details.push(
      `Mapped ${assigned} placement${assigned === 1 ? "" : "s"}. Save All Changes to upload and save.`
    );
    if (overwrittenCount > 0) {
      details.push(`Used the last file for ${overwrittenCount} duplicate placement match${overwrittenCount === 1 ? "" : "es"}.`);
    }
    if (unmapped.length > 0) {
      details.push(`Skipped ${unmapped.length} unmapped file${unmapped.length === 1 ? "" : "s"}.`);
    }
    if (failed.length > 0) {
      setError(`Some files could not be mapped: ${failed.join("; ")}`);
    }
    setMessage(details.join(" "));
    setWorking(false);
  }

  async function saveMany(options: { publishAll: boolean }) {
    if (working) {
      return;
    }
    clearFeedback();
    setWorking(true);

    const forms = getSaveForms();
    setMessage("Preparing images...");

    const imageFlush = await flushPendingImageFields(forms);
    if (imageFlush.failures.length > 0) {
      setError(`Image upload failed: ${imageFlush.failures.join("; ")}`);
      setMessage(null);
      setWorking(false);
      return;
    }
    if (imageFlush.uploadedCount > 0) {
      setMessage(`Uploaded ${imageFlush.uploadedCount} image${imageFlush.uploadedCount === 1 ? "" : "s"}. Saving...`);
    }

    const payloads: VisualPayload[] = [];
    let skippedMissingImage = 0;

    for (const form of forms) {
      const payload = readPayloadFromForm(form);
      if (!payload) {
        continue;
      }

      if (options.publishAll) {
        if (!payload.imageUrl) {
          skippedMissingImage += 1;
          continue;
        }
        payload.published = true;
        setCheckboxControl(form, "published", true);
      }

      const baseline = baselineRef.current[payload.placement];
      if (!baseline || !isPayloadEqual(payload, baseline)) {
        payloads.push(payload);
      }
    }

    if (payloads.length === 0) {
      setMessage(
        options.publishAll
          ? skippedMissingImage > 0
            ? "No publishable changes found. Slots without images were skipped."
            : "Everything is already published and saved."
          : "No unsaved changes found."
      );
      setWorking(false);
      return;
    }

    const failures: string[] = [];
    let savedCount = 0;
    for (const payload of payloads) {
      try {
        const response = await fetch("/api/admin/visuals/save", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) {
          failures.push(`${payload.placement}: ${result?.error || response.statusText || "save failed"}`);
          continue;
        }

        baselineRef.current[payload.placement] = normalizePayload(payload);
        savedCount += 1;
      } catch (saveError) {
        failures.push(
          `${payload.placement}: ${saveError instanceof Error ? saveError.message : "save failed"}`
        );
      }
    }

    const summary = options.publishAll
      ? `Published and saved ${savedCount} placement${savedCount === 1 ? "" : "s"}.`
      : `Saved ${savedCount} placement${savedCount === 1 ? "" : "s"}.`;
    const skippedSummary =
      skippedMissingImage > 0
        ? `Skipped ${skippedMissingImage} placement${skippedMissingImage === 1 ? "" : "s"} without images.`
        : "";

    if (failures.length > 0) {
      setError(failures.join(" "));
    }
    setMessage([summary, skippedSummary].filter(Boolean).join(" "));
    setWorking(false);
  }

  return (
    <section className="border border-neutral-200 p-4 space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold tracking-tight">Bulk Actions</h2>
        <p className="text-xs text-neutral-600">
          Auto-map filenames to placements (`home.hero.jpg`, `shop.banner.png`) and save all updates in one pass.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={bulkInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleBulkFiles}
        />
        <button
          type="button"
          onClick={() => bulkInputRef.current?.click()}
          className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
          disabled={working}
        >
          Upload & Auto-map
        </button>
        <button
          type="button"
          onClick={() => saveMany({ publishAll: false })}
          className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
          disabled={working}
        >
          Save All Changes
        </button>
        <button
          type="button"
          onClick={() => saveMany({ publishAll: true })}
          className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
          disabled={working}
        >
          Publish All With Images
        </button>
      </div>

      {message ? <p className="text-xs text-neutral-600">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
