// Wilson score interval: an honest range for a rate measured from a small number of trials.
// With 2 mentions out of 5 answers the true rate could reasonably be anywhere from ~12% to ~77%.
export function wilson(successes: number, trials: number, z = 1.96) {
  if (trials === 0) return { rate: 0, low: 0, high: 0 };
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denom;
  return { rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
