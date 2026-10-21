import { describe, expect, it } from 'vitest';
import { deviceLabel, duplicateHostnames } from '../deviceLabel';

describe('deviceLabel', () => {
  it('adds the id only where a hostname occurs twice', () => {
    const fleet = [
      { id: 1, hostname: 'nas' },
      { id: 2, hostname: 'NAS' },
      { id: 3, hostname: 'pc' },
    ];
    const dups = duplicateHostnames(fleet);
    expect(fleet.map((d) => deviceLabel(d, dups))).toEqual(['nas (#1)', 'NAS (#2)', 'pc']);
  });
});
