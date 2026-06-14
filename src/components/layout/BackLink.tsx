import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * A small "back to <parent>" link, styled to match the breadcrumb-style links
 * used on account/tax detail pages. Estate / Emergency Planning sub-pages render
 * this at the top of their container so users can return to the hub.
 */
export function BackLink({
  to = "/estate",
  label = "Back to Emergency Planning",
}: {
  to?: string;
  label?: string;
}) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}
