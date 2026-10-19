import { NetworkData } from '../data';
import { planFastest, planLeastChanges } from '../planner';

function synthetic(): NetworkData {
  const st = (id: string, toNextS = 60) => ({ id, name: id.toUpperCase(), toNextS });
  return {
    transferPenaltyS: 300,
    sameLineBranchPenaltyS: 0,
    lines: [
      // s1..s5 on line A (s3 is a shared interchange station)
      { id: 'a', name: 'A Line', segments: [{ id: 'a1', stations: [st('s1'), st('s2'), st('s3'), st('s4'), st('s5')] }] },
      // line B crosses A at s3, continues to s7
      { id: 'b', name: 'B Line', segments: [{ id: 'b1', stations: [st('s3', 90), st('s6', 90), st('s7', 90)] }] },
    ],
  };
}

describe('route planner (D-008)', () => {
  const net = synthetic();

  test('direct route stays on one line, no changes', () => {
    const plan = planFastest(net, 's1', 's5');
    expect(plan).not.toBeNull();
    expect(plan!.changes).toBe(0);
    expect(plan!.timeS).toBe(240); // 4 rides × 60s
    expect(plan!.legs).toHaveLength(1);
    expect(plan!.legs[0].lineId).toBe('a');
  });

  test('fastest uses the interchange when it is the only way onward', () => {
    const plan = planFastest(net, 's1', 's7');
    expect(plan!.changes).toBe(1);
    expect(plan!.timeS).toBe(600); // 120 ride + 300 transfer + 180 ride
    expect(plan!.legs.map(l => l.lineId)).toEqual(['a', 'b']);
    expect(plan!.legs[0].alightId).toBe('s3');
  });

  test('least-changes minimizes change count then time', () => {
    const plan = planLeastChanges(net, 's1', 's7');
    expect(plan!.changes).toBe(1);
    expect(plan!.timeS).toBe(600);
  });

  test('least-changes never needs more changes than fastest', () => {
    const fastest = planFastest(net, 's1', 's7')!;
    const least = planLeastChanges(net, 's1', 's7')!;
    expect(least.changes).toBeLessThanOrEqual(fastest.changes);
  });

  test('same-station plan is empty', () => {
    expect(planFastest(net, 's1', 's1')).toEqual({ legs: [], timeS: 0, changes: 0, stationCount: 1 });
  });

  // Real Blue Line v0 data (placeholder times, verified ORDER of what matters here:
  // branch graphs share Yamuna Bank and must route as one line, zero changes)
  describe('blue line v0 data pack', () => {
    test('Dwarka 21 → Noida Electronic City crosses the Yamuna Bank split with 0 changes', () => {
      const fast = planFastest(require('../data').blueLineNetwork, 'dwarka-sector-21', 'noida-electronic-city');
      expect(fast!.changes).toBe(0);
      expect(fast!.legs).toHaveLength(1);
      expect(fast!.stationCount).toBe(50); // 34 trunk + 17 noida − shared Yamuna Bank
    });

    test('Vaishali → Tagore Garden also stays on one leg', () => {
      const fast = planFastest(require('../data').blueLineNetwork, 'vaishali', 'tagore-garden');
      expect(fast!.changes).toBe(0);
      expect(fast!.stationCount).toBe(24); // 8 vaishali + 34−17 trunk + shared Yamuna Bank
    });
  });
});
