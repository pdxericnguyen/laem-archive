import { Redis } from "@upstash/redis";

const products = [
  {
    slug: "silver-necklace-01",
    title: "Silver Necklace 01",
    subtitle: "Sterling silver sample listing.",
    description: "Presentation placeholder for necklace flow.",
    priceCents: 21000,
    stock: 1,
    archived: false,
    published: true,
    autoArchiveOnZero: false,
    images: ["https://via.placeholder.com/1200x1500"],
    materials: "Solid silver (925).",
    dimensions: "Necklace length: TBD",
    care: "Care details pending.",
    shippingReturns: "Ships in 3-7 days. Returns within 7 days (unworn)."
  },
  {
    slug: "silver-ring-01",
    title: "Silver Ring 01",
    subtitle: "Sterling silver sample listing.",
    description: "Presentation placeholder for ring flow.",
    priceCents: 16000,
    stock: 1,
    archived: false,
    published: true,
    autoArchiveOnZero: false,
    images: ["https://via.placeholder.com/1200x1500"],
    materials: "Solid silver (925).",
    dimensions: "Ring size: TBD",
    care: "Care details pending.",
    shippingReturns: "Ships in 3-7 days. Returns within 7 days (unworn)."
  },
  {
    slug: "silver-bangle-01",
    title: "Silver Bangle 01",
    subtitle: "Sterling silver sample listing.",
    description: "Presentation placeholder for bangle flow.",
    priceCents: 19000,
    stock: 1,
    archived: false,
    published: true,
    autoArchiveOnZero: false,
    images: ["https://via.placeholder.com/1200x1500"],
    materials: "Solid silver (925).",
    dimensions: "Inner diameter: TBD",
    care: "Care details pending.",
    shippingReturns: "Ships in 3-7 days. Returns within 7 days (unworn)."
  },
  {
    slug: "silver-earrings-01",
    title: "Silver Earrings 01",
    subtitle: "Sterling silver sample listing.",
    description: "Presentation placeholder for earrings flow.",
    priceCents: 14000,
    stock: 1,
    archived: false,
    published: true,
    autoArchiveOnZero: false,
    images: ["https://via.placeholder.com/1200x1500"],
    materials: "Solid silver (925).",
    dimensions: "Earring drop: TBD",
    care: "Care details pending.",
    shippingReturns: "Ships in 3-7 days. Returns within 7 days (unworn)."
  }
];

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error(
      "Missing Redis credentials. Set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN."
    );
    process.exit(1);
  }
  return { url, token };
}

async function seed() {
  const kv = new Redis(getRedisConfig());

  await kv.set("products", products);

  await Promise.all(
    products.map(async (product) => {
      await kv.set(`product:${product.slug}`, product);
      await kv.set(`stock:${product.slug}`, product.stock);
      await kv.set(`published:${product.slug}`, product.published);
      await kv.set(`archived:${product.slug}`, product.archived);
    })
  );

  await kv.del("products:index");
  await kv.rpush(
    "products:index",
    ...products.map((product) => product.slug)
  );

  console.log(`Seeded ${products.length} products into KV.`);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
