import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {connected, load, fragments, broadcast, period, flush, deferred} from './motto-harness.mjs';

test('grinder manifest matches the name (service is absent from advertising) and exposes truthful capabilities', () => {
  const manifest = JSON.parse(readFileSync(new URL('../bookoo-motto80.reaplugin/manifest.json', import.meta.url)));
  const declaration = manifest.drivers[0];
  assert.equal(declaration.type, 'grinder');
  assert.deepEqual(declaration.ble.match, {name: {prefix: 'BOOKOO MT80 '}});
  assert.deepEqual(declaration.capabilities, ['rpmControl']);
  assert.deepEqual(declaration.observations, ['setting', 'rpm']);
  assert.deepEqual(declaration.controls.rpmControl, {kind: 'numeric', min: 500, max: 1500, step: 10});
  assert.equal(declaration.surfaces[0].endpoint, 'device-settings');
});

test('actual Decaid bridge handshakes with 20-byte acknowledged packets and publishes a valid Grinder snapshot', async () => {
  const {host, link, driver, deviceId} = await connected();
  assert.deepEqual(link.requests, [{request: {appHello: {op: 'handshake'}}}]);
  assert.deepEqual(link.published, [{state: 'idle', observedSetting: '500', observedRpm: 700, rpm: 700}]);
  assert.equal(driver.entry.handlers.start, undefined);
  assert.equal(driver.entry.handlers.stop, undefined);
  assert.equal(driver.entry.handlers.setGrindSetting, undefined);
  const status = await host.http('status', {deviceId});
  assert.equal(status.value.firmware, 102190820);
  assert.equal(status.value.humidity, 25);
  assert.equal(status.value.snCode, undefined); assert.equal(status.value.wifiName, undefined);
  await link.disconnect(); assert.equal(host.clock.timers.size, 0);
});

test('RPM waits for the matching business response; telemetry continues to come from broadcasts', async () => {
  const {host, link} = await connected({autoResponse: false});
  let completed = false;
  const work = link.setRpm(1200).then(() => {completed = true;});
  await flush(); assert.equal(completed, false);
  assert.deepEqual(link.requests.at(-1), {request: {geneSetting: {op: 'set', data: {grindRpm: 1200}}}});
  await link.emit({response: {geneSetting: {result: 'success', data: {grindRpm: 900}}}});
  assert.equal(completed, false);
  await link.emit({response: {geneSetting: {result: 'success', data: {grindRpm: 1200}}}});
  await work; assert.equal(completed, true);
  assert.equal(link.published.at(-1).rpm, 700);
  await link.emit(broadcast({grindRpm: 1200, bladeGap: 123}));
  assert.equal(link.published.at(-1).rpm, 1200);
  assert.equal(link.published.at(-1).observedSetting, '123');
  await link.disconnect(); assert.equal(host.clock.timers.size, 0);
});

test('settings page/API applies only documented settings and returns manufacturer failures', async () => {
  const {host, link, deviceId} = await connected({autoResponse: false});
  const settings = {feedingRpm: 10, brightness: 1, standbySec: 900, selectPreset: 9,
    cupDetect: false, autoStop: true, fastClean: false};
  const work = host.http('configure', {deviceId, body: {settings}});
  await link.waitForRequests(2);
  assert.deepEqual(link.requests.at(-1).request.geneSetting.data, settings);
  await link.emit({response: {geneSetting: {result: 'success', data: settings}}});
  assert.deepEqual((await work).value, {applied: settings});
  const rejected = link.setRpm(1000); const assertion = assert.rejects(rejected, {code: 'device_rejected'});
  await flush(); await link.emit({response: {geneSetting: {result: 'fail', error: {code: 'INVALID_STATE'}}}});
  await assertion;
  assert.equal((await host.http('status', {deviceId})).status, 200);
  await link.disconnect();
});

for (const settings of [{grindRpm: 499}, {grindRpm: 1501}, {grindRpm: 500.5}, {grindRpm: '900'},
  {feedingRpm: 66}, {brightness: 0}, {standbySec: 901}, {selectPreset: -2}, {cupDetect: 1},
  {bladeGap: 100}, {start: true}, {}, [], null, {toString: 1}, {constructor: 1}]) {
  test('rejects invalid configuration without writing: ' + JSON.stringify(settings), async () => {
    const {host, link, deviceId} = await connected(); const before = link.writes.length;
    assert.equal((await host.http('configure', {deviceId, body: {settings}})).status, 400);
    assert.equal(link.writes.length, before); await link.disconnect();
  });
}

test('only one business request can be in flight; no fragment interleaving', async () => {
  const {host, link, deviceId} = await connected({autoResponse: false});
  const first = link.setRpm(500); await flush();
  await assert.rejects(link.setRpm(1500), {code: 'busy'});
  assert.equal((await host.http('configure', {deviceId, body: {settings: {feedingRpm: 25}}})).status, 409);
  assert.equal(link.requests.length, 2);
  await link.emit({response: {geneSetting: {result: 'success', data: {grindRpm: 500}}}});
  await first; await link.disconnect();
});

test('unknown firmware permits observations but does not authorize writes; old firmware fails initialization', async () => {
  const host = await load(); const link = host.connect(host.create(), {autoHello: false});
  await flush(); await link.emit(broadcast()); await link.connection;
  await assert.rejects(link.setRpm(900), {code: 'unsupported_firmware'});
  await link.disconnect();
  const old = host.connect(host.create(1), {firmware: 102190819});
  await assert.rejects(old.connection, {code: 'unsupported_firmware'});
  assert.equal(old.published.length, 0); assert.equal(host.clock.timers.size, 0);
});

test('firmware v1.3.1.1020 accepts the public handshake and settings contract', async () => {
  const {host, link, deviceId} = await connected({firmware:103011020});
  assert.equal((await host.http('status', {deviceId})).value.firmware, 103011020);
  await link.setRpm(900);
  assert.equal(link.requests.at(-1).request.geneSetting.data.grindRpm, 900);
  await link.disconnect();
});

for (const [devState, state] of [['GRINDING','grinding'], ['HighSpeedClean','grinding'], ['HIGH_SPEED_CLEAN','grinding'],
  ['WARNING','error'], ['SETTING','unknown'], ['UPDATING','unknown'], ['BootGuide','unknown'], ['FUTURE_STATE','unknown']]) {
  test('maps ' + devState + ' without enabling settings while busy', async () => {
    const {link} = await connected({period: {devState}});
    assert.equal(link.published[0].state, state);
    await assert.rejects(link.setRpm(900), {code: 'busy'});
    await link.disconnect();
  });
}

test('rejects malformed, out-of-order, excessive and invalid UTF-8 frames, then accepts a fresh message', async () => {
  const {host, link} = await connected();
  const initial = link.published.length;
  await link.emitBase64('this is not base64');
  for (const at of [0, 1, 4, 5, 6, 7]) {
    const frame = fragments(broadcast())[0]; frame[at] = 255; await link.emitPacket(frame);
  }
  const pieces = fragments(broadcast());
  await link.emitPacket(pieces[0]); await link.emitPacket(pieces[2]);
  for (const piece of pieces.slice(1)) await link.emitPacket(piece);
  await link.emit(broadcast(), {raw: Buffer.from([123,34,97,34,58,34,192,128,34,125])});
  await link.emit(broadcast(), {raw: Buffer.from([123,34,97,34,58,34,237,160,128,34,125])});
  await link.emit(broadcast(), {raw: Buffer.from('not JSON')});
  await link.emit(broadcast(), {raw: Buffer.from('[]')});
  await link.emitPacket([...pieces[0], ...new Array(512).fill(0)]);
  assert.equal(link.published.length, initial);
  await link.emit(broadcast({bladeGap: 12}));
  assert.equal(link.published.at(-1).observedSetting, '12');
  await link.disconnect(); assert.equal(host.clock.timers.size, 0);
});

test('valid UTF-8 may split between fragments; a new offset-zero message replaces the previous one', async () => {
  const {link} = await connected();
  const old = fragments(broadcast({bladeGap: 100})); await link.emitPacket(old[0]);
  await link.emit(broadcast({bladeGap: 200, extra: '咖啡 ☕ 😀'}), {size: 1, sequence: 65535});
  assert.equal(link.published.at(-1).observedSetting, '200');
  // Sequence values may be reused, and are not required to increase.
  await link.emit(broadcast({bladeGap: 201}), {sequence: 65535});
  await link.emit(broadcast({bladeGap: 202}), {sequence: 0});
  assert.equal(link.published.at(-1).observedSetting, '202'); await link.disconnect();
});

test('incomplete fragments expire after two seconds; invalid packets never refresh the stream watchdog', async () => {
  const {host, link} = await connected(); const before = link.published.length;
  const parts = fragments(broadcast({bladeGap: 123}));
  await link.emitPacket(parts[0]); await host.clock.tick(2001);
  for (const part of parts.slice(1)) await link.emitPacket(part);
  assert.equal(link.published.length, before);
  await link.emit(broadcast({bladeGap: null}));
  await link.emit(broadcast({grindRpm: -1}));
  await link.emit(broadcast({devState: ''}));
  await host.clock.tick(2999);
  assert.equal(link.reported, 1); assert.equal(host.clock.timers.size, 0);
  await link.emit(broadcast()); assert.equal(link.published.length, before);
});

test('stream watchdog resets on valid observations and diagnostics omit missing optional values', async () => {
  const {host, link, deviceId} = await connected();
  await host.clock.tick(4000);
  await link.emit({broadcast: {periodInfo: {devState:'IDLE', bladeGap:0, grindRpm:500}}});
  await host.clock.tick(4000); assert.equal(link.reported, 0);
  assert.equal((await host.http('status', {deviceId})).value.humidity, undefined);
  await host.clock.tick(1000); assert.equal(link.reported, 1);
  assert.equal((await host.http('status', {deviceId})).status, 503);
});

test('initialization fails on service/subscription mismatch or a missing handshake broadcast', async () => {
  for (const options of [{services: []}, {subscribeError: new Error('No notify')}, {autoHello: false}]) {
    const host = await load(), link = host.connect(host.create(), options);
    await flush(); await host.clock.tick(8000);
    await assert.rejects(link.connection); assert.equal(host.clock.timers.size, 0);
  }
});

test('stalled GATT subscription and readiness publication are bounded by initialization timeout', async () => {
  for (const options of [{subscriptionDelay: deferred().promise}, {publish: () => deferred().promise}]) {
    const host = await load(), link = host.connect(host.create(), options);
    await flush(); await host.clock.tick(8000);
    await assert.rejects(link.connection); assert.equal(host.clock.timers.size, 0);
  }
});

test('ambiguous business response timeout retires the session before any retry', async () => {
  const {host, link} = await connected({autoResponse: false});
  const work = link.setRpm(900), assertion = assert.rejects(work, {code: 'response_timeout'});
  await flush(); await host.clock.tick(4000); await link.emit(broadcast()); await host.clock.tick(2500);
  await assertion; assert.equal(link.reported, 1); assert.equal(host.clock.timers.size, 0);
  await assert.rejects(link.setRpm(1000), {code: 'stale_session'});
});

test('partial acknowledged write failures retire the session, and are never retried', async () => {
  let calls = 0;
  const {host, link} = await connected({write: async () => {if (++calls === 7) throw new Error('GATT write failed');}});
  await assert.rejects(link.setRpm(900), /GATT write failed/);
  assert.equal(link.reported, 1); assert.equal(host.clock.timers.size, 0);
  await assert.rejects(link.setRpm(900), {code: 'stale_session'});
});

test('four devices remain independent and exact public device IDs select settings', async () => {
  const host = await load();
  const drivers = Array.from({length: 4}, (_, i) => host.create(i));
  const links = drivers.map((driver, i) => host.connect(driver, {period: {bladeGap: i}}));
  await Promise.all(links.map(link => link.connection));
  for (let i = 0; i < 4; i++) {
    assert.equal((await host.http('status', {deviceId: drivers[i].deviceId})).value.bladeGap, i);
  }
  await Promise.all(links.map((link, i) => link.setRpm(600 + i)));
  for (let i = 0; i < 4; i++) assert.equal(links[i].requests[1].request.geneSetting.data.grindRpm, 600 + i);
  assert.equal((await host.http('status', {deviceId: 'aa:bb:0'})).status, 503);
  assert.equal((await host.http('status', {deviceId: 'plugin:other:motto80:aa:bb:0'})).status, 503);
  assert.equal((await host.http('configure', {deviceId: drivers[0].deviceId, method: 'GET'})).status, 405);
  assert.equal((await host.http('status', {deviceId: drivers[0].deviceId, method: 'POST'})).status, 405);
  await host.plugin.onUnload(); assert.equal(host.clock.timers.size, 0);
});

test('a failed last GATT write retires even if a business response arrived before the write rejected', async () => {
  const {host, link} = await connected({request: async (request, link) => {
    if (request.request.appHello) await link.emit({broadcast:{baseInfo:{releaseVer:102190820},periodInfo:period}});
    else {
      await link.emit({response:{geneSetting:{result:'success',data:request.request.geneSetting.data}}});
      throw new Error('Last write failed');
    }
  }});
  await assert.rejects(link.setRpm(900), /Last write failed/);
  assert.equal(link.reported, 1); assert.equal(host.clock.timers.size, 0);
  await assert.rejects(link.setRpm(1000), {code:'stale_session'});
});

test('a stalled settings write is cancelled by the bounded response deadline', async () => {
  let writes = 0;
  const {host, link} = await connected({write: () => {if (++writes === 6) return deferred().promise;}});
  const assertion = assert.rejects(link.setRpm(900), {code:'response_timeout'});
  await flush(); await host.clock.tick(4000); await link.emit(broadcast()); await host.clock.tick(2500);
  await assertion; assert.equal(link.reported, 1); assert.equal(host.clock.timers.size, 0);
});

test('link loss, deliberate disconnect and unload reject in-flight commands and fence late callbacks', async () => {
  for (const action of ['drop','disconnect','unload']) {
    const {host, link, deviceId} = await connected({autoResponse: false});
    const work = link.setRpm(900), assertion = assert.rejects(work);
    await flush(); const count = link.published.length;
    if (action === 'unload') host.plugin.onUnload(); else await link[action]();
    await assertion;
    await link.emit(broadcast({bladeGap: 12}));
    assert.equal(link.published.length, count); assert.equal(host.clock.timers.size, 0);
    assert.equal((await host.http('status', {deviceId})).status, 503);
  }
});

test('reconnect performs a fresh handshake and old session data cannot replace new observations', async () => {
  const host = await load(), driver = host.create(), first = host.connect(driver);
  await first.connection; await first.drop();
  const next = host.connect(driver, {period: {bladeGap: 700}}); await next.connection;
  await first.emit(broadcast({bladeGap: 12}));
  assert.equal((await host.http('status', {deviceId: driver.deviceId})).value.bladeGap, 700);
  assert.equal(next.requests[0].request.appHello.op, 'handshake');
  await next.disconnect();
});

test('plugin configuration validates timeout bounds', async () => {
  for (const value of [0, 999, 10001, 1.5, '5000', null]) await assert.rejects(load({PacketTimeoutMs: value}));
  const host = await load({PacketTimeoutMs: 1000}); const link = host.connect();
  await link.connection; await host.clock.tick(1000); assert.equal(link.reported, 1);
});

test('device settings page script parses and does not interpolate untrusted request text', async () => {
  const host = await load();
  const page = await host.http('device-settings', {deviceId: '<img src=x onerror=alert(1)>'});
  assert.equal(page.status, 200); assert.match(page.body, /Adjust the physical burr gap by hand/);
  assert.ok(!page.body.includes('<img src=x'));
  new vm.Script(page.body.match(/<script>([\s\S]*?)<\/script>/)[1]);
  assert.equal((await host.http('device-settings', {method:'POST'})).status, 405);
});
