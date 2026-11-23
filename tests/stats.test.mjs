// Tests voor de statistiek- en generatormodules: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as S from '../web/stats.js';
import { generate, STRATEGIES, buildHistory, lookupHistory } from '../web/generator.js';

const root = new URL('../', import.meta.url);
const index = JSON.parse(readFileSync(new URL('data/json/index.json', root)));

test('binom', () => {
  assert.equal(S.binom(45, 6), 8145060);
  assert.equal(S.binom(50, 5) * S.binom(12, 2), 139838160);
  assert.equal(S.binom(5, 7), 0);
});

test('distinctProbabilities sommeert tot 1', () => {
  for (const k of [3, 6]) {
    const p = S.distinctProbabilities(k);
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
  assert.ok(Math.abs(S.distinctProbabilities(3)[1] - 0.01) < 1e-12); // 000..999 met 3 gelijke
});

test('chi-kwadraat p-waarde is redelijk', () => {
  assert.ok(Math.abs(S.chiSquarePValue(44, 44) - 0.47) < 0.03);
  assert.ok(S.chiSquarePValue(100, 44) < 0.001);
});

test('frequencies telt correct', () => {
  const meta = { kind: 'pool', mainCount: 2, extraCount: 0, mainMax: 4, eras: [] };
  const draws = [{ date: '2020-01-01', main: [1, 2], extra: [] }, { date: '2020-01-02', main: [1, 3], extra: [] }];
  const f = S.frequencies(meta, draws, 'main', 1, 4);
  const by = Object.fromEntries(f.rows.map((r) => [r.n, r]));
  assert.equal(by[1].count, 2);
  assert.equal(by[4].count, 0);
  assert.equal(by[4].since, 2);
  assert.equal(by[2].since, 1);
  assert.equal(by[1].expected, 1);
});

test('topCombos vindt het meest voorkomende paar', () => {
  const draws = [{ main: [1, 2, 3] }, { main: [1, 2, 4] }, { main: [2, 3, 5] }];
  const top = S.topCombos(draws, 5, 2, 3);
  assert.deepEqual(top[0], { nums: [1, 2], count: 2 });
});

for (const meta of index.games.filter((g) => g.count > 0)) {
  test(`generator geeft geldige voorstellen voor ${meta.name}`, () => {
    const path = new URL(`data/json/${meta.key}.json`, root);
    assert.ok(existsSync(path));
    const all = S.parseDraws(JSON.parse(readFileSync(path)));
    assert.equal(all.length, meta.count);
    const draws = S.filterPeriod(meta, all, S.periodOptions(meta, all)[0].id);
    const era = S.currentEra(meta);
    const ctx = { meta, draws, pick: meta.pickCount || 0, history: buildHistory(meta, all) };
    // een echte trekking moet als 'al gevallen' herkend worden
    const lastDraw = all[all.length - 1];
    const probe = meta.key === 'keno' ? { main: lastDraw.main.slice(0, 10) } : lastDraw;
    const ph = lookupHistory(ctx.history, probe);
    assert.ok(ph.count >= 1 && ph.last === lastDraw.date, `${meta.key}: historiek herkent laatste trekking`);
    if (meta.hasSign) assert.ok(ph.countWithSign >= 1);
    if (meta.kind === 'pool') {
      ctx.mainFreq = S.frequencies(meta, draws, 'main', 1, era.mainMax);
      if (meta.extraCount) ctx.extraFreq = S.frequencies(meta, draws, 'extra', 1, meta.extraFromMainPool ? era.mainMax : era.extraMax);
      ctx.patterns = S.poolPatterns(meta, draws);
    } else {
      ctx.digitPatterns = S.digitPatterns(meta, draws);
    }
    for (const strategy of Object.keys(STRATEGIES)) {
      for (const avoidPast of [true, false]) {
      const out = generate(ctx, strategy, 10, { avoidPast });
      assert.equal(out.length, 10, `${meta.key}/${strategy}`);
      for (const s of out) {
        const k = meta.key === 'keno' ? ctx.pick : meta.mainCount;
        assert.equal(s.main.length, k);
        if (meta.kind === 'pool') {
          assert.equal(new Set(s.main).size, k, 'geen dubbels');
          assert.ok(s.main.every((n) => n >= 1 && n <= era.mainMax));
          if (meta.extraCount && !meta.extraFromMainPool) {
            assert.equal(s.extra.length, meta.extraCount);
            assert.ok(s.extra.every((n) => n >= 1 && n <= era.extraMax));
          }
          if (strategy === 'balanced' && meta.key !== 'keno') {
            assert.ok(!s.main.every((n) => n <= 31), 'geen pure verjaardagscombinatie');
          }
        } else {
          assert.ok(s.main.every((n) => n >= 0 && n <= 9));
          if (meta.hasSign) assert.ok(typeof s.sign === 'string');
        }
        assert.ok(s.history && Number.isInteger(s.history.count), 'historiek ingevuld');
        if (avoidPast && meta.key !== 'pick3') {
          assert.equal(s.history.count, 0, `${meta.key}/${strategy}: combinatie viel al eens`);
          assert.equal(s.notFresh, false);
        }
        if (avoidPast && s.history.count > 0) assert.equal(s.notFresh, true);
      }
      }
    }
  });
}
