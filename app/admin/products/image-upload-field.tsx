"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";

type Props = {
  name: string;
  defaultValue?: string;
  label?: string;
  helperText?: string;
  placeholder?: string;
  previewAlt?: string;
  emptyLabel?: string;
  uploadFolder?: "products" | "site-visuals";
  allowMultiple?: boolean;
  aspectClassName?: string;
};

function appendLines(base: string, lines: string[]) {
  const normalized = base.trim();
  const next = lines.filter(Boolean).join("\n");
  if (!normalized) {
    return next;
  }
  if (!next) {
    return normalized;
  }
  return `${normalized}\n${next}`;
}

function firstLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0] || ""
  );
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
  label = "Images (one per line)",
  helperText = "Click the image frame or the plus box to upload directly to Blob.",
  placeholder = "One image URL per line",
  previewAlt = "Image preview",
  emptyLabel = "Upload image",
  uploadFolder = "products",
  allowMultiple = true,
  aspectClassName = "aspect-[4/5]"
}: Props) {
  const [value, setValue] = useState(allowMultiple ? defaultValue : firstLine(defaultValue));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropDepthRef = useRef(0);

  const imageUrls = useMemo(
    () =>
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [value]
  );

  const imageCount = useMemo(
    () => imageUrls.length,
    [imageUrls]
  );

  useEffect(() => {
    if (selectedIndex >= imageUrls.length) {
      setSelectedIndex(Math.max(0, imageUrls.length - 1));
    }
  }, [imageUrls.length, selectedIndex]);

  async function uploadFiles(files: File[]) {
    if (files.length === 0) {
      setError("Select at least one image.");
      setMessage(null);
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const uploadedUrls = await mapWithConcurrency(files, 3, async (file) => {
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
      });

      setValue((current) => (allowMultiple ? appendLines(current, uploadedUrls) : uploadedUrls[0] || current));
      if (imageUrls.length === 0 && uploadedUrls.length > 0) {
        setSelectedIndex(0);
      }
      setMessage(`Uploaded ${uploadedUrls.length} image(s).`);
    } catch (uploadError) {
      const errorMessage = uploadError instanceof Error ? uploadError.message : "Upload failed";
      setError(errorMessage);
    } finally {
      setUploading(false);
    }
  }

  function openPicker() {
    if (uploading) {
      return;
    }
    fileInputRef.current?.click();
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      uploadFiles(files).catch(() => {
        // handled by uploadFiles
      });
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
    uploadFiles(filesToUpload).catch(() => {
      // handled by uploadFiles
    });
  }

  const selectedImageUrl = imageUrls[selectedIndex] || "";
  const normalizedValue = allowMultiple ? value : firstLine(value);

  return (
    <div className="grid gap-2">
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
                {uploading ? "Uploading..." : emptyLabel}
              </div>
            )}
            {isDropActive ? (
              <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-white/85 px-4 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-800">
                Drop image to upload
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-white/90 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-700">
              {uploading ? "Uploading..." : selectedImageUrl ? "Replace / Add Image" : "Add First Image"}
            </div>
          </button>

          <div className="flex items-center gap-2 overflow-x-auto">
            {imageUrls.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                className={`h-16 w-14 shrink-0 overflow-hidden border ${
                  selectedIndex === index ? "border-neutral-700" : "border-neutral-300"
                }`}
                onClick={() => setSelectedIndex(index)}
                title={`Image ${index + 1}`}
              >
                <img src={url} alt={`Image ${index + 1}`} className="h-full w-full object-cover" />
              </button>
            ))}
            <button
              type="button"
              onClick={openPicker}
              className="h-16 w-14 shrink-0 border border-dashed border-neutral-400 text-xs text-neutral-600 hover:bg-neutral-50"
              title="Upload image"
            >
              +
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <textarea
            name={name}
            rows={allowMultiple ? 6 : 3}
            className="border border-neutral-300 p-3"
            value={normalizedValue}
            onChange={(event) => setValue(allowMultiple ? event.target.value : firstLine(event.target.value))}
            placeholder={placeholder}
          />
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
          {uploading ? "Uploading..." : "Upload Image"}
        </button>
        <span className="text-xs text-neutral-500">{imageCount} URL(s)</span>
      </div>

      {message ? <p className="text-xs text-neutral-600">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
