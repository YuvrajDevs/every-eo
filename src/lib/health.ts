// Simple technical health score from audit findings. It reflects technical blockers only,
// not whether AI engines actually cite the site (that's measured separately).
const PENALTY: Record<string, number> = { high: 15, medium: 5, low: 1, info: 0 };

// Issues only the site builder can change don't count: the owner can't act on them.
export function healthScore(findings: { severity: string; fixability?: string }[]) {
  const penalty = findings.filter((f) => f.fixability !== "platform").reduce((sum, f) => sum + (PENALTY[f.severity] ?? 0), 0);
  return Math.max(0, 100 - penalty);
}
