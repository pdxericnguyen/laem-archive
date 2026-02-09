import { kv } from "@vercel/kv";

const products = [
  {
    slug: "silver-band-01",
    title: "Silver Band 01",
    subtitle: "Solid silver, hand-finished.",
    description: "A clean band profile in solid sterling silver with a hand-finished surface.",
    priceCents: 24000,
    stock: 4,
    archived: false,
    published: true,
    autoArchiveOnZero: false,
    images: ["https://via.placeholder.com/1200x1500"],
    materials: "Solid silver (925).",
    dimensions: "Band width: 6mm\nWeight: ~12g",
    care: "Avoid harsh chemicals. Patina is expected.",
    shippingReturns: "Ships in 3-7 days. Returns within 7 days (unworn)."
  },
  {
    slug: "chain-form-02",
    title: "Chain Form 02",
    subtitle: "Hand-assembled links.",
    description: "Hand-assembled linked form built for everyday wear with sculptural weight.",
    priceCents: 31000,
    stock: 0,
    archived: false,
    published: true,
    autoArchiveOnZero: true,
    images: ["https://via.placeholder.com/1200x1500"],
    materials: "Solid silver (925).",
    dimensions: "Length: 18in\nWeight: ~22g",
    care: "Wipe after wear. Store dry.",
    shippingReturns: "Ships in 3-7 days. Returns within 7 days (unworn)."
  },
  {
    slug: "pearl-hook-01",
    title: "Pearl Hook 01",
    subtitle: "Silver + pearl accent.",
    description: "Sterling silver form paired with a pearl accent and light drop profile.",
    priceCents: 28000,
    stock: 0,
    archived: true,
    published: true,
    autoArchiveOnZero: true,
    images: ["https://via.placeholder.com/1200x1500"],
    materials: "Solid silver (925). Pearl accent.",
    dimensions: "Drop: 22mm\nWeight: ~6g",
    care: "Avoid perfumes on pearl. Wipe gently.",
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
    })
  );

  console.log(`Seeded ${products.length} products into KV.`);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
