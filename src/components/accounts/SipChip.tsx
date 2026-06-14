import { CalendarClock } from "lucide-react";
import { todayISO } from "@/lib/format";
import { sipIndicatorLabel } from "@/domain/sip";
import { cn } from "@/lib/utils";
import type { Account } from "@/db/accounts";

/**
 * Small SIP indicator chip for a Mutual-Fund account. Renders nothing unless the
 * account has a SIP day configured. Amber when the SIP needs attention (in the
 * lead window or recently overdue), muted otherwise. Label text comes from the
 * pure `sipIndicatorLabel` helper.
 */
export function SipChip({ account, className }: { account: Account; className?: string }) {
  if (account.sip_day == null) return null;
  const { text, tone } = sipIndicatorLabel(todayISO(), account.sip_day, account.sip_last_done);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tone === "due"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          : "bg-muted text-muted-foreground",
        className,
      )}
      title={account.sip_amount != null ? `SIP amount: ${account.sip_amount}` : "Monthly SIP"}
    >
      <CalendarClock className="h-3 w-3" />
      {text}
    </span>
  );
}
