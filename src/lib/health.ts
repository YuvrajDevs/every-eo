// Simple technical health score from audit findings. It reflects technical blockers only,
// not whether AI engines actually cite the site (that's measured separately).
const PENALTY: Record<string, number> = { high: 15, medium: 5, low: 1, info: 0 };

export function healthScore(findings: { severity: string }[]) {
  const penalty = findings.reduce((sum, f) => sum + (PENALTY[f.severity] ?? 0), 0);
  return Math.max(0, 100 - penalty);
}
