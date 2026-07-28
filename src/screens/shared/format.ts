// Shared "signed percentage-point gap" formatter — was duplicated per-screen
// with drifting behavior (Yield's used an ASCII '-', Allocation's correctly
// used U+2212). One helper now, parameterized by the optional unit suffix
// each screen's copy needs (Overview "%", Yield " pp", Allocation none).
export function signedPp(n: number, suffix = ''): string {
  return (n < 0 ? '−' : '+') + Math.abs(n).toFixed(1) + suffix;
}
