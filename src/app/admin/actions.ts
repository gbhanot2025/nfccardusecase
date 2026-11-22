"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Label } from "@/components/LabelSheet";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/require-user";
import { createBatch, createBatchInput, type IssuedTag, reissueClaimCodes } from "@/server/batches";
import { qrSvg, qrUrl, tagUrl } from "@/server/links";
import { adminDisableTag, adminEnableTag, isTagId } from "@/server/tags";
import { type ImportResult, importEncoderResults, MAX_IMPORT_BYTES } from "@/server/taps";

/** What the admin gets back once: everything needed to print labels and the CSV. */
export type IssuedBatch = {
  batchId: string;
  label: string;
  labels: (Label & { claimCode: string; nfcUrl: string; qrUrl: string })[];
};

export type IssueState = { error?: string; issued?: IssuedBatch };

async function toIssued(result: { batchId: string; label: string; tags: IssuedTag[] }): Promise<IssuedBatch> {
  const base = env().APP_BASE_URL;
  const labels = await Promise.all(
    result.tags.map(async (t) => ({
      ...t,
      nfcUrl: tagUrl(base, t.tagId),
      qrUrl: qrUrl(base, t.publicCode),
      qrSvg: await qrSvg(qrUrl(base, t.publicCode)),
    })),
  );
  return { batchId: result.batchId, label: result.label, labels };
}

export async function createBatchAction(_prev: IssueState, formData: FormData): Promise<IssueState> {
  const admin = await requireAdmin("/admin/batches/new");
  const parsed = createBatchInput.safeParse({
    label: formData.get("label"),
    formFactor: formData.get("formFactor"),
    allowedTypes: formData.getAll("allowedTypes"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };

  const result = await createBatch(getDb(), parsed.data, admin.id);
  revalidatePath("/admin");
  return { issued: await toIssued(result) };
}

const batchIdSchema = z.string().regex(/^b_[0-9a-z]{12}$/);

export async function reissueAction(batchId: string, prev: IssueState): Promise<IssueState> {
  const admin = await requireAdmin("/admin");
  // Codes were just issued on this page: never silently replace them a second time.
  if (prev.issued) return prev;
  const id = batchIdSchema.safeParse(batchId);
  if (!id.success) return { error: "Unknown batch." };
  const result = await reissueClaimCodes(getDb(), id.data, admin.id);
  if (!result) return { error: "Unknown batch." };
  if (result.tags.length === 0) return { error: "Every tag in this batch is already claimed or disabled." };
  revalidatePath(`/admin/batches/${id.data}`);
  return { issued: await toIssued(result) };
}

const tagIdSchema = z.string().refine(isTagId);

export async function adminSetDisabledAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin("/admin");
  const tagId = tagIdSchema.safeParse(formData.get("tagId"));
  const disable = formData.get("disable") === "1";
  if (!tagId.success) return;
  if (disable) await adminDisableTag(getDb(), admin.id, tagId.data);
  else await adminEnableTag(getDb(), admin.id, tagId.data);
  revalidatePath("/admin", "layout");
}

export type ImportState = { error?: string; result?: ImportResult };

/** Upload the encoder's results CSV so each tag knows its chip UID (needed to verify taps). */
export async function importEncoderResultsAction(
  batchId: string,
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const admin = await requireAdmin("/admin");
  const id = batchIdSchema.safeParse(batchId);
  if (!id.success) return { error: "Unknown batch." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the encoder's results CSV." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "That file is too large for an encoder results CSV." };

  const result = await importEncoderResults(getDb(), id.data, await file.text(), admin.id);
  revalidatePath(`/admin/batches/${id.data}`);
  return { result };
}
