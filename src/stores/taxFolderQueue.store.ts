import { create } from "zustand";
import type { FolderDocType } from "@/tax/folderDocClassifier";

export interface QueuedDocFile {
  file: File;
  docType: FolderDocType;
}

/**
 * In-memory hand-off for `pages/TaxFolderImport.tsx`'s bulk-import queue —
 * deliberately a plain module-scoped Zustand store, NOT react-router `state`.
 * `File` objects need to survive from one `/tax/*` route to the next as the
 * queue advances, and there's no existing precedent in this app for putting a
 * `File` through `navigate(path, { state })` (which round-trips through the
 * History API's structured-clone serialization) — a plain in-memory store
 * sidesteps that question entirely, at the cost of the queue not surviving a
 * hard page reload (acceptable: a reload mid-batch-import is already a "start
 * over" situation for every other in-progress form in this app).
 */
interface TaxFolderQueueState {
  /** Remaining, not-yet-consumed files, in processing order. */
  queue: QueuedDocFile[];
  /** Fixed for the whole batch — used for "file N of total" display. */
  total: number;
  /** How many files have been consumed so far (this file's 1-based position). */
  consumedCount: number;
  ay: string;
  /** Starts a new batch, replacing any previous one. */
  start: (files: QueuedDocFile[], ay: string) => void;
  /** Pops and returns the front of the queue, or null if empty. */
  consumeNext: () => { file: QueuedDocFile; position: number } | null;
  setAy: (ay: string) => void;
  clear: () => void;
}

export const useTaxFolderQueueStore = create<TaxFolderQueueState>((set, get) => ({
  queue: [],
  total: 0,
  consumedCount: 0,
  ay: "",
  start: (files, ay) => set({ queue: files, total: files.length, consumedCount: 0, ay }),
  consumeNext: () => {
    const { queue, consumedCount } = get();
    const [next, ...rest] = queue;
    if (!next) return null;
    const position = consumedCount + 1;
    set({ queue: rest, consumedCount: position });
    return { file: next, position };
  },
  setAy: (ay) => set({ ay }),
  clear: () => set({ queue: [], total: 0, consumedCount: 0, ay: "" }),
}));
