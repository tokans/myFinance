import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FOLDER_DOC_TYPES, type FolderDocType } from "@/tax/folderDocClassifier";
import { useTaxFolderQueueStore } from "@/stores/taxFolderQueue.store";

interface PendingQueuedFile {
  file: File;
  position: number;
  total: number;
  ay: string;
}

export interface UseQueuedDocumentImportResult {
  /** Set only on the mount that consumed a matching queued file — null
   *  otherwise (nothing queued, or the queue's next file is a different doc
   *  type than this page expects). */
  pendingFile: File | null;
  pendingAy: string | null;
  queuePosition: number | null;
  queueTotal: number | null;
  hasNext: boolean;
  /** Advances to the next queued file's page, carrying forward whatever AY
   *  this page ended up using (it may differ from the batch default if the
   *  user adjusted it, e.g. via an identity-mismatch "use detected AY"). */
  goToNextInQueue: (currentAy: string) => void;
}

/**
 * Consumes one entry from `taxFolderQueue.store.ts`'s bulk-import queue on
 * mount, if the queue's next file matches `expectedDocType` — used by the 8
 * `/tax/*` import pages to auto-run their existing parse flow instead of
 * waiting for a manual file pick when reached via `TaxFolderImportPage`'s
 * "Start" button — used by the 8 `/tax/*` import pages plus
 * `StatementPdfImportPage` (`/import/statement-pdf`), the one target route
 * outside `/tax/*`. Guarded by a ref (not just an effect) so React 18
 * StrictMode's dev-only double-invoke of effects can never consume two queue
 * entries for what is, from the queue's perspective, a single mount — safe
 * regardless, since `RemountOnNavigate` (below) guarantees every real queue
 * hop gets a genuinely fresh component instance (a fresh ref) to consume from.
 */
export function useQueuedDocumentImport(expectedDocType: FolderDocType): UseQueuedDocumentImportResult {
  const navigate = useNavigate();
  const consumedRef = useRef(false);
  const [pending, setPending] = useState<PendingQueuedFile | null>(null);
  const hasNext = useTaxFolderQueueStore((s) => s.queue.length > 0);

  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;
    const store = useTaxFolderQueueStore.getState();
    const head = store.queue[0];
    if (!head || head.docType !== expectedDocType) return;
    const consumed = store.consumeNext();
    if (!consumed) return;
    setPending({ file: consumed.file.file, position: consumed.position, total: store.total, ay: store.ay });
    // Intentionally empty deps: consume at most once per real mount, and
    // `expectedDocType` is fixed for a given page anyway.
  }, []);

  const goToNextInQueue = (currentAy: string): void => {
    const store = useTaxFolderQueueStore.getState();
    store.setAy(currentAy);
    const next = store.queue[0];
    if (!next) return;
    // `replace: true` — an inter-file hop shouldn't add one back-history
    // entry per document; the orchestrator's own first hop into the queue
    // (TaxFolderImport.tsx's `start()`) is a normal push, so Back from the
    // FIRST file still returns to the folder file-list, just not to every
    // file in between.
    navigate(FOLDER_DOC_TYPES[next.docType].route, { replace: true });
  };

  return {
    pendingFile: pending?.file ?? null,
    pendingAy: pending?.ay ?? null,
    queuePosition: pending?.position ?? null,
    queueTotal: pending?.total ?? null,
    hasNext,
    goToNextInQueue,
  };
}

/**
 * Forces a full unmount/remount of `children` on every `navigate()` call,
 * even a same-path one (Form16 file 1 -> Form16 file 2 both resolve to
 * `/tax/form16`) — react-router does NOT remount a route's element just
 * because navigation re-targets the same path. `location.key` is a fresh
 * value on every navigation, so keying a wrapping `Fragment` on it forces
 * React to treat each hop as a brand-new component instance (the standard
 * "force remount on same-path navigation" idiom). Wrap ONLY the 9 queued-mode
 * target routes in `App.tsx` — every other route's normal single-visit
 * lifecycle is unaffected.
 */
export function RemountOnNavigate({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <Fragment key={location.key}>{children}</Fragment>;
}
