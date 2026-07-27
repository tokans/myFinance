import { useEffect, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVaultStore } from "@/stores/vault.store";
import { DEMO_MODE, DEMO_MASTER_PASSWORD } from "@/lib/demoMode";
import { cn } from "@/lib/utils";

const RESET_CONFIRM_PHRASE = "DELETE";

/**
 * The Stronghold plugin's own error text for a wrong password isn't a stable,
 * documented string, so we pattern-match the common substrings it (and a
 * corrupted snapshot) surface and translate them into something a user can
 * act on; anything unrecognized is shown as-is rather than hidden.
 */
function friendlyUnlockError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  const looksLikeBadPassword =
    lower.includes("password") ||
    lower.includes("decrypt") ||
    lower.includes("corrupt") ||
    lower.includes("invalid") ||
    lower.includes("snapshot") ||
    lower.includes("chunk");
  return looksLikeBadPassword ? "Incorrect master password." : raw || "Couldn't unlock the vault.";
}

export function UnlockPanel({ onUnlocked, className }: { onUnlocked?: () => void; className?: string }) {
  const { unlocked, hasMasterPassword, loaded, hydrate, unlockVault, lockVault, resetVault } = useVaultStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => { if (!loaded) void hydrate(); }, [loaded, hydrate]);

  // Demo-capture mode: unlock unattended with the demo master password so
  // credential scenarios record without manual typing. No-op in normal builds.
  useEffect(() => {
    if (!DEMO_MODE || !loaded || unlocked || busy) return;
    setBusy(true);
    void unlockVault(DEMO_MASTER_PASSWORD)
      .then(() => onUnlocked?.())
      .catch((e) => setError(friendlyUnlockError(e)))
      .finally(() => setBusy(false));
  }, [loaded, unlocked, busy, unlockVault, onUnlocked]);

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    setError(null);
    if (!hasMasterPassword) {
      if (password.length < 8) { setError("Use at least 8 characters."); return; }
      if (password !== confirm) { setError("Passwords don't match."); return; }
    }
    setBusy(true);
    try {
      await unlockVault(password);
      setPassword(""); setConfirm("");
      onUnlocked?.();
    } catch (e) {
      setError(friendlyUnlockError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (resetPhrase !== RESET_CONFIRM_PHRASE) return;
    setResetBusy(true);
    setResetError(null);
    try {
      await resetVault();
      setResetOpen(false);
      setResetPhrase("");
      setPassword("");
      setConfirm("");
      setError(null);
    } catch (e) {
      setResetError(e instanceof Error ? e.message : "Couldn't reset the vault.");
    } finally {
      setResetBusy(false);
    }
  };

  if (!loaded) return null;

  if (unlocked) {
    return (
      <Card className={cn("border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20", className)}>
        <CardContent className="flex items-center gap-3 py-3 text-xs">
          <Unlock className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          <span className="flex-1 text-emerald-900 dark:text-emerald-200">Vault unlocked for this session.</span>
          <Button variant="ghost" size="sm" onClick={() => void lockVault()}>Lock</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4 text-muted-foreground" />
          {hasMasterPassword ? "Unlock credential vault" : "Set up credential vault"}
        </div>
        <p className="text-xs text-muted-foreground">
          {hasMasterPassword
            ? "Your master password is needed once per session."
            : "Choose a master password. It encrypts the vault and is never stored anywhere. If you forget it, the stored credentials are unrecoverable."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mp">Master password</Label>
            <Input
              id="mp"
              type="password"
              autoComplete={hasMasterPassword ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {!hasMasterPassword && (
            <div className="space-y-1.5">
              <Label htmlFor="mpc">Confirm master password</Label>
              <Input
                id="mpc"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !password}>
            {busy
              ? hasMasterPassword ? "Unlocking… (can take a few seconds)" : "Creating vault…"
              : hasMasterPassword ? "Unlock" : "Create vault"}
          </Button>
        </form>

        {hasMasterPassword && !resetOpen && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => setResetOpen(true)}
          >
            Forgot your password?
          </button>
        )}

        {hasMasterPassword && resetOpen && (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">Reset vault</p>
            <p className="text-xs text-muted-foreground">
              There is no way to recover a forgotten master password — it is never stored anywhere.
              Resetting permanently deletes every stored credential and every uploaded document on
              this device, then lets you set a new password. This cannot be undone.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="reset-phrase">
                Type <span className="font-mono">{RESET_CONFIRM_PHRASE}</span> to confirm
              </Label>
              <Input
                id="reset-phrase"
                value={resetPhrase}
                onChange={(e) => setResetPhrase(e.target.value)}
              />
            </div>
            {resetError && <p className="text-xs text-destructive">{resetError}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={resetBusy || resetPhrase !== RESET_CONFIRM_PHRASE}
                onClick={() => void handleReset()}
              >
                {resetBusy ? "Resetting…" : "Delete old data and reset"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={resetBusy}
                onClick={() => { setResetOpen(false); setResetPhrase(""); setResetError(null); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
