import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { compactCurrency, formatMoney, formatMonthLabel } from "@/lib/format";

export interface TrendPoint {
  month: string;
  total: number;
}

/**
 * The Dashboard savings trend chart. Extracted into its own module so the
 * heavy `recharts` dependency can be code-split (lazy-loaded) off the eager
 * Dashboard chunk — the index route paints without recharts on the critical
 * path. Props/behavior are identical to the inline chart it replaced.
 */
export default function TrendChart({
  series,
  currency,
}: {
  series: TrendPoint[];
  currency: string;
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="month" fontSize={11} />
          <YAxis fontSize={11} width={64} tickFormatter={(v) => compactCurrency(v, currency)} />
          <Tooltip
            formatter={(v: number) => formatMoney(v, currency)}
            labelFormatter={(m) => formatMonthLabel(String(m))}
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
          />
          <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
