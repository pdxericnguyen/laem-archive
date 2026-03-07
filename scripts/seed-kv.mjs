import { kv } from "@vercel/kv";

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

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
}

async function seed() {
  requireEnv("KV_REST_API_URL");
  requireEnv("KV_REST_API_TOKEN");

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
