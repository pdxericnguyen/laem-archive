const PRINTNODE_API_BASE = "https://api.printnode.com";

export type PrintNodeContentType = "pdf_uri" | "pdf_base64" | "raw_uri" | "raw_base64";

export type PrintNodeCreateJobInput = {
  printerId: number;
  title: string;
  source: string;
  contentType: PrintNodeContentType;
  content: string;
  options?: Record<string, unknown>;
};

export type PrintNodeCreateJobResult =
  | {
      ok: true;
      jobId: string;
    }
  | {
      ok: false;
      error: string;
    };

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJobId(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.id === "number" && Number.isFinite(row.id)) {
      return String(Math.floor(row.id));
    }
    if (typeof row.id === "string" && row.id.trim()) {
      return row.id.trim();
    }
  }
  return "";
}

function parsePrinterId(value: string | undefined) {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

export function getPrintNodeApiKey() {
  return asString(process.env.PRINTNODE_API_KEY);
}

export function getPrintNodePrinterId(
  envVarName: "PRINTNODE_SLIP_PRINTER_ID" | "PRINTNODE_LABEL_PRINTER_ID"
) {
  return parsePrinterId(process.env[envVarName]);
}

export async function createPrintNodeJob(
  input: PrintNodeCreateJobInput
): Promise<PrintNodeCreateJobResult> {
  const apiKey = getPrintNodeApiKey();
  if (!apiKey) {
    return { ok: false, error: "Missing PRINTNODE_API_KEY." };
  }

  const authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

  let response: Response;
  try {
    response = await fetch(`${PRINTNODE_API_BASE}/printjobs`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        printerId: input.printerId,
        title: input.title,
        source: input.source,
        contentType: input.contentType,
        content: input.content,
        options: input.options || undefined
      })
    });
  } catch (error) {
    return {
      ok: false,
      error: `PrintNode request failed: ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }

  const rawBody = await response.text().catch(() => "");
  let parsed: unknown = rawBody;
  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = rawBody;
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `PrintNode error ${response.status}: ${asString(
        typeof parsed === "string" ? parsed : JSON.stringify(parsed)
      )}`
    };
  }

  const jobId = parseJobId(parsed);
  if (!jobId) {
    return { ok: false, error: "PrintNode accepted request but did not return a job id." };
  }

  return { ok: true, jobId };
}
