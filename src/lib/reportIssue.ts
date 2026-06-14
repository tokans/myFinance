import { isTauri } from "@/lib/environment";

/** Repo that receives issue reports. */
export const ISSUE_REPO = "tokans/myFinance";

export type IssueType = "bug" | "feature" | "question";

export const ISSUE_TYPES: { value: IssueType; label: string; label_gh: string }[] = [
  { value: "bug", label: "Bug — something is broken", label_gh: "bug" },
  { value: "feature", label: "Feature request — an idea or improvement", label_gh: "enhancement" },
  { value: "question", label: "Question — need help or clarification", label_gh: "question" },
];

export interface IssueDraft {
  type: IssueType;
  title: string;
  description: string;
  steps?: string;
  includeContext: boolean;
  /** The reporter's engagement tier label (e.g. "Newcomer", "Patron"). */
  tierLabel: string;
}

/** Article that reads naturally before a tier label ("an Expert", "a Patron"). */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** Best-effort app + OS context appended to the issue body. Never throws. */
export async function collectContext(): Promise<string> {
  const lines: string[] = [];
  try {
    if (isTauri()) {
      const { getVersion, getTauriVersion } = await import("@tauri-apps/api/app");
      const os = await import("@tauri-apps/plugin-os");
      const [appVer, tauriVer] = await Promise.all([getVersion(), getTauriVersion()]);
      lines.push(`- App version: ${appVer}`);
      lines.push(`- Platform: ${os.platform()} ${os.version()} (${os.arch()})`);
      lines.push(`- Tauri: ${tauriVer}`);
    } else {
      lines.push(`- Environment: web (npm run dev)`);
      lines.push(`- User agent: ${navigator.userAgent}`);
    }
  } catch {
    // Context is a nicety, not a requirement — drop it silently on failure.
  }
  return lines.join("\n");
}

/** Build the prefilled GitHub "new issue" URL. GitHub itself prompts the user to
 *  sign in / sign up before the issue can be submitted. */
export function buildIssueUrl(draft: IssueDraft, context: string): string {
  const tier = draft.tierLabel.trim() || "Newcomer";
  const lead = `I am ${article(tier)} ${tier} user and ${draft.description.trim()}`;
  const bodyParts = [lead];

  if (draft.steps?.trim()) {
    bodyParts.push(`### Steps to reproduce\n${draft.steps.trim()}`);
  }
  if (draft.includeContext && context) {
    bodyParts.push(`### Environment\n${context}`);
  }

  const gh = ISSUE_TYPES.find((t) => t.value === draft.type);
  const params = new URLSearchParams({
    title: draft.title.trim(),
    body: bodyParts.filter(Boolean).join("\n\n"),
  });
  if (gh?.label_gh) params.set("labels", gh.label_gh);

  return `https://github.com/${ISSUE_REPO}/issues/new?${params.toString()}`;
}
