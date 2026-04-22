#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Redis } from "@upstash/redis";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const confirmed = args.has("--confirm");
const includeVisuals = args.has("--include-visuals");
const skipBackup = args.has("--skip-backup");
const envFileArg = rawArgs.find((arg) => arg.startsWith("--env-file="));
const envFilePath = envFileArg?.slice("--env-file=".length) || (existsSync(".env.local") ? ".env.local" : null);

async function loadEnvFile(filePath) {
  if (!filePath) {
    return;
  }

  const contents = await readFile(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (name && process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

await loadEnvFile(envFilePath);

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.error(
    "Missing Redis env. Set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN."
  );
  process.exit(1);
}

const redis = new Redis({ url, token });

const exactKeys = [
  "products",
  "products:index",
  "orders:index",
  "reservations:expiring",
  "inventory:ledger"
];

const patterns = [
  "product:*",
  "stock:*",
  "reserved:*",
  "reservation:*",
  "order:*",
  "inventory:ledger:*",
  "archived:*",
  "published:*",
  "ratelimit:*"
];

if (includeVisuals) {
  patterns.push("site-visual:*");
}

async function scanPattern(pattern) {
  const keys = [];
  let cursor = "0";

  do {
    const [nextCursor, batch] = await redis.scan(cursor, {
      match: pattern,
      count: 200
    });
    cursor = String(nextCursor);
    for (const key of batch || []) {
      if (typeof key === "string" && key) {
        keys.push(key);
      }
    }
  } while (cursor !== "0");

  return keys;
}

function chunk(values, size) {
  const rows = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size));
  }
  return rows;
}

const existingExactKeys = (
  await Promise.all(
    exactKeys.map(async (key) => {
      const exists = await redis.exists(key);
      return exists ? key : null;
    })
  )
).filter(Boolean);
const scannedKeys = (await Promise.all(patterns.map((pattern) => scanPattern(pattern)))).flat();
const keys = [...new Set([...existingExactKeys, ...scannedKeys])].sort();

console.log("LAEM controlled test-data reset");
console.log(`Mode: ${confirmed ? "CONFIRMED DELETE" : "dry run"}`);
console.log(`Site visuals: ${includeVisuals ? "included" : "preserved"}`);
console.log(`Matched keys: ${keys.length}`);

if (keys.length > 0) {
  console.log("");
  for (const key of keys.slice(0, 40)) {
    console.log(`- ${key}`);
  }
  if (keys.length > 40) {
    console.log(`- ...and ${keys.length - 40} more`);
  }
}

if (!skipBackup) {
  const backupPath = path.join(os.tmpdir(), `laem-reset-key-backup-${Date.now()}.json`);
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        includeVisuals,
        keys
      },
      null,
      2
    )
  );
  console.log("");
  console.log(`Key-list backup written to ${backupPath}`);
}

if (!confirmed) {
  console.log("");
  console.log("Dry run only. Re-run with --confirm to delete the matched keys.");
  console.log("Use --include-visuals only if site visual placements are also fake.");
  process.exit(0);
}

for (const batch of chunk(keys, 100)) {
  await redis.del(...batch);
}

console.log("");
console.log(`Deleted ${keys.length} Redis keys.`);
console.log("Next step: recreate products through /admin/products so each listing gets a new inventoryItemId.");
