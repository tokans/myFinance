import { Component, type ErrorInfo, type ReactNode } from "react";
import { openExternal } from "@/lib/openExternal";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  showDetails: boolean;
}

/** Where boot-crash reports go. */
const SUPPORT_EMAIL = "myFinance.issues@tokans.org";

/**
 * App-wide last-resort error boundary. Before this existed, any uncaught error
 * during boot/render left the user staring at a blank white screen with no
 * indication of what went wrong (the symptom that masked a duplicate-React
 * bundling bug — see vite.config.ts `resolve.dedupe`). Now a crash renders a
 * legible message plus recovery affordances. The full stack is hidden by default
 * (revealed by "Show details") and can be mailed to support — release builds have
 * no devtools, so this is the only way to read a boot crash off the installed app.
 * Keep this dependency-light (no app stores, no router, no UI primitives) so it
 * can't itself fail to render; `openExternal` is a tiny dynamic-import wrapper.
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, showDetails: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null, showDetails: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled app error:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  /** Full report text: message + JS stack + React component stack + minimal context. */
  private details(): string {
    const { error, componentStack } = this.state;
    if (!error) return "";
    return [
      `${error.name}: ${error.message}`,
      error.stack ?? "(no stack)",
      componentStack ? `\nComponent stack:${componentStack}` : "",
      `\nUser agent: ${navigator.userAgent}`,
      `URL: ${window.location.href}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private sendToSupport = () => {
    const { error } = this.state;
    const subject = `myFinance error: ${error?.message ?? "startup crash"}`.slice(0, 120);
    const body = `Please describe what you were doing (optional):\n\n\n--- technical details ---\n${this.details()}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    void openExternal(url).catch((e) => console.error("Failed to open mail client:", e));
  };

  render() {
    const { error, showDetails } = this.state;
    if (!error) return this.props.children;
    const details = this.details();
    return (
      <div className="flex h-screen w-full items-center justify-center p-6">
        <div className="w-full max-w-2xl text-center">
          <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            myFinance hit an unexpected error while starting. Your data is stored
            locally and is unaffected. Try reloading; if it keeps happening, please
            send the error to support.
          </p>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.sendToSupport}
              className="rounded-md border px-4 py-2 text-sm font-medium text-foreground"
            >
              Send to support
            </button>
            <button
              type="button"
              onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
              aria-expanded={showDetails}
              className="rounded-md border px-4 py-2 text-sm font-medium text-foreground"
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>
          </div>

          {showDetails && (
            <>
              <pre className="mt-4 max-h-72 overflow-auto rounded bg-muted p-3 text-left text-xs whitespace-pre-wrap break-words text-muted-foreground">
                {details}
              </pre>
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(details)}
                  className="rounded-md border px-4 py-2 text-sm font-medium text-foreground"
                >
                  Copy error
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
}
