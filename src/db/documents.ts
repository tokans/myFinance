import { query, exec, getDb, T } from "./client";
import { deleteBlob, saveBlob } from "@/vault/documentFiles";

/**
 * Document type vocabulary. Kept broad so later phases (Will/PoA/AMD, insurance,
 * health cards) reuse the same table without a schema change.
 */
export type DocumentType =
  | "will"
  | "codicil"
  | "probate"
  | "poa"
  | "amd"
  | "policy"
  | "statement"
  | "id_card"
  | "health_card"
  | "other";

export const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: "will", label: "Will" },
  { value: "codicil", label: "Codicil" },
  { value: "probate", label: "Probate order" },
  { value: "poa", label: "Power of Attorney" },
  { value: "amd", label: "Advance Medical Directive" },
  { value: "policy", label: "Insurance policy" },
  { value: "statement", label: "Statement" },
  { value: "id_card", label: "ID card" },
  { value: "health_card", label: "Health / insurance card" },
  { value: "other", label: "Other" },
];

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPES.find((t) => t.value === type)?.label ?? type;
}

export interface DocumentRecord {
  id: number;
  type: DocumentType;
  title: string;
  /** uuid file name under $APPDATA/documents, or null for a metadata-only record. */
  file_name: string | null;
  mime: string | null;
  size: number | null;
  encrypted: number;
  account_id: number | null;
  person_id: number | null;
  issued_on: string | null;
  expires_on: string | null;
  location_of_original: string | null;
  notes: string | null;
  created_at: string;
}

export interface DocumentMeta {
  type: DocumentType;
  title: string;
  account_id?: number | null;
  person_id?: number | null;
  mime?: string | null;
  size?: number | null;
  issued_on?: string | null;
  expires_on?: string | null;
  location_of_original?: string | null;
  notes?: string | null;
}

export async function listDocuments(
  filter: { accountId?: number; personId?: number; types?: DocumentType[] } = {},
): Promise<DocumentRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.accountId != null) { where.push("account_id = ?"); params.push(filter.accountId); }
  if (filter.personId != null) { where.push("person_id = ?"); params.push(filter.personId); }
  if (filter.types && filter.types.length > 0) {
    where.push(`type IN (${filter.types.map(() => "?").join(", ")})`);
    params.push(...filter.types);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return query<DocumentRecord>(`SELECT * FROM ${T.documents} ${clause} ORDER BY created_at DESC`, params);
}

/** Insert a metadata row. `fileName` is the (already encrypted) blob's name, or null. */
async function insertDocument(meta: DocumentMeta, fileName: string | null): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO ${T.documents}
       (type, title, file_name, mime, size, encrypted, account_id, person_id,
        issued_on, expires_on, location_of_original, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meta.type,
      meta.title.trim(),
      fileName,
      meta.mime ?? null,
      meta.size ?? null,
      fileName ? 1 : 0,
      meta.account_id ?? null,
      meta.person_id ?? null,
      meta.issued_on ?? null,
      meta.expires_on ?? null,
      meta.location_of_original?.trim() || null,
      meta.notes?.trim() || null,
    ],
  );
  return Number(result.lastInsertId);
}

/** Encrypt + store a file blob, then record its metadata. Requires an unlocked vault. */
export async function addDocumentWithFile(meta: DocumentMeta, bytes: Uint8Array): Promise<number> {
  const fileName = await saveBlob(bytes);
  try {
    return await insertDocument({ ...meta, size: meta.size ?? bytes.byteLength }, fileName);
  } catch (e) {
    // Roll back the orphaned blob if the metadata insert fails.
    await deleteBlob(fileName).catch(() => {});
    throw e;
  }
}

/** Record a document with no attached scan (e.g. "original in bank locker"). */
export async function addDocumentMetaOnly(meta: DocumentMeta): Promise<number> {
  return insertDocument(meta, null);
}

/** Delete a document record and its encrypted blob (if any). */
export async function deleteDocument(id: number): Promise<void> {
  const rows = await query<{ file_name: string | null }>(
    `SELECT file_name FROM ${T.documents} WHERE id = ?`,
    [id],
  );
  const fileName = rows[0]?.file_name;
  await exec(`DELETE FROM ${T.documents} WHERE id = ?`, [id]);
  if (fileName) await deleteBlob(fileName);
}

export async function countDocuments(): Promise<number> {
  const rows = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${T.documents}`);
  return rows[0]?.n ?? 0;
}

/** Delete every document record and its encrypted blob (if any). */
export async function clearAllDocuments(): Promise<void> {
  const rows = await query<{ file_name: string | null }>(
    `SELECT file_name FROM ${T.documents} WHERE file_name IS NOT NULL`,
  );
  await exec(`DELETE FROM ${T.documents}`);
  for (const r of rows) {
    if (r.file_name) await deleteBlob(r.file_name).catch(() => {});
  }
}
