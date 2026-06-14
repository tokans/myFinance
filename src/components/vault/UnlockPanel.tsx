import { useEffect, useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVaultStore } from "@/stores/vault.store";
import { DEMO_MODE, DEMO_MASTER_PASSWORD } from "@/lib/demoMode";

export function UnlockPanel({ onUnlocked }: { onUnlocked?: () => void }) {
  const { unlocked, hasMasterPassword, loaded, hydrate, unlockVault, lockVault } = useVaultStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!loaded) void hydrate(); }, [loaded, hydrate]);

  // Demo-capture mode: unlock unattended with the demo master password so
  // credential scenarios record without manual typing. No-op in normal builds.
  useEffect(() => {
    if (!DEMO_MODE || !loaded || unlocked || busy) return;
    setBusy(true);
    void unlockVault(DEMO_MASTER_PASSWORD)
      .then(() => onUnlocked?.())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
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
      setError(e instanceof Error ? e.message : "Wrong password or vault corrupted.");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  if (unlocked) {
    return (
      <Card className="border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20">
        <CardContent className="flex items-center gap-3 py-3 text-xs">
          <Unlock className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          <span className="flex-1 text-emerald-900 dark:text-emerald-200">Vault unlocked for this session.</span>
          <Button variant="ghost" size="sm" onClick={() => void lockVault()}>Lock</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
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
            {busy ? "Working…" : hasMasterPassword ? "Unlock" : "Create vault"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
