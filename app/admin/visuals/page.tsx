import AdminVisualBulkActions from "./bulk-actions";
import ImageUploadField from "@/app/admin/products/image-upload-field";
import { hasKvEnv } from "@/lib/kv";
import AdminCommandPalette from "../command-palette";
import AdminSystemHealthBanner from "../system-health-banner";
import UnsavedChangesGuard from "../unsaved-changes-guard";
import {
  getSiteVisualsForAdmin,
  SITE_VISUAL_PLACEMENTS,
  type SiteVisual,
  type SiteVisualPlacement
} from "@/lib/site-visuals";

export const metadata = { title: "Site Visuals | LAEM Archive" };
export const dynamic = "force-dynamic";

type AdminVisualsPageProps = {
  searchParams?: Promise<{
    saved?: string;
    deleted?: string;
    visualError?: string;
    placement?: string;
  }>;
};

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

function getMessage(searchParams: Awaited<NonNullable<AdminVisualsPageProps["searchParams"]>> | undefined) {
  if (searchParams?.visualError === "missing_image") {
    return {
      kind: "error" as const,
      text: `Add an image before publishing ${searchParams.placement || "that visual"}.`
    };
  }
  if (searchParams?.saved) {
    return {
      kind: "success" as const,
      text: `${searchParams.saved} saved.`
    };
  }
  if (searchParams?.deleted) {
    return {
      kind: "success" as const,
      text: `${searchParams.deleted} cleared.`
    };
  }
  return null;
}

function formatUpdatedAt(value: number | undefined) {
  if (!value) {
    return "Not saved yet";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildInitialPayload(placement: SiteVisualPlacement, visual: SiteVisual | null): VisualPayload {
  return {
    placement,
    imageUrl: visual?.imageUrl || "",
    altText: visual?.altText || "",
    eyebrow: visual?.eyebrow || "",
    headline: visual?.headline || "",
    body: visual?.body || "",
    linkHref: visual?.linkHref || "",
    linkLabel: visual?.linkLabel || "",
    published: Boolean(visual?.published)
  };
}

export default async function AdminVisualsPage({ searchParams }: AdminVisualsPageProps) {
  if (!hasKvEnv()) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 space-y-4">
        <AdminSystemHealthBanner />
        <h1 className="text-lg font-semibold tracking-tight">Site Visuals</h1>
        <AdminCommandPalette />
        <p className="text-sm text-neutral-600">Redis is not configured.</p>
      </main>
    );
  }

  const visualsByPlacement = await getSiteVisualsForAdmin();
  const resolvedSearchParams = await searchParams;
  const message = getMessage(resolvedSearchParams);
  const initialPayloads = Object.fromEntries(
    SITE_VISUAL_PLACEMENTS.map((definition) => [
      definition.placement,
      buildInitialPayload(definition.placement, visualsByPlacement[definition.placement as SiteVisualPlacement])
    ])
  ) as Record<SiteVisualPlacement, VisualPayload>;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <AdminSystemHealthBanner />
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Site Visuals</h1>
          <a
            href="/admin"
            className="inline-flex h-10 items-center border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-700 no-underline hover:bg-neutral-50"
          >
            Back to Admin
          </a>
        </div>
        <p className="max-w-2xl text-sm text-neutral-600">
          Manage fixed ad and campaign image locations across the public site. Publish a slot only when it has an image.
        </p>
      </header>
      <AdminCommandPalette />
      <UnsavedChangesGuard selector='form[action="/api/admin/visuals/save"]' />

      {message ? (
        <div
          className={`border p-3 text-sm ${
            message.kind === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-neutral-200 bg-neutral-50 text-neutral-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <AdminVisualBulkActions
        placements={SITE_VISUAL_PLACEMENTS.map((definition) => definition.placement)}
        initialPayloads={initialPayloads}
      />

      <section className="grid gap-6">
        {SITE_VISUAL_PLACEMENTS.map((definition) => {
          const visual = visualsByPlacement[definition.placement as SiteVisualPlacement];
          const isPublished = Boolean(visual?.published);
          const hasImage = Boolean(visual?.imageUrl);

          return (
            <article key={definition.placement} className="border border-neutral-200 p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 pb-4">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold tracking-tight">{definition.label}</h2>
                  <p className="text-xs text-neutral-600">{definition.description}</p>
                  <p className="font-mono text-[11px] text-neutral-500">{definition.placement}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em]">
                  <span
                    className={`border px-2.5 py-1 ${
                      isPublished && hasImage
                        ? "border-green-200 bg-green-50 text-green-700"
                        : "border-neutral-200 bg-neutral-50 text-neutral-500"
                    }`}
                  >
                    {isPublished && hasImage ? "Published" : "Hidden"}
                  </span>
                  <span className="border border-neutral-200 px-2.5 py-1 text-neutral-500">
                    {formatUpdatedAt(visual?.updatedAt)}
                  </span>
                </div>
              </div>

              <form
                action="/api/admin/visuals/save"
                method="POST"
                className="grid gap-4 text-sm"
                data-visual-save-form={definition.placement}
              >
                <input type="hidden" name="placement" value={definition.placement} />

                <ImageUploadField
                  name="imageUrl"
                  defaultValue={visual?.imageUrl || ""}
                  ownerType="site_visual"
                  ownerId={definition.placement}
                  label="Visual Image"
                  helperText="Add one image for this placement. Save to apply the change."
                  placeholder="Image URL"
                  previewAlt={`${definition.label} preview`}
                  emptyLabel="Upload visual"
                  uploadFolder="site-visuals"
                  allowMultiple={false}
                  aspectClassName="aspect-[16/9]"
                />

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Eyebrow</span>
                    <input
                      name="eyebrow"
                      className="h-10 border border-neutral-300 px-3"
                      defaultValue={visual?.eyebrow || ""}
                      placeholder="New objects"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Alt Text</span>
                    <input
                      name="altText"
                      className="h-10 border border-neutral-300 px-3"
                      defaultValue={visual?.altText || ""}
                      placeholder="Describe the image"
                    />
                  </label>
                </div>

                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Headline</span>
                  <input
                    name="headline"
                    className="h-10 border border-neutral-300 px-3"
                    defaultValue={visual?.headline || ""}
                    placeholder="Campaign headline"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Body</span>
                  <textarea
                    name="body"
                    rows={3}
                    className="border border-neutral-300 p-3"
                    defaultValue={visual?.body || ""}
                    placeholder="Optional supporting copy"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Link URL</span>
                    <input
                      name="linkHref"
                      className="h-10 border border-neutral-300 px-3"
                      defaultValue={visual?.linkHref || ""}
                      placeholder="/shop"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Link Label</span>
                    <input
                      name="linkLabel"
                      className="h-10 border border-neutral-300 px-3"
                      defaultValue={visual?.linkLabel || ""}
                      placeholder="Shop now"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-4">
                  <label className="inline-flex h-10 items-center gap-2 border border-neutral-300 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-600">
                    <input name="published" type="checkbox" defaultChecked={isPublished} />
                    Published
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    <button className="h-10 px-3 border border-neutral-300 text-xs font-semibold hover:bg-neutral-50">
                      Save Visual
                    </button>
                  </div>
                </div>
              </form>

              <form action="/api/admin/visuals/delete" method="POST" className="border-t border-neutral-200 pt-4">
                <input type="hidden" name="placement" value={definition.placement} />
                <button
                  className="h-10 px-3 border border-red-300 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400 disabled:hover:bg-transparent"
                  disabled={!visual}
                >
                  Clear Slot
                </button>
              </form>
            </article>
          );
        })}
      </section>
    </main>
  );
}
