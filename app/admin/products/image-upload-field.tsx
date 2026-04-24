"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";

type UrlImageItem = {
  id: string;
  kind: "url";
  url: string;
};

type FileImageItem = {
  id: string;
  kind: "file";
  file: File;
  previewUrl: string;
  previousItems?: UrlImageItem[];
};

type ImageItem = UrlImageItem | FileImageItem;

type ImageOwnerType = "product" | "site_visual";

export const IMAGE_UPLOAD_FIELD_STAGE_EVENT = "laem:image-upload-field:stage";
export const IMAGE_UPLOAD_FIELD_FLUSH_EVENT = "laem:image-upload-field:flush";

export type ImageUploadFieldFlushResult = {
  uploadedCount: number;
  value: string;
};

type ImageUploadFieldTarget = {
  name: string;
  ownerId?: string;
  ownerType?: ImageOwnerType;
};

type ImageUploadFieldStageDetail = ImageUploadFieldTarget & {
  files: File[];
  handled?: boolean;
};

type ImageUploadFieldFlushDetail = ImageUploadFieldTarget & {
  handled?: boolean;
  resolve?: (result: ImageUploadFieldFlushResult) => void;
  reject?: (error: unknown) => void;
};

type Props = {
  name: string;
  defaultValue?: string;
  ownerId?: string;
  ownerType?: ImageOwnerType;
  label?: string;
  helperText?: string;
  placeholder?: string;
  previewAlt?: string;
  emptyLabel?: string;
  uploadFolder?: "products" | "site-visuals";
  allowMultiple?: boolean;
  aspectClassName?: string;
};

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0] || ""
  );
}

function serializeImageUrls(urls: string[], allowMultiple: boolean) {
  const nextUrls = allowMultiple ? urls : urls.slice(0, 1);
  return nextUrls
    .map((url) => url.trim())
    .filter(Boolean)
    .join("\n");
}

function parseImageUrls(value: string, allowMultiple: boolean) {
  const urls = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return allowMultiple ? urls : urls.slice(0, 1);
}

function createUrlItems(value: string, allowMultiple: boolean) {
  return parseImageUrls(value, allowMultiple).map((url, index) => ({
    id: `url-${index}-${url}`,
    kind: "url" as const,
    url
  }));
}

function getItemPreviewUrl(item: ImageItem) {
  return item.kind === "file" ? item.previewUrl : item.url;
}

function getItemLabel(item: ImageItem) {
  return item.kind === "file" ? item.file.name : item.url;
}

function isFileItem(item: ImageItem): item is FileImageItem {
  return item.kind === "file";
}

function setTextControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(control);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(control, value);
  } else {
    control.value = value;
  }
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

function isLikelyImageFile(file: File) {
  if (file.type.startsWith("image/")) {
    return true;
  }
  return /\.(avif|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(file.name);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    })
  );

  return results;
}

export default function ImageUploadField({
  name,
  defaultValue = "",
  ownerId,
  ownerType,
  label = "Images",
  helperText = "Drag photos to reorder. Save product to apply changes.",
  placeholder = "Paste image URLs, one per line",
  previewAlt = "Image preview",
  emptyLabel = "Add image",
  uploadFolder = "products",
  allowMultiple = true,
  aspectClassName = "aspect-[4/5]"
}: Props) {
  const [imageItems, setImageItems] = useState<ImageItem[]>(() => createUrlItems(defaultValue, allowMultiple));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingInputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const latestItemsRef = useRef<ImageItem[]>([]);
  const skipNextSubmitInterceptRef = useRef(false);
  const pendingIdRef = useRef(0);
  const dropDepthRef = useRef(0);
  const reorderDragIndexRef = useRef<number | null>(null);

  const imageUrls = useMemo(
    () => imageItems.filter((item) => item.kind === "url").map((item) => item.url),
    [imageItems]
  );

  const imageCount = useMemo(
    () => imageItems.length,
    [imageItems.length]
  );
  const pendingCount = useMemo(
    () => imageItems.filter(isFileItem).length,
    [imageItems]
  );
  const pendingSignature = useMemo(
    () =>
      imageItems
        .filter(isFileItem)
        .map((item) => `${item.id}:${item.file.name}:${item.file.size}`)
        .join("|"),
    [imageItems]
  );
  const normalizedValue = useMemo(
    () => serializeImageUrls(imageUrls, allowMultiple),
    [allowMultiple, imageUrls]
  );

  useEffect(() => {
    if (selectedIndex >= imageItems.length) {
      setSelectedIndex(Math.max(0, imageItems.length - 1));
    }
  }, [imageItems.length, selectedIndex]);

  useEffect(() => {
    pendingInputRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [normalizedValue, pendingSignature]);

  useEffect(() => {
    latestItemsRef.current = imageItems;
  }, [imageItems]);

  useEffect(() => {
    return () => {
      for (const item of latestItemsRef.current) {
        if (item.kind === "file") {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    };
  }, []);

  async function uploadFileToBlob(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", uploadFolder);

    const response = await fetch("/api/admin/blob/upload", {
      method: "POST",
      body: formData
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || typeof payload.url !== "string") {
      throw new Error(payload?.error || "Upload failed");
    }

    return payload.url as string;
  }

  function stageFiles(files: File[]) {
    if (files.length === 0) {
      setError("Select at least one image.");
      setMessage(null);
      return;
    }

    setError(null);
    const stagedItems = files.map((file) => {
      pendingIdRef.current += 1;
      return {
        id: `file-${Date.now()}-${pendingIdRef.current}-${file.name}`,
        kind: "file" as const,
        file,
        previewUrl: URL.createObjectURL(file)
      };
    });

    setImageItems((current) => {
      if (allowMultiple) {
        return [...current, ...stagedItems];
      }
      const previousItems = current.flatMap((item) => {
        if (item.kind === "url") {
          return [item];
        }
        return item.previousItems || [];
      });
      for (const item of current) {
        if (item.kind === "file") {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
      return stagedItems.slice(0, 1).map((item) => ({
        ...item,
        previousItems
      }));
    });
    setSelectedIndex((current) => (allowMultiple ? imageItems.length || current : 0));
    setMessage(`${stagedItems.length} image${stagedItems.length === 1 ? "" : "s"} added. Save to finish.`);
  }

  async function uploadPendingItems(items: ImageItem[]) {
    const uploadSlots = items
      .map((item, index) => ({ item, index }))
      .filter((entry): entry is { item: Extract<ImageItem, { kind: "file" }>; index: number } =>
        entry.item.kind === "file"
      );
    if (uploadSlots.length === 0) {
      return items;
    }

    const uploadedUrls = await mapWithConcurrency(uploadSlots, 3, async ({ item }) =>
      uploadFileToBlob(item.file)
    );
    const nextItems = [...items];
    uploadSlots.forEach(({ item, index }, uploadIndex) => {
      URL.revokeObjectURL(item.previewUrl);
      nextItems[index] = {
        id: `url-${Date.now()}-${uploadIndex}-${uploadedUrls[uploadIndex]}`,
        kind: "url",
        url: uploadedUrls[uploadIndex]
      };
    });
    return nextItems;
  }

  function matchesFieldTarget(detail: ImageUploadFieldTarget) {
    if (detail.name !== name) {
      return false;
    }
    if (detail.ownerType && detail.ownerType !== ownerType) {
      return false;
    }
    if (detail.ownerId && detail.ownerId !== ownerId) {
      return false;
    }
    return true;
  }

  async function flushPendingImages() {
    const currentItems = latestItemsRef.current;
    const uploadedCount = currentItems.filter(isFileItem).length;
    if (uploadedCount === 0) {
      return {
        uploadedCount: 0,
        value: serializeImageUrls(imageUrls, allowMultiple)
      };
    }

    setUploading(true);
    setError(null);
    setMessage("Preparing images...");

    const nextItems = await uploadPendingItems(currentItems);
    const nextValue = serializeImageUrls(
      nextItems
        .filter((item): item is Extract<ImageItem, { kind: "url" }> => item.kind === "url")
        .map((item) => item.url),
      allowMultiple
    );

    latestItemsRef.current = nextItems;
    setImageItems(nextItems);
    if (textareaRef.current) {
      setTextControlValue(textareaRef.current, nextValue);
    }

    return {
      uploadedCount,
      value: nextValue
    };
  }

  useEffect(() => {
    function onStage(event: Event) {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      const detail = event.detail as ImageUploadFieldStageDetail | null;
      if (!detail || !matchesFieldTarget(detail) || !Array.isArray(detail.files)) {
        return;
      }
      const imageFiles = detail.files.filter((file) => isLikelyImageFile(file));
      if (imageFiles.length === 0) {
        setError("Choose image files only.");
        setMessage(null);
        detail.handled = true;
        return;
      }
      stageFiles(allowMultiple ? imageFiles : imageFiles.slice(0, 1));
      detail.handled = true;
    }

    function onFlush(event: Event) {
      if (!(event instanceof CustomEvent)) {
        return;
      }
      const detail = event.detail as ImageUploadFieldFlushDetail | null;
      if (!detail || !matchesFieldTarget(detail)) {
        return;
      }
      detail.handled = true;
      flushPendingImages()
        .then((result) => {
          setMessage(result.uploadedCount > 0 ? "Images ready." : message);
          setUploading(false);
          detail.resolve?.(result);
        })
        .catch((flushError) => {
          const errorMessage = flushError instanceof Error ? flushError.message : "Upload failed";
          setError(errorMessage);
          setMessage(null);
          setUploading(false);
          detail.reject?.(flushError);
        });
    }

    window.addEventListener(IMAGE_UPLOAD_FIELD_STAGE_EVENT, onStage);
    window.addEventListener(IMAGE_UPLOAD_FIELD_FLUSH_EVENT, onFlush);
    return () => {
      window.removeEventListener(IMAGE_UPLOAD_FIELD_STAGE_EVENT, onStage);
      window.removeEventListener(IMAGE_UPLOAD_FIELD_FLUSH_EVENT, onFlush);
    };
  }, [allowMultiple, imageUrls, message, name, ownerId, ownerType]);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const formElement = form;

    async function onSubmit(event: SubmitEvent) {
      if (skipNextSubmitInterceptRef.current) {
        skipNextSubmitInterceptRef.current = false;
        return;
      }

      const currentItems = latestItemsRef.current;
      if (!currentItems.some((item) => item.kind === "file")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setUploading(true);
      setError(null);

      try {
        await flushPendingImages();
        setMessage("Saving product...");
        skipNextSubmitInterceptRef.current = true;
        window.setTimeout(() => {
          const submitter = event.submitter;
          if (
            submitter instanceof HTMLButtonElement ||
            submitter instanceof HTMLInputElement
          ) {
            formElement.requestSubmit(submitter);
          } else {
            formElement.requestSubmit();
          }
        }, 0);
      } catch (uploadError) {
        const errorMessage = uploadError instanceof Error ? uploadError.message : "Upload failed";
        setError(errorMessage);
        setMessage(null);
        setUploading(false);
      }
    }

    formElement.addEventListener("submit", onSubmit, true);
    return () => {
      formElement.removeEventListener("submit", onSubmit, true);
    };
  }, [allowMultiple, uploadFolder]);

  function openPicker() {
    if (uploading) {
      return;
    }
    fileInputRef.current?.click();
  }

  function updateImageItems(nextItems: ImageItem[], nextSelectedIndex = selectedIndex) {
    setImageItems(nextItems);
    setSelectedIndex(Math.max(0, Math.min(nextSelectedIndex, nextItems.length - 1)));
  }

  function handleUrlTextChange(nextValue: string) {
    setImageItems((current) => {
      const nextUrlItems = createUrlItems(
        allowMultiple ? nextValue : firstLine(nextValue),
        allowMultiple
      );
      if (allowMultiple) {
        return [...nextUrlItems, ...current.filter(isFileItem)];
      }
      for (const item of current) {
        if (item.kind === "file") {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
      return nextUrlItems.slice(0, 1);
    });
    setSelectedIndex(0);
  }

  function removeImage(index: number) {
    if (index < 0 || index >= imageItems.length) {
      return;
    }
    const item = imageItems[index];
    if (item?.kind === "file") {
      URL.revokeObjectURL(item.previewUrl);
      if (!allowMultiple && item.previousItems && item.previousItems.length > 0) {
        updateImageItems(item.previousItems, 0);
        setMessage("New image removed. Previous image restored.");
        setError(null);
        return;
      }
    }
    const nextItems = imageItems.filter((_, currentIndex) => currentIndex !== index);
    updateImageItems(nextItems, index >= nextItems.length ? nextItems.length - 1 : index);
    setMessage(
      item?.kind === "file"
        ? "New image removed."
        : "Image removed from this listing. Save to publish the change."
    );
    setError(null);
  }

  function reorderImage(index: number, targetIndex: number) {
    if (
      index < 0 ||
      targetIndex < 0 ||
      index >= imageItems.length ||
      targetIndex >= imageItems.length ||
      index === targetIndex
    ) {
      return;
    }
    const nextItems = [...imageItems];
    const [movedItem] = nextItems.splice(index, 1);
    nextItems.splice(targetIndex, 0, movedItem);
    updateImageItems(nextItems, targetIndex);
    setMessage("Image order updated. Save to publish the change.");
    setError(null);
  }

  function moveImage(index: number, direction: -1 | 1) {
    reorderImage(index, index + direction);
  }

  function setAsPrimary(index: number) {
    if (!allowMultiple || index <= 0 || index >= imageItems.length) {
      return;
    }
    const nextItems = [...imageItems];
    const [primaryItem] = nextItems.splice(index, 1);
    nextItems.unshift(primaryItem);
    updateImageItems(nextItems, 0);
    setMessage("Primary image updated. Save to publish the change.");
    setError(null);
  }

  function handleThumbnailDragStart(event: DragEvent<HTMLDivElement>, index: number) {
    if (!allowMultiple || imageItems.length <= 1 || uploading) {
      return;
    }
    event.stopPropagation();
    reorderDragIndexRef.current = index;
    setDraggingIndex(index);
    setDragOverIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function handleThumbnailDragOver(event: DragEvent<HTMLDivElement>, index: number) {
    if (reorderDragIndexRef.current === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  }

  function handleThumbnailDrop(event: DragEvent<HTMLDivElement>, index: number) {
    const sourceIndex = reorderDragIndexRef.current;
    if (sourceIndex === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    reorderDragIndexRef.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
    reorderImage(sourceIndex, index);
  }

  function handleThumbnailDragEnd() {
    reorderDragIndexRef.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      stageFiles(allowMultiple ? files : files.slice(0, 1));
    }
    event.currentTarget.value = "";
  }

  function hasFileTransfer(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types || []).includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (uploading || !hasFileTransfer(event)) {
      return;
    }
    event.preventDefault();
    dropDepthRef.current += 1;
    setIsDropActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (uploading || !hasFileTransfer(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (uploading || !hasFileTransfer(event)) {
      return;
    }
    event.preventDefault();
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) {
      setIsDropActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (uploading || !hasFileTransfer(event)) {
      return;
    }
    event.preventDefault();
    dropDepthRef.current = 0;
    setIsDropActive(false);

    const droppedFiles = Array.from(event.dataTransfer.files || []);
    const imageFiles = droppedFiles.filter((file) => isLikelyImageFile(file));
    if (imageFiles.length === 0) {
      setError("Drop image files only.");
      setMessage(null);
      return;
    }

    const filesToUpload = allowMultiple ? imageFiles : imageFiles.slice(0, 1);
    stageFiles(filesToUpload);
  }

  const selectedImageItem = imageItems[selectedIndex] || null;
  const selectedImageUrl = selectedImageItem ? getItemPreviewUrl(selectedImageItem) : "";

  return (
    <div ref={rootRef} className="grid gap-2">
      <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">
        {label}
      </span>

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <div
          className="space-y-2"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <button
            type="button"
            onClick={openPicker}
            disabled={uploading}
            className={`group relative block w-full overflow-hidden border bg-neutral-50 hover:bg-neutral-100 ${
              isDropActive ? "border-neutral-800 ring-1 ring-neutral-300" : "border-neutral-300"
            } ${aspectClassName}`}
          >
            {selectedImageUrl ? (
              <img
                src={selectedImageUrl}
                alt={previewAlt}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-neutral-500">
                {uploading ? "Saving..." : emptyLabel}
              </div>
            )}
            {isDropActive ? (
              <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-white/85 px-4 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-800">
                Drop image to upload
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-700">
              {uploading ? "Saving..." : selectedImageUrl ? "Add / Replace Image" : "Add First Image"}
            </div>
          </button>

          <div className="flex items-center gap-2 overflow-x-auto">
            {imageItems.map((item, index) => {
              const previewUrl = getItemPreviewUrl(item);
              const itemLabel = getItemLabel(item);
              return (
                <div
                  key={item.id}
                  draggable={allowMultiple && imageItems.length > 1 && !uploading}
                  onDragStart={(event) => handleThumbnailDragStart(event, index)}
                  onDragOver={(event) => handleThumbnailDragOver(event, index)}
                  onDrop={(event) => handleThumbnailDrop(event, index)}
                  onDragEnd={handleThumbnailDragEnd}
                  className={`grid shrink-0 gap-1 ${
                    draggingIndex === index ? "opacity-50" : ""
                  }`}
                >
                  <button
                    type="button"
                    className={`relative h-16 w-14 overflow-hidden border ${
                      selectedIndex === index
                        ? "border-neutral-700"
                        : dragOverIndex === index
                          ? "border-neutral-700 ring-1 ring-neutral-300"
                          : "border-neutral-300"
                    }`}
                    onClick={() => setSelectedIndex(index)}
                    title={`Image ${index + 1}: ${itemLabel}`}
                  >
                    <img src={previewUrl} alt={`Image ${index + 1}`} className="h-full w-full object-cover" />
                    <span className="absolute left-1 top-1 bg-white/90 px-1 text-[9px] font-semibold text-neutral-700">
                      {index === 0 ? "First" : index + 1}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="h-6 border border-neutral-300 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-50"
                    onClick={() => removeImage(index)}
                    title={`Remove image ${index + 1} from this listing`}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={openPicker}
              className="h-16 w-14 shrink-0 border border-dashed border-neutral-400 text-xs text-neutral-600 hover:bg-neutral-50"
              title="Upload image"
            >
              +
            </button>
          </div>

          {selectedImageUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="h-8 border border-neutral-300 px-2 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                onClick={() => moveImage(selectedIndex, -1)}
                disabled={!allowMultiple || selectedIndex <= 0}
              >
                Move Left
              </button>
              <button
                type="button"
                className="h-8 border border-neutral-300 px-2 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                onClick={() => moveImage(selectedIndex, 1)}
                disabled={!allowMultiple || selectedIndex >= imageItems.length - 1}
              >
                Move Right
              </button>
              <button
                type="button"
                className="h-8 border border-neutral-300 px-2 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
                onClick={() => setAsPrimary(selectedIndex)}
                disabled={!allowMultiple || selectedIndex <= 0}
              >
                Set First
              </button>
              <button
                type="button"
                className="h-8 border border-red-300 px-2 text-[11px] font-semibold text-red-700 hover:bg-red-50"
                onClick={() => removeImage(selectedIndex)}
              >
                Remove Selected
              </button>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <input
            ref={pendingInputRef}
            type="hidden"
            name={`_${name}PendingUploads`}
            value={pendingSignature}
            readOnly
          />
          <details className="border border-neutral-200 p-3">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
              Paste Image URLs
            </summary>
            <textarea
              ref={textareaRef}
              name={name}
              rows={allowMultiple ? 6 : 3}
              className="mt-3 w-full border border-neutral-300 p-3 text-sm"
              value={normalizedValue}
              onChange={(event) => handleUrlTextChange(event.target.value)}
              placeholder={placeholder}
            />
            <p className="mt-2 text-[11px] text-neutral-500">
              Optional for images already hosted somewhere else.
            </p>
          </details>
          <p className="text-[11px] text-neutral-500">
            {helperText}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={allowMultiple}
          onChange={onFileInputChange}
          className="hidden"
        />
        <button
          type="button"
          className="h-9 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-50"
          disabled={uploading}
          onClick={openPicker}
        >
          {uploading ? "Saving..." : "Add Images"}
        </button>
        <span className="text-xs text-neutral-500">
          {imageCount} image{imageCount === 1 ? "" : "s"}
          {pendingCount > 0 ? `, ${pendingCount} new` : ""}
        </span>
      </div>

      {message ? <p className="text-xs text-neutral-600">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
