/**
 * Compare dotted version strings numerically: "0.10.0" is newer than
 * "0.9.0". A plain string sort got that backwards and reported the agent
 * rollout against the wrong release. Non-numeric suffixes compare as text
 * after the numeric parts.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** The newest version among the given ones, or '' for none. */
export function newestVersion(versions: string[]): string {
  return versions.filter(Boolean).reduce((best, v) => (compareVersions(v, best) > 0 ? v : best), '');
}
