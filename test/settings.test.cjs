const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_DOWNLOADS, validateDownloads, inSchedule, blockedTags } = require('../src/settings.cjs');
const { SpeedLimiter } = require('../src/transfer.cjs');
const { retryAfterSeconds } = require('../src/http.cjs');

test('migrates defaults without enabling originals and validates every settings boundary', () => {
  assert.equal(validateDownloads({}).ehOriginal, false);
  assert.equal(validateDownloads({}).hitomiAvif, false);
  assert.equal(validateDownloads({ speedKBps: 400 }).speedKBps, 400);
  for (const patch of [{ ehOriginal: 'false' }, { parallel: 999 }, { http429Delay: -1 }, { scheduleStart: '25:00' }, { dangerous: true }, { blockedTags: null }]) assert.throws(() => validateDownloads(patch));
});
test('daily schedules handle normal, overnight and full-day windows', () => {
  const options = { ...DEFAULT_DOWNLOADS, scheduleEnabled: true, scheduleStart: '23:00', scheduleEnd: '06:00' };
  assert.equal(inSchedule(options, new Date(2026, 8, 27, 23, 0)), true);
  assert.equal(inSchedule(options, new Date(2026, 8, 27, 5, 59)), true);
  assert.equal(inSchedule(options, new Date(2026, 8, 27, 6, 0)), false);
  assert.equal(inSchedule(options, new Date(2026, 8, 27, 12, 0)), false);
  assert.equal(inSchedule({ ...options, scheduleStart: '06:00' }, new Date()), true);
});
test('tag matching respects namespaces and avoids substring blocks', () => {
  assert.deepEqual(blockedTags(['language:english', 'artist:Test_Name', 'group:other'], ' English, test name, artist:other, eng'), ['english', 'test name']);
});
test('speed cap is shared by concurrent transfers and can be disabled live', async () => {
  let cap = 100;
  const waits = [];
  const limiter = new SpeedLimiter(() => cap, async ms => waits.push(ms), () => 0);
  await Promise.all([limiter.consume(10240), limiter.consume(10240)]);
  assert.deepEqual(waits, [100, 200]);
  cap = 0; await limiter.consume(10240); assert.equal(waits.length, 2);
});
test('Retry-After accepts both seconds and an HTTP date', () => {
  assert.equal(retryAfterSeconds('30'), 30);
  assert.equal(retryAfterSeconds('Sun, 27 Sep 2026 12:00:20 GMT', Date.parse('2026-09-27T12:00:00Z')), 20);
  assert.equal(retryAfterSeconds('nonsense'), 0);
});
