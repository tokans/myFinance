import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVaultStore } from "@/stores/vault.store";
import { attachCredential, detachCredential, getCredentialRef, type VaultEntryRef } from "@/db/accounts";
import {
  getCredential, newCredentialKey, putCredential, removeCredential,
  type Credential,
} from "@/vault/stronghold";

export function CredentialPanel({ accountId, accountName }: { accountId: number; accountName: string }) {
  const { unlocked } = useVaultStore();
  const [ref, setRef] = useState<VaultEntryRef | null>(null);
  const [cred, setCred] = useState<Credential | null>(null);
  const [editing, setEditing] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    const r = await getCredentialRef(accountId);
    setRef(r);
    if (r && unlocked) {
      try {
        const c = await getCredential(r.stronghold_key);
        setCred(c);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } else {
      setCred(null);
    }
  }, [accountId, unlocked]);

  useEffect(() => { void refresh(); }, [refresh]);

  const startEdit = () => {
    setLabel(cred?.label ?? accountName);
    setUsername(cred?.username ?? "");
    setPassword(cred?.password ?? "");
    setNotes(cred?.notes ?? "");
    setEditing(true);
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      let key = ref?.stronghold_key;
      if (!key) {
        key = newCredentialKey();
        await attachCredential(accountId, label || accountName, key);
      }
      await putCredential(key, { label: label || accountName, username, password, notes: notes || undefined });
      setEditing(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!ref) return;
    if (!confirm("Remove the saved credential for this account?")) return;
    setBusy(true);
    setError(null);
    try {
      await removeCredential(ref.stronghold_key);
      await detachCredential(accountId);
      setCred(null);
      setEditing(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!unlocked) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <KeyRound className="h-4 w-4" />
          Unlock the credential vault (Settings → Vault) to view or attach a credential.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          Stored credential
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {!editing && cred && (
          <div className="space-y-1 text-sm" data-testid="credential-stored">
            <p><span className="text-muted-foreground">Label: </span>{cred.label}</p>
            <p><span className="text-muted-foreground">Username: </span>{cred.username || "—"}</p>
            <p className="flex items-center gap-2">
              <span className="text-muted-foreground">Password: </span>
              <span className="font-mono">{showPwd ? cred.password : "•".repeat(Math.min(12, cred.password.length))}</span>
              <Button variant="ghost" size="icon" onClick={() => setShowPwd((v) => !v)} aria-label="Toggle password">
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </p>
            {cred.notes && <p><span className="text-muted-foreground">Notes: </span>{cred.notes}</p>}
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={startEdit}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={handleDelete} disabled={busy}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </div>
          </div>
        )}

        {!editing && !cred && (
          <Button size="sm" data-testid="credential-attach" onClick={startEdit}>Attach credential</Button>
        )}

        {editing && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-label">Label</Label>
              <Input id="c-label" data-testid="credential-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-user">Username / account id</Label>
              <Input id="c-user" data-testid="credential-username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-pass">Password</Label>
              <Input id="c-pass" data-testid="credential-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" data-testid="credential-save" onClick={handleSave} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Saved to an encrypted file in your app data folder. Forgetting the master password makes it unrecoverable.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
