/** YYYY-MM string helpers and financial-year math. Pure functions, no DB. */

export type Month = string; // YYYY-MM

export function parseMonth(m: Month): { year: number; month: number } {
  const [y, mo] = m.split("-").map(Number);
  return { year: y, month: mo };
}

export function formatMonth(year: number, month: number): Month {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function addMonths(m: Month, delta: number): Month {
  const { year, month } = parseMonth(m);
  const total = year * 12 + (month - 1) + delta;
  return formatMonth(Math.floor(total / 12), (total % 12) + 1);
}

export function diffMonths(a: Month, b: Month): number {
  const pa = parseMonth(a);
  const pb = parseMonth(b);
  return (pa.year - pb.year) * 12 + (pa.month - pb.month);
}

export function compareMonths(a: Month, b: Month): number {
  return a.localeCompare(b);
}

/**
 * Return the first month of the financial year that contains `m`.
 * fyStartMonth is 1-indexed (1 = January, 4 = April).
 */
export function fyStartForMonth(m: Month, fyStartMonth: number): Month {
  const { year, month } = parseMonth(m);
  if (month >= fyStartMonth) return formatMonth(year, fyStartMonth);
  return formatMonth(year - 1, fyStartMonth);
}

export interface DashboardSnapshot {
  latestMonth: Month | null;
  totalSavings: number;
  mom: { previousMonth: Month; previousValue: number; delta: number } | null;
  fyStart: { startMonth: Month; startValue: number; delta: number } | null;
  customStart: { startMonth: Month; startValue: number; delta: number } | null;
}

/**
 * Given a sparse {month -> total} map, compute the dashboard numbers.
 * customStartMonth is optional (e.g. user picks a date).
 */
export function computeDashboard(
  totalsByMonth: Map<Month, number>,
  fyStartMonth: number,
  customStartMonth?: Month,
): DashboardSnapshot {
  const months = Array.from(totalsByMonth.keys()).sort(compareMonths);
  if (months.length === 0) {
    return { latestMonth: null, totalSavings: 0, mom: null, fyStart: null, customStart: null };
  }
  const latestMonth = months[months.length - 1];
  const totalSavings = totalsByMonth.get(latestMonth) ?? 0;

  let mom: DashboardSnapshot["mom"] = null;
  if (months.length >= 2) {
    const previousMonth = months[months.length - 2];
    const previousValue = totalsByMonth.get(previousMonth) ?? 0;
    mom = { previousMonth, previousValue, delta: totalSavings - previousValue };
  }

  const fyStartCandidate = fyStartForMonth(latestMonth, fyStartMonth);
  const fyAnchor = closestMonthAtOrBefore(months, fyStartCandidate);
  const fyStart = fyAnchor
    ? {
        startMonth: fyAnchor,
        startValue: totalsByMonth.get(fyAnchor) ?? 0,
        delta: totalSavings - (totalsByMonth.get(fyAnchor) ?? 0),
      }
    : null;

  let customStart: DashboardSnapshot["customStart"] = null;
  if (customStartMonth) {
    const anchor = closestMonthAtOrBefore(months, customStartMonth);
    if (anchor) {
      const startValue = totalsByMonth.get(anchor) ?? 0;
      customStart = { startMonth: anchor, startValue, delta: totalSavings - startValue };
    }
  }

  return { latestMonth, totalSavings, mom, fyStart, customStart };
}

/** Find the most recent month in `months` that is ≤ `target`. */
function closestMonthAtOrBefore(months: Month[], target: Month): Month | null {
  let best: Month | null = null;
  for (const m of months) {
    if (m.localeCompare(target) <= 0) best = m;
    else break;
  }
  return best;
}

/**
 * Build a continuous series filling missing months with the previous value (carry-forward).
 * Useful for charting so the line doesn't gap.
 */
/**
 * Estimate average annual savings from net-worth snapshots, using at most the
 * last `maxYears` years of data. The change in net worth conflates investment
 * returns with fresh savings, so this is a rough proxy meant to be overridden —
 * it powers the FIRE calculator's "approximate annual savings" prefill.
 *
 * The average of the year-over-year increases over a span telescopes to
 * (latest − earliest) / years, so we read it straight off the window endpoints.
 * Returns null when there isn't enough history (no two snapshots spanning a
 * non-zero period) and clamps dis-saving up to 0.
 */
export function estimateAnnualSavings(
  totalsByMonth: Map<Month, number>,
  maxYears = 3,
): number | null {
  const months = Array.from(totalsByMonth.keys()).sort(compareMonths);
  if (months.length < 2) return null;
  const latest = months[months.length - 1];
  // Earliest snapshot still within the trailing window (clamps to the oldest
  // available when there's less than `maxYears` of data).
  const windowStart = addMonths(latest, -maxYears * 12);
  const first = months.find((m) => compareMonths(m, windowStart) >= 0) ?? months[0];
  const spanMonths = diffMonths(latest, first);
  if (spanMonths <= 0) return null;
  const delta = (totalsByMonth.get(latest) ?? 0) - (totalsByMonth.get(first) ?? 0);
  return Math.max(0, Math.round(delta / (spanMonths / 12)));
}

/** Solve a small linear system M·x = b by Gaussian elimination with partial
 * pivoting. Returns the solution vector, or null if the matrix is singular. */
function solveLinear(M: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Augmented copy.
  const a = M.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Pivot: largest magnitude in this column.
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    }
    if (Math.abs(a[piv][col]) < 1e-12) return null; // singular
    [a[col], a[piv]] = [a[piv], a[col]];
    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  // Back-substitution.
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let c = r + 1; c < n; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

/**
 * Least-squares polynomial trend estimate. Fits a polynomial of degree
 * `min(maxDegree, n−1)` to `points` (so 2 points → linear, ≥3 → quadratic at the
 * default maxDegree of 2) and returns its value at `atX`.
 *
 * Used to smooth a multi-year income/value series where the latest point may be
 * a one-off outlier: evaluating the whole-trend fit (rather than trusting the
 * raw last value) de-emphasises it — increasingly so as more years are added.
 * x is mean-centred internally for numerical stability. Returns null for an
 * empty input or a singular fit; the single-point case returns that point's y.
 */
export function polynomialTrendEstimate(
  points: Array<[number, number]>,
  atX: number,
  maxDegree = 2,
): number | null {
  const n = points.length;
  if (n === 0) return null;
  if (n === 1) return points[0][1];

  const degree = Math.min(maxDegree, n - 1);
  const m = degree + 1;
  const xMean = points.reduce((s, [x]) => s + x, 0) / n;
  const xs = points.map(([x]) => x - xMean);
  const ys = points.map(([, y]) => y);

  // Normal equations for least squares: (Vᵀ V) c = Vᵀ y, where V is the
  // Vandermonde matrix on the centred x. Power sums make this compact.
  const S = new Array(2 * degree + 1).fill(0); // S[k] = Σ xᵏ
  for (const x of xs) {
    let p = 1;
    for (let k = 0; k <= 2 * degree; k++) { S[k] += p; p *= x; }
  }
  const T = new Array(m).fill(0); // T[k] = Σ xᵏ·y
  for (let i = 0; i < n; i++) {
    let p = 1;
    for (let k = 0; k < m; k++) { T[k] += p * ys[i]; p *= xs[i]; }
  }
  const A: number[][] = [];
  for (let r = 0; r < m; r++) {
    const row: number[] = [];
    for (let c = 0; c < m; c++) row.push(S[r + c]);
    A.push(row);
  }
  const coef = solveLinear(A, T);
  if (!coef) return null;

  const xc = atX - xMean;
  let y = 0;
  let p = 1;
  for (let k = 0; k < m; k++) { y += coef[k] * p; p *= xc; }
  return y;
}

export function carryForwardSeries(totalsByMonth: Map<Month, number>): { month: Month; total: number }[] {
  const months = Array.from(totalsByMonth.keys()).sort(compareMonths);
  if (months.length === 0) return [];
  const out: { month: Month; total: number }[] = [];
  let cursor = months[0];
  const end = months[months.length - 1];
  let lastValue = totalsByMonth.get(cursor) ?? 0;
  while (cursor.localeCompare(end) <= 0) {
    if (totalsByMonth.has(cursor)) lastValue = totalsByMonth.get(cursor)!;
    out.push({ month: cursor, total: lastValue });
    cursor = addMonths(cursor, 1);
  }
  return out;
}
