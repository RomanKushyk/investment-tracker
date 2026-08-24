// XIRR — money-weighted annualized return (WEALTH-MANAGEMENT-ARCHITECTURE
// §6.1), pure and dependency-free per NEXT-PHASE-PLAN P1. Surfaced ALONGSIDE
// the v1 simple annualizedPct (D5#5 pins its PORTFOLIO_START basis), never
// replacing it. Day count: ACT/365 (docs/reference/FORMULA-AUDIT.md, fintech rulings).
import { daysBetween } from './dates';

export interface CashFlow {
  date: string; // ISO yyyy-MM-dd
  amount: number; // negative = outflow (buy), positive = inflow (payout/sell/terminal value)
}

// Rate domain (−99.9%, +1000%): outside it an "annual rate" is numerical
// noise, not a portfolio statistic — such solutions return null.
const RATE_MIN = -0.999;
const RATE_MAX = 10;
const NEWTON_MAX_ITER = 50;
const BISECT_MAX_ITER = 200;
const SCAN_STEPS = 256;
const NPV_EPS = 1e-9;

/**
 * Annualized money-weighted rate of return, or null when the input is
 * degenerate or no root exists in (RATE_MIN, RATE_MAX).
 *
 * NPV(r) = Σ amountᵢ / (1+r)^(daysᵢ/365), days from the earliest flow
 * (ACT/365). Newton–Raphson from r₀ = 0.1 with a sign-change-scan +
 * bisection fallback (doc §6.1 names exactly this method).
 *
 * Guards (null, never NaN/Infinity):
 * - fewer than 2 flows, or missing a negative or a positive amount;
 * - unparseable dates;
 * - zero time span (all flows on one date — no time to annualize over);
 * - no convergence / no sign change inside the rate domain.
 */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;

  const t0 = flows.reduce((min, f) => (f.date < min ? f.date : min), flows[0].date);
  const years = flows.map((f) => daysBetween(t0, f.date) / 365);
  if (years.some((t) => Number.isNaN(t))) return null;
  if (years.every((t) => t === years[0])) return null; // degenerate: single date

  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, years[i]), 0);
  const dNpv = (r: number) =>
    flows.reduce((s, f, i) => s - (years[i] * f.amount) / Math.pow(1 + r, years[i] + 1), 0);

  // Newton–Raphson.
  let r = 0.1;
  for (let i = 0; i < NEWTON_MAX_ITER; i++) {
    const f = npv(r);
    if (Math.abs(f) < NPV_EPS) return inDomain(r);
    const d = dNpv(r);
    if (!Number.isFinite(d) || Math.abs(d) < Number.EPSILON) break; // flat — bisect instead
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= RATE_MIN || next >= RATE_MAX) break; // wandered out
    if (Math.abs(next - r) < 1e-12) {
      return Math.abs(npv(next)) < NPV_EPS ? inDomain(next) : bisect(npv);
    }
    r = next;
  }
  return bisect(npv);
}

function inDomain(r: number): number | null {
  return r > RATE_MIN && r < RATE_MAX ? r : null;
}

// Scan the domain for a sign change, then bisect it. Multiple-IRR inputs
// (sign-alternating flows) resolve to the first bracketed root.
function bisect(npv: (r: number) => number): number | null {
  const step = (RATE_MAX - RATE_MIN) / SCAN_STEPS;
  // Scan from RATE_MIN exactly: NPV is finite there (the asymptote is at −1,
  // not −0.999), and starting any higher would leave deep-loss roots in
  // (RATE_MIN, RATE_MIN + offset) unbracketed. Endpoint roots at RATE_MIN/
  // RATE_MAX themselves are rejected by inDomain (open interval).
  let lo = RATE_MIN;
  let fLo = npv(lo);
  let hi = lo;
  let fHi = fLo;
  let found = false;
  for (let i = 1; i <= SCAN_STEPS; i++) {
    hi = RATE_MIN + i * step;
    fHi = npv(hi);
    if (Number.isFinite(fLo) && Number.isFinite(fHi) && fLo * fHi <= 0) {
      found = true;
      break;
    }
    lo = hi;
    fLo = fHi;
  }
  if (!found) return null;
  for (let i = 0; i < BISECT_MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < NPV_EPS || hi - lo < 1e-12) {
      return Math.abs(fMid) < 1e-6 ? inDomain(mid) : null;
    }
    if (fLo * fMid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  const mid = (lo + hi) / 2;
  return Math.abs(npv(mid)) < 1e-6 ? inDomain(mid) : null;
}
