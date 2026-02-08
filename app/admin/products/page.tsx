import { kv } from "@vercel/kv";

import type { Product } from "@/lib/store";
import BulkStockEditor from "./stock-bulk";
import ImageUploadField from "./image-upload-field";

export const dynamic = "force-dynamic";

function hasKvEnv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getProducts(): Promise<Product[]> {
  if (!hasKvEnv()) {
    return [];
  }
  const products = await kv.get<Product[]>("products");
  return Array.isArray(products) ? products : [];
}

export default async function AdminProductsPage() {
  if (!hasKvEnv()) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Admin Products</h1>
        <p className="text-sm text-neutral-600">KV is not configured.</p>
      </main>
    );
  }

  const products = await getProducts();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 space-y-10">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Admin Products</h1>
        <p className="text-sm text-neutral-600">Manage product publishing and stock.</p>
      </header>

      <BulkStockEditor
        rows={products.map((product) => ({
          slug: product.slug,
          title: product.title,
          stock: product.stock
        }))}
      />

      <section className="border border-neutral-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold tracking-tight">Add Product</h2>
        <form action="/api/admin/products/save" method="POST" className="grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Slug</span>
            <input name="slug" required className="h-10 border border-neutral-300 px-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Title</span>
            <input name="title" required className="h-10 border border-neutral-300 px-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Subtitle</span>
            <input name="subtitle" className="h-10 border border-neutral-300 px-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Description</span>
            <textarea name="description" rows={3} className="border border-neutral-300 p-3" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Price (cents)</span>
              <input name="priceCents" type="number" className="h-10 border border-neutral-300 px-3" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Stock</span>
              <input name="stock" type="number" className="h-10 border border-neutral-300 px-3" />
            </label>
          </div>
          <div className="flex gap-4 text-xs uppercase tracking-[0.12em] text-neutral-500">
            <label className="flex items-center gap-2">
              <input name="published" type="checkbox" defaultChecked />
              Published
            </label>
            <label className="flex items-center gap-2">
              <input name="archived" type="checkbox" />
              Archived
            </label>
          </div>
          <ImageUploadField name="images" />
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Materials</span>
            <textarea name="materials" rows={2} className="border border-neutral-300 p-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Dimensions</span>
            <textarea name="dimensions" rows={2} className="border border-neutral-300 p-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Care</span>
            <textarea name="care" rows={2} className="border border-neutral-300 p-3" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Shipping & Returns</span>
            <textarea name="shippingReturns" rows={2} className="border border-neutral-300 p-3" />
          </label>
          <button className="h-11 border border-neutral-300 font-semibold hover:bg-neutral-50">
            Save Product
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-tight">Existing Products</h2>
        {products.length === 0 ? (
          <div className="border border-neutral-200 p-6 text-sm text-neutral-600">
            No products yet.
          </div>
        ) : (
          products.map((product) => (
            <div key={product.slug} className="border border-neutral-200 p-6 space-y-4">
              <form action="/api/admin/products/save" method="POST" className="grid gap-3 text-sm">
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Slug</span>
                  <input
                    name="slug"
                    required
                    className="h-10 border border-neutral-300 px-3"
                    defaultValue={product.slug}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Title</span>
                  <input
                    name="title"
                    required
                    className="h-10 border border-neutral-300 px-3"
                    defaultValue={product.title}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Subtitle</span>
                  <input
                    name="subtitle"
                    className="h-10 border border-neutral-300 px-3"
                    defaultValue={product.subtitle}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Description</span>
                  <textarea
                    name="description"
                    rows={3}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.description}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Price (cents)</span>
                    <input
                      name="priceCents"
                      type="number"
                      className="h-10 border border-neutral-300 px-3"
                      defaultValue={product.priceCents}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Stock</span>
                    <input
                      name="stock"
                      type="number"
                      className="h-10 border border-neutral-300 px-3"
                      defaultValue={product.stock}
                    />
                  </label>
                </div>
                <div className="flex gap-4 text-xs uppercase tracking-[0.12em] text-neutral-500">
                  <label className="flex items-center gap-2">
                    <input name="published" type="checkbox" defaultChecked={product.published} />
                    Published
                  </label>
                  <label className="flex items-center gap-2">
                    <input name="archived" type="checkbox" defaultChecked={product.archived} />
                    Archived
                  </label>
                </div>
                <ImageUploadField name="images" defaultValue={product.images.join("\n")} />
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Materials</span>
                  <textarea
                    name="materials"
                    rows={2}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.materials}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Dimensions</span>
                  <textarea
                    name="dimensions"
                    rows={2}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.dimensions}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Care</span>
                  <textarea
                    name="care"
                    rows={2}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.care}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-neutral-500">Shipping & Returns</span>
                  <textarea
                    name="shippingReturns"
                    rows={2}
                    className="border border-neutral-300 p-3"
                    defaultValue={product.shippingReturns}
                  />
                </label>
                <button className="h-11 border border-neutral-300 font-semibold hover:bg-neutral-50">
                  Update Product
                </button>
              </form>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
