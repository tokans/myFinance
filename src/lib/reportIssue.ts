/**
 * GitHub issue-report wiring (feedback dialog). The mechanism — issue-type vocabulary,
 * context collection, and the prefilled "new issue" URL builder — lives in the shared
 * core (`sharedcorelib/suite` → `createIssueReporter`). This file binds it to myFinance's
 * receiving repo and re-exports the pieces the dialog imports.
 */
import { createIssueReporter } from "sharedcorelib/suite";

/** Repo that receives issue reports. */
export const ISSUE_REPO = "tokans/myFinance";

const reporter = createIssueReporter({ repo: ISSUE_REPO });

export const ISSUE_TYPES = reporter.ISSUE_TYPES;
export const collectContext = reporter.collectContext;
export const buildIssueUrl = reporter.buildIssueUrl;

export type { IssueType, IssueDraft } from "sharedcorelib/suite";
