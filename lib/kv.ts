import { kv } from "@vercel/kv";

export { kv };

export const key = {
  product: (slug: string) => `product:${slug}`,
  products: "products",
  productsIndex: "products:index",
  stock: (slug: string) => `stock:${slug}`,
  order: (id: string) => `order:${id}`,
  ordersIndex: "orders:index",
  archived: (slug: string) => `archived:${slug}`,
  published: (slug: string) => `published:${slug}`
};

export function hasKvEnv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}
