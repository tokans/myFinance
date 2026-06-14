import { useCallback, useEffect, useState } from "react";
import { FileLock2, Trash2, Download, Eye, EyeOff, Plus, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useVaultStore } from "@/stores/vault.store";
import { isTauri } from "@/lib/environment";
import {
  addDocumentMetaOnly, addDocumentWithFile, deleteDocument, documentTypeLabel,
  listDocuments, DOCUMENT_TYPES, type DocumentRecord, type DocumentType,
} from "@/db/documents";
import { readBlob } from "@/vault/documentFiles";

function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reusable encrypted-document panel, scoped to an account or a person. Requires
 * an unlocked vault — blobs are sealed with the vault DEK (see documentFiles.ts).
 * Supports attaching a file, recording a metadata-only entry (e.g. "original in
 * locker"), inline image preview, exporting a decrypted copy, and deletion.
 */
export function DocumentAttach({
  accountId,
  personId,
  types,
}: {
  accountId?: number;
  personId?: number;
  /** Restrict the panel to these document types (e.g. Will/PoA pages). */
  types?: DocumentType[];
}) {
  const { unlocked } = useVaultStore();
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: number; url: string } | null>(null);

  const owner = { accountId, personId };

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    setError(null);
    try {
      setDocs(await listDocuments({ accountId, personId, types }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, personId, types?.join(",")]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Revoke any object URL when the preview changes/unmounts.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const handleDelete = async (d: DocumentRecord) => {
    if (!confirm(`Delete "${d.title}"? This permanently removes the encrypted file.`)) return;
    setBusy(true);
    setError(null);
    try {
      if (preview?.id === d.id) { URL.revokeObjectURL(preview.url); setPreview(null); }
      await deleteDocument(d.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePreview = async (d: DocumentRecord) => {
    if (preview?.id === d.id) { URL.revokeObjectURL(preview.url); setPreview(null); return; }
    if (!d.file_name || !d.mime?.startsWith("image/")) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await readBlob(d.file_name);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: d.mime }));
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ id: d.id, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (d: DocumentRecord) => {
    if (!d.file_name) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await readBlob(d.file_name);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const path = await save({ defaultPath: d.title });
      if (path) await writeFile(path, bytes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri()) return null;

  if (!unlocked) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <FileLock2 className="h-4 w-4" />
          Unlock the vault (Settings → Vault) to view or attach encrypted documents.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileLock2 className="h-4 w-4 text-muted-foreground" /> Documents
          </div>
          {!adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={busy}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {adding && (
          <AddDocumentForm
            owner={owner}
            types={types}
            onDone={async () => { setAdding(false); await refresh(); }}
            onCancel={() => setAdding(false)}
            onError={setError}
          />
        )}

        {docs.length === 0 && !adding ? (
          <p className="text-xs text-muted-foreground">No documents attached yet.</p>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {docs.map((d) => (
              <li key={d.id} className="p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{d.title}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {documentTypeLabel(d.type)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {d.file_name ? (
                        <>{d.mime ?? "file"} · {formatBytes(d.size)} · 🔒 encrypted</>
                      ) : (
                        <>metadata only{d.location_of_original ? ` · original: ${d.location_of_original}` : ""}</>
                      )}
                    </p>
                  </div>
                  {d.file_name && d.mime?.startsWith("image/") && (
                    <Button variant="ghost" size="icon" onClick={() => togglePreview(d)} disabled={busy} aria-label="Preview">
                      {preview?.id === d.id ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  )}
                  {d.file_name && (
                    <Button variant="ghost" size="icon" onClick={() => handleExport(d)} disabled={busy} aria-label="Export">
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(d)} disabled={busy} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {preview?.id === d.id && (
                  <img src={preview.url} alt={d.title} className="mt-2 max-h-64 rounded-md border" />
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Files are encrypted with your master password and stored only on this device. If you forget
          the password they cannot be recovered. Keep a separate backup of critical originals.
        </p>
      </CardContent>
    </Card>
  );
}

function AddDocumentForm({
  owner,
  types,
  onDone,
  onCancel,
  onError,
}: {
  owner: { accountId?: number; personId?: number };
  types?: DocumentType[];
  onDone: () => Promise<void>;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const typeOptions = types && types.length > 0
    ? DOCUMENT_TYPES.filter((t) => types.includes(t.value))
    : DOCUMENT_TYPES;
  const [type, setType] = useState<DocumentType>(typeOptions[0]?.value ?? "other");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);

  const onPick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !title) setTitle(f.name);
  };

  const save = async () => {
    if (!title.trim()) { onError("Give the document a title."); return; }
    setBusy(true);
    try {
      const common = {
        type, title, account_id: owner.accountId, person_id: owner.personId,
        expires_on: expiresOn || null,
      };
      if (file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await addDocumentWithFile({ ...common, mime: file.type || null }, bytes);
      } else {
        await addDocumentMetaOnly({ ...common, location_of_original: location || null });
      }
      await onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="d-type" className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as DocumentType)}>
            <SelectTrigger id="d-type" className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {typeOptions.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-title" className="text-xs">Title</Label>
          <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Term policy 2024" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="d-file" className="text-xs">File <span className="text-muted-foreground">(optional — leave empty to just record where the original is)</span></Label>
        <Input id="d-file" type="file" onChange={onPick} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {!file && (
          <div className="space-y-1.5">
            <Label htmlFor="d-loc" className="text-xs">Location of original <span className="text-muted-foreground">(optional)</span></Label>
            <Input id="d-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bank locker, HDFC Andheri" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="d-exp" className="text-xs">Expires on <span className="text-muted-foreground">(optional — adds a reminder)</span></Label>
          <Input id="d-exp" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}
