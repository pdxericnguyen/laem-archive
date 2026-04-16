import ProductGallery from "@/app/products/[slug]/gallery";

export const metadata = {
  title: "Gallery Sandbox | LAEM Archive"
};

const TEST_IMAGES = [
  "/placeholder-product.svg?i=1",
  "/placeholder-product.svg?i=2",
  "/placeholder-product.svg?i=3"
];

export default function GallerySandboxPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 space-y-4">
      <h1 className="text-sm uppercase tracking-[0.12em] text-neutral-600">Gallery Interaction Sandbox</h1>
      <ProductGallery title="Gallery test piece" images={TEST_IMAGES} />
    </main>
  );
}
