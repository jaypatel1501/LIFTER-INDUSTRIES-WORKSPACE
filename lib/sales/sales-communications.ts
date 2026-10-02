import { SalesDocumentEventType } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { sendSalesDocumentEmail } from "@/lib/email";
import { env, requireEnv } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { hashIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { withTransaction } from "@/lib/transactions";

type SalesContext = { companyId: string; userId: string };
type RequestInfo = { ipAddress?: string | undefined; userAgent?: string | undefined };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export async function sendSalesDocument(
  context: SalesContext,
  documentId: string,
  channel: "EMAIL" | "WHATSAPP",
  rawKey: string | null,
  requestInfo: RequestInfo,
) {
  if (!rawKey) throw new ValidationError("Idempotency-Key header is required");
  const key = hashIdempotencyKey(rawKey);
  const document = await prisma.salesDocument.findFirst({
    where: { id: documentId, companyId: context.companyId },
    include: {
      party: { select: { name: true, email: true, mobile: true, phone: true } },
      lines: { orderBy: { lineNumber: "asc" }, select: { description: true, quantity: true, unit: true, taxableAmount: true } },
      company: { select: { name: true, email: true, phone: true, currency: true } },
    },
  });
  if (!document) throw new NotFoundError("Sales document not found in the current company");
  if (!["ISSUED", "ACCEPTED", "POSTED"].includes(document.status)) {
    throw new ValidationError("Only issued, accepted or posted sales documents can be sent");
  }
  const contact = channel === "EMAIL" ? document.party.email : document.party.mobile ?? document.party.phone;
  if (!contact) throw new ValidationError(`The customer does not have a ${channel === "EMAIL" ? "email address" : "mobile number"}`);
  const idempotencyKey = `${key}:${channel.toLowerCase()}`;
  const existingEvent = await prisma.salesDocumentEvent.findUnique({
    where: { companyId_idempotencyKey: { companyId: context.companyId, idempotencyKey } },
    select: { documentId: true, eventType: true, snapshot: true },
  });
  if (existingEvent) {
    if (existingEvent.documentId !== documentId || existingEvent.eventType !== (channel === "EMAIL" ? "EMAIL_SENT" : "WHATSAPP_SENT")) {
      throw new ValidationError("Idempotency-Key was already used for another communication");
    }
    return { channel, recipient: contact, replayed: true };
  }
  const amount = new Intl.NumberFormat("en-IN", { style: "currency", currency: document.company.currency }).format(Number(document.totalAmount));
  const title = document.documentType.replaceAll("_", " ");
  const lines = document.lines.map((line) =>
    `${line.description} — ${line.quantity.toString()} ${line.unit} (${line.taxableAmount.toString()})`,
  );
  const subject = `${title} ${document.documentNumber} from ${document.company.name}`;
  if (channel === "EMAIL") {
    await sendSalesDocumentEmail(
      contact,
      subject,
      `${title} ${document.documentNumber}\n${document.company.name}\nTotal: ${amount}\n\n${lines.join("\n")}`,
      `<h1>${escapeHtml(title)} ${escapeHtml(document.documentNumber)}</h1><p>From ${escapeHtml(document.company.name)}</p><p>Total: ${escapeHtml(amount)}</p><ul>${document.lines.map((line) => `<li>${escapeHtml(line.description)} — ${escapeHtml(line.quantity.toString())} ${escapeHtml(line.unit)} (${escapeHtml(line.taxableAmount.toString())})</li>`).join("")}</ul>`,
    );
  } else {
    if (!env.WHATSAPP_API_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      throw new ValidationError("WhatsApp integration is not configured");
    }
    const response = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("WHATSAPP_API_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: contact.replace(/[^\d+]/g, ""),
        type: "text",
        text: { body: `${title} ${document.documentNumber} from ${document.company.name}. Total: ${amount}` },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`WhatsApp provider returned HTTP ${response.status}`);
  }
  const eventType: SalesDocumentEventType = channel === "EMAIL" ? "EMAIL_SENT" : "WHATSAPP_SENT";
  await withTransaction(async (tx) => {
    await tx.salesDocumentEvent.create({
      data: {
        companyId: context.companyId,
        documentId,
        actorId: context.userId,
        eventType,
        idempotencyKey,
        snapshot: { recipient: contact, channel, documentNumber: document.documentNumber },
      },
    });
    await writeAuditLog({
      companyId: context.companyId,
      actorId: context.userId,
      action: `SALES_DOCUMENT_${channel}_SENT`,
      entityType: "SalesDocument",
      entityId: documentId,
      changes: { channel, recipient: contact, documentNumber: document.documentNumber },
      ...requestInfo,
    }, tx);
  });
  return { channel, recipient: contact, replayed: false };
}
