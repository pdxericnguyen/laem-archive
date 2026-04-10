import { Redis } from "@upstash/redis";

type RedisConfig = {
  url: string;
  token: string;
};

let client: Redis | null = null;

export function getRedisEnvConfig(): RedisConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return null;
  }
  return { url, token };
}

function getRedisClient() {
  if (client) {
    return client;
  }

  const config = getRedisEnvConfig();
  if (!config) {
    throw new Error(
      "Missing Redis environment variables. Set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN."
    );
  }

  client = new Redis(config);
  return client;
}

export const kv = new Proxy(
  {},
  {
    get(_target, property) {
      return Reflect.get(getRedisClient(), property);
    }
  }
) as Redis;

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
  return Boolean(getRedisEnvConfig());
}
