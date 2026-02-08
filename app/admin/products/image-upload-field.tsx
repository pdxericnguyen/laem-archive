"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

type Props = {
  name: string;
  defaultValue?: string;
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

export default function ImageUploadField({ name, defaultValue = "" }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/admin/blob/upload", {
          method: "POST",
          body: formData
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || typeof payload.url !== "string") {
          throw new Error(payload?.error || "Upload failed");
        }

        uploadedUrls.push(payload.url);
      }

      setValue((current) => appendLines(current, uploadedUrls));
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

  const selectedImageUrl = imageUrls[selectedIndex] || "";

  return (
    <div className="grid gap-2">
      <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">
        Images (one per line)
      </span>

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          <button
            type="button"
            onClick={openPicker}
            className="group relative block w-full overflow-hidden border border-neutral-300 bg-neutral-50 aspect-[4/5] hover:bg-neutral-100"
          >
            {selectedImageUrl ? (
              <img
                src={selectedImageUrl}
                alt="Product preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-neutral-500">
                {uploading ? "Uploading..." : "Upload image"}
              </div>
            )}
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
            rows={6}
            className="border border-neutral-300 p-3"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="One image URL per line"
          />
          <p className="text-[11px] text-neutral-500">
            Click the image frame or the plus box to upload directly to Blob.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
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
