import fs from "node:fs";
import path from "node:path";

const requiredVars = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SITE_URL",
  "ADMIN_TOKEN",
  "ADMIN_SESSION_SECRET",
  "RESEND_API_KEY",
  "BLOB_READ_WRITE_TOKEN"
];

const requiredAnyOf = [
  ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"],
  ["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"]
];

const optionalVars = [
  "INVENTORY_ALERT_EMAIL",
  "ADMIN_ALERT_EMAIL",
  "LOW_STOCK_THRESHOLD",
  "RATE_LIMIT_LOGIN_MAX",
  "RATE_LIMIT_LOGIN_WINDOW_SECONDS",
  "RATE_LIMIT_CHECKOUT_MAX",
  "RATE_LIMIT_CHECKOUT_WINDOW_SECONDS"
];

function isSet(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseArgs(argv) {
  let filePath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      filePath = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--help") {
      console.log("Usage: node scripts/env-audit.mjs [--file .env.local]");
      process.exit(0);
    }
  }
  return { filePath };
}

function parseEnvFile(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Env file not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  const out = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalIndex = line.indexOf("=");
    if (equalIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

function loadEnv() {
  const { filePath } = parseArgs(process.argv.slice(2));
  if (!filePath) {
    return { ...process.env };
  }

  const parsed = parseEnvFile(filePath);
  return { ...process.env, ...parsed };
}

function main() {
  const env = loadEnv();
  const missingRequired = requiredVars.filter((name) => !isSet(env[name]));
  for (const names of requiredAnyOf) {
    if (!names.some((name) => isSet(env[name]))) {
      missingRequired.push(names.join(" or "));
    }
  }
  const hasSender = isSet(env.EMAIL_FROM) || isSet(env.RESEND_FROM);

  const warnings = [];
  if (!hasSender) {
    missingRequired.push("EMAIL_FROM or RESEND_FROM (set at least one)");
  }
  if (isSet(env.SITE_URL) && !String(env.SITE_URL).startsWith("https://")) {
    warnings.push("SITE_URL should be an https URL in production.");
  }
  if (isSet(env.STRIPE_SECRET_KEY) && String(env.STRIPE_SECRET_KEY).startsWith("sk_test_")) {
    warnings.push("STRIPE_SECRET_KEY is a test key; use a live key for production.");
  }
  if (
    isSet(env.STRIPE_WEBHOOK_SECRET) &&
    String(env.STRIPE_WEBHOOK_SECRET).startsWith("whsec_") === false
  ) {
    warnings.push("STRIPE_WEBHOOK_SECRET does not look like a Stripe webhook secret.");
  }

  console.log("Environment audit");
  console.log(`Required variables checked: ${requiredVars.length + requiredAnyOf.length + 1}`);
  console.log(`Optional variables checked: ${optionalVars.length}`);

  if (missingRequired.length > 0) {
    console.log("");
    console.log("Missing required variables:");
    for (const name of missingRequired) {
      console.log(`- ${name}`);
    }
  } else {
    console.log("");
    console.log("Required variables: OK");
  }

  const missingOptional = optionalVars.filter((name) => !isSet(env[name]));
  if (missingOptional.length > 0) {
    console.log("");
    console.log("Optional variables not set:");
    for (const name of missingOptional) {
      console.log(`- ${name}`);
    }
  }

  if (warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }

  process.exit(missingRequired.length > 0 ? 1 : 0);
}

main();
