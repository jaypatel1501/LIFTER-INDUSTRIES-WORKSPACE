import { put } from "@vercel/blob";
import { requireCompanyContext } from "@/lib/permissions";
import { requireEnv } from "@/lib/env";

export async function putCompanyFile(
  filename: string,
  body: Blob | ArrayBuffer | ReadableStream,
  contentType: string,
) {
  const { companyId } = await requireCompanyContext();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  if (!safeName || !contentType) throw new Error("A file name and content type are required");

  return put(`companies/${companyId}/${safeName}`, body, {
    access: "private",
    contentType,
    addRandomSuffix: true,
    token: requireEnv("BLOB_READ_WRITE_TOKEN"),
  });
}
