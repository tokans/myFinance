import { useState } from "react";
import { parse, stringify } from "yaml";
import { Textarea } from "@/components/ui/textarea";

interface YamlReviewEditorProps<T> {
  /** Only read at mount (and whenever the component is remounted via a `key`
   *  change) — this is an uncontrolled editor so the user's in-progress
   *  typing (e.g. a momentarily unbalanced quote) is never clobbered by the
   *  parent re-rendering with the last value it accepted from `onChange`.
   *  Callers should pass `key={filename}` (or similar) on this component so
   *  it resets when a genuinely new document has been parsed. */
  initialValue: T;
  onChange: (next: T) => void;
  onValidityChange?: (valid: boolean) => void;
  rows?: number;
}

/** Shows parsed document data as editable YAML instead of a field-by-field
 *  form — more human-readable than JSON for reviewing/correcting a handful
 *  of records. Valid edits flow back via `onChange` immediately; invalid
 *  YAML is left in the textarea (so the user can keep fixing it) with an
 *  inline error, and `onChange` simply isn't called until it parses again. */
export function YamlReviewEditor<T>({ initialValue, onChange, onValidityChange, rows = 16 }: YamlReviewEditorProps<T>) {
  const [text, setText] = useState(() => stringify(initialValue));
  const [error, setError] = useState<string | null>(null);

  const handleChange = (next: string) => {
    setText(next);
    try {
      const parsed = parse(next) as T;
      setError(null);
      onValidityChange?.(true);
      onChange(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid YAML");
      onValidityChange?.(false);
    }
  };

  return (
    <div className="space-y-1">
      <Textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        className="font-mono text-xs leading-relaxed"
      />
      {error && <p className="text-xs text-destructive">Invalid YAML — fix it before saving: {error}</p>}
    </div>
  );
}
