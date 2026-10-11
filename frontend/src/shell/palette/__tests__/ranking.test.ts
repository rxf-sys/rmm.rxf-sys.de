import { describe, expect, it } from 'vitest';
import {
  MAX_DEVICE_ROWS,
  duplicateHostnames,
  indexDevices,
  matchTier,
  normalize,
  rankDevices,
  scoreQuery,
  termScore,
} from '../ranking';
import { device } from './fixtures';

const hostnames = (devices: Parameters<typeof indexDevices>[0], query: string) =>
  rankDevices(indexDevices(devices), query).hits.map((h) => h.entry.device.hostname);

describe('normalize', () => {
  it('folds case, diacritics and ß', () => {
    expect(normalize('Gerät')).toBe('gerat');
    expect(normalize('Straße')).toBe('strasse');
    expect(normalize('BÜRO-PC')).toBe('buro-pc');
  });
});

describe('matchTier', () => {
  it('orders exact > prefix > word start > substring', () => {
    expect(matchTier('nas', 'nas')).toBe(4);
    expect(matchTier('nas-backup', 'nas')).toBe(3);
    expect(matchTier('buero-pc', 'pc')).toBe(2);
    expect(matchTier('lager pc', 'pc')).toBe(2);
    expect(matchTier('buero', 'ero')).toBe(1);
    expect(matchTier('buero', 'xyz')).toBe(0);
  });

  it('finds a word start behind an earlier inner match', () => {
    expect(matchTier('alab-lab', 'lab')).toBe(2);
  });

  it('never matches an empty term or field', () => {
    expect(matchTier('nas', '')).toBe(0);
    expect(matchTier('', 'nas')).toBe(0);
  });
});

describe('scoreQuery', () => {
  const fields = [{ text: normalize('iPhone von Lisa'), weight: 4 }];
  const score = (q: string) => scoreQuery(q, (t) => termScore(fields, t));

  it('matches several words in any order, at the weakest word', () => {
    expect(score('lisa iphone')).toBe(24); // "lisa" starts a word: tier 2
    expect(score('lisa android')).toBe(0);
  });

  it('prefers the whole query when it matches better', () => {
    expect(score('iphone von')).toBe(34);
  });

  it('ignores a blank query', () => {
    expect(score('   ')).toBe(0);
  });
});

describe('rankDevices', () => {
  it('puts the match tier above the field', () => {
    const fleet = [
      device({ id: 1, hostname: 'nasrv' }),
      device({ id: 2, hostname: 'old-srv' }),
      device({ id: 3, hostname: 'srv-backup' }),
      device({ id: 4, hostname: 'fileserver', tags: ['srv'] }),
      device({ id: 5, hostname: 'srv' }),
      device({ id: 6, hostname: 'drucker' }),
    ];
    // Exact hostname, exact tag, prefix, word start, substring; no match left out.
    expect(hostnames(fleet, 'srv')).toEqual(['srv', 'fileserver', 'srv-backup', 'old-srv', 'nasrv']);
  });

  it('ranks an exact OS label above a hostname prefix', () => {
    const fleet = [device({ id: 1, hostname: 'linuxbox', os: 'windows' }), device({ id: 2, hostname: 'zz', os: 'linux' })];
    expect(hostnames(fleet, 'linux')).toEqual(['zz', 'linuxbox']);
  });

  it('searches the owner and finds hostnames without umlauts', () => {
    const fleet = [device({ id: 1, hostname: 'empfang', owner_label: 'Lisa Berg' }), device({ id: 2, hostname: 'Büro-Mac' })];
    expect(hostnames(fleet, 'berg')).toEqual(['empfang']);
    expect(hostnames(fleet, 'buro')).toEqual(['Büro-Mac']);
  });

  it('sorts equal scores by name, numbers in numeric order', () => {
    const fleet = [device({ id: 1, hostname: 'pc-10' }), device({ id: 2, hostname: 'pc-2' }), device({ id: 3, hostname: 'pc-1' })];
    expect(hostnames(fleet, 'pc')).toEqual(['pc-1', 'pc-2', 'pc-10']);
  });

  it(`lists at most ${MAX_DEVICE_ROWS} rows and counts all of them`, () => {
    const fleet = Array.from({ length: 60 }, (_, i) => device({ id: i + 1, hostname: `pc-${i + 1}` }));
    const { hits, total } = rankDevices(indexDevices(fleet), 'pc');
    expect(hits).toHaveLength(MAX_DEVICE_ROWS);
    expect(total).toBe(60);
  });

  it('matches the id only after a "#"', () => {
    const fleet = [device({ id: 12, hostname: 'kasse' }), device({ id: 3, hostname: 'lager' })];
    expect(hostnames(fleet, '#12')).toEqual(['kasse']);
    expect(hostnames(fleet, '12')).toEqual([]);
  });

  it('names the tag that explains a hit, but not when the hostname does', () => {
    const fleet = [device({ id: 1, hostname: 'srv-1', tags: ['Keller'] }), device({ id: 2, hostname: 'keller-nas', tags: ['Keller'] })];
    const { hits } = rankDevices(indexDevices(fleet), 'keller');
    expect(hits.map((h) => [h.entry.device.hostname, h.tag])).toEqual([
      ['keller-nas', null],
      ['srv-1', 'Keller'],
    ]);
  });
});

describe('duplicateHostnames', () => {
  it('collects names that occur more than once, ignoring case', () => {
    const fleet = [device({ id: 1, hostname: 'NAS' }), device({ id: 2, hostname: 'nas' }), device({ id: 3, hostname: 'kasse' })];
    expect([...duplicateHostnames(fleet)]).toEqual(['nas']);
    expect(indexDevices(fleet).map((e) => e.showId)).toEqual([true, true, false]);
  });
});
