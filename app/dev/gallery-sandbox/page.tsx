import ProductGallery from "@/app/products/[slug]/gallery";

export const metadata = {
  title: "Gallery Sandbox | LAEM Archive"
};

type Props = {
  searchParams?: {
    images?: string;
  };
};

function getImageCount(value?: string) {
  const requestedCount = Number(value);
  if (!Number.isFinite(requestedCount)) {
    return 3;
  }

  return Math.max(1, Math.min(12, Math.floor(requestedCount)));
}

export default function GallerySandboxPage({ searchParams }: Props) {
  const imageCount = getImageCount(searchParams?.images);
  const testImages = Array.from({ length: imageCount }, (_, index) => `/placeholder-product.svg?i=${index + 1}`);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 space-y-4">
      <h1 className="text-sm uppercase tracking-[0.12em] text-neutral-600">Gallery Interaction Sandbox</h1>
      <ProductGallery title="Gallery test piece" images={testImages} />
    </main>
  );
}
