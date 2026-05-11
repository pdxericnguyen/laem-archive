import type { OrderRecord } from "@/lib/orders";
import { formatUnixInLaemTime } from "@/lib/laem-time";

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [""];
  }
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
      continue;
    }
    lines.push(word.slice(0, maxChars));
    current = word.slice(maxChars);
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function renderPdfTextStream(lines: string[]) {
  const wrapped = lines.flatMap((line) => wrapLine(line, 92));
  const maxLines = 48;
  const clipped =
    wrapped.length > maxLines ? [...wrapped.slice(0, maxLines - 1), "... (truncated)"] : wrapped;
  const escaped = clipped.map((line) => `(${escapePdfText(line)}) Tj`);

  const parts = ["BT", "/F1 11 Tf", "50 760 Td"];
  for (let index = 0; index < escaped.length; index += 1) {
    if (index > 0) {
      parts.push("0 -14 Td");
    }
    parts.push(escaped[index]);
  }
  parts.push("ET");

  return parts.join("\n");
}

function buildSinglePagePdf(contentStream: string) {
  const objects: string[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
  );
  objects.push(`<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(output, "utf8");
}

function formatDate(unix: number) {
  return formatUnixInLaemTime(unix);
}

function buildShippingAddressLines(order: OrderRecord) {
  const address = order.shippingAddress;
  if (!address?.line1) {
    return ["No shipping address recorded."];
  }

  const locality = [address.city, address.state, address.postalCode].filter(Boolean).join(", ");
  return [
    address.name || "",
    address.line1,
    address.line2 || "",
    locality,
    address.country || "",
    address.phone ? `Phone: ${address.phone}` : ""
  ].filter(Boolean);
}

export function buildPackingSlipLines(order: OrderRecord) {
  const lines = [
    "LAEM Archive - Packing Slip",
    "",
    `Order: ${order.id}`,
    `Created: ${formatDate(order.created)}`,
    `Email: ${order.email || "-"}`,
    "",
    "Ship To:"
  ];

  lines.push(...buildShippingAddressLines(order));
  lines.push("");
  lines.push("Items:");

  if (Array.isArray(order.items) && order.items.length > 0) {
    for (const item of order.items) {
      lines.push(`- ${item.slug || "-"} x${item.quantity || 1}`);
    }
  } else {
    lines.push(`- ${order.slug || "-"} x${order.quantity || 1}`);
  }

  lines.push("");
  lines.push("Thank you for your order.");
  return lines;
}

export function buildPackingSlipPdfBase64(order: OrderRecord) {
  const lines = buildPackingSlipLines(order);
  const contentStream = renderPdfTextStream(lines);
  return buildSinglePagePdf(contentStream).toString("base64");
}
