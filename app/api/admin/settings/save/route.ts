import { NextResponse } from "next/server";

import { recordAdminAuditEvent } from "@/lib/admin-audit";
import { saveAdminSettings, validateAdminSettingsInput } from "@/lib/admin-settings";
import { hasKvEnv } from "@/lib/kv";
import { requireAdminOrThrow } from "@/lib/require-admin";

function parseBoolean(value: FormDataEntryValue | null | undefined) {
  if (!value || typeof value !== "string") {
    return false;
  }
  return value === "on" || value === "true" || value === "1";
}

function wantsJsonResponse(request: Request) {
  return request.headers.get("content-type")?.includes("application/json");
}

async function getPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return null;
    }
    return {
      shippingAllowedCountries: body.shippingAllowedCountries,
      automaticTaxEnabled: Boolean(body.automaticTaxEnabled),
      shippingRateId: body.shippingRateId,
      refundRestockDefault:
        body.refundRestockDefault === undefined ? true : Boolean(body.refundRestockDefault)
    };
  }

  const formData = await request.formData();
  return {
    shippingAllowedCountries: formData.get("shippingAllowedCountries"),
    automaticTaxEnabled: parseBoolean(formData.get("automaticTaxEnabled")),
    shippingRateId: formData.get("shippingRateId"),
    refundRestockDefault: parseBoolean(formData.get("refundRestockDefault"))
  };
}

function redirectWithStatus(request: Request, params: Record<string, string>) {
  const url = new URL("/admin/settings", request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  try {
    await requireAdminOrThrow(request);
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!hasKvEnv()) {
    return NextResponse.json({ ok: false, error: "Missing KV configuration" }, { status: 500 });
  }

  const payload = await getPayload(request);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const validation = validateAdminSettingsInput(payload);
  if (!validation.ok) {
    if (wantsJsonResponse(request)) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }
    return redirectWithStatus(request, {
      error: validation.error
    });
  }

  const settings = await saveAdminSettings(validation.settings);
  await recordAdminAuditEvent({
    action: "settings_saved",
    entity: "settings",
    entityId: "admin-settings",
    summary: "Admin checkout settings saved",
    details: {
      shippingAllowedCountries: settings.checkout.shippingAllowedCountries,
      automaticTaxEnabled: settings.checkout.automaticTaxEnabled,
      shippingRateId: settings.checkout.shippingRateId,
      refundRestockDefault: settings.checkout.refundRestockDefault
    }
  });

  if (wantsJsonResponse(request)) {
    return NextResponse.json({ ok: true, settings });
  }

  return redirectWithStatus(request, {
    saved: "1"
  });
}
