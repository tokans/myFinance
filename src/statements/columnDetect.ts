import { classifyValueKind } from "@/excel/parse";
import { templateFor } from "./institutionTemplates";
import type { StatementColumnKind } from "./types";

const DATE_WORDS = /\b(date|txn date|value date|transaction date|posting date)\b/i;
const DESCRIPTION_WORDS = /\b(description|narration|particulars|details|remarks|transaction details)\b/i;

function classifyHeaderCell(text: string): StatementColumnKind | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (DATE_WORDS.test(trimmed)) return "date";
  if (DESCRIPTION_WORDS.test(trimmed)) return "description";
  return classifyValueKind(trimmed);
}

/**
 * Builds a header-cell classifier for a statement, optionally specialized by
 * the account's institution.
 *
 * A registered template's column-label overrides are tried FIRST per kind;
 * anything the template doesn't cover (or no template at all) falls through
 * to the generic vocabulary, so this can never do worse than the generic
 * heuristic alone. The returned `applied` flag reports whether the template
 * actually matched anything — for the parsing log, and for the caller to say
 * so on the review screen.
 */
export function statementColumnClassifier(institution?: string | null): {
  classify: (text: string) => StatementColumnKind | null;
  applied: () => boolean;
} {
  const template = templateFor(institution);
  let applied = false;

  return {
    classify(text: string): StatementColumnKind | null {
      const trimmed = text.trim();
      if (!trimmed) return null;
      if (template) {
        for (const [kind, re] of Object.entries(template.columnWords)) {
          if (re.test(trimmed)) {
            applied = true;
            return kind as StatementColumnKind;
          }
        }
      }
      return classifyHeaderCell(trimmed);
    },
    applied: () => applied,
  };
}
