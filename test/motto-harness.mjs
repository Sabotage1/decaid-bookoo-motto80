import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Clock, deferred, flush, plain} from './harness.mjs';

export {deferred, flush, plain};
export const SERVICE = '4d543830-0001-4b80-8f00-424f4f4b4f4f';
export const RX = '4d543830-0002-4b80-8f00-424f4f4b4f4f';
export const TX = '4d543830-0003-4b80-8f00-424f4f4b4f4f';
export const sourceUrl = new URL('../bookoo-motto80.reaplugin/plugin.js', import.meta.url);
export const period = {feedingRpm: 65, bladeGap: 500, grindRpm: 700, humidity: 25,
  devState: 'IDLE', netState: 'CONNECTED', totalGrinds: 120, cupDetect: true,
  autoStop: true, fastClean: true, brightness: 5, standbySec: 60, selectPreset: -1};
export const broadcast = (extra = {}) => ({broadcast: {periodInfo: {...period, ...extra}}});
export function fragments(value, {sequence = 7, size = 12, raw} = {}) {
  const data = raw ?? Buffer.from(JSON.stringify(value), 'utf8');
  return Array.from({length: Math.ceil(data.length / size)}, (_, i) => {
    const header = Buffer.alloc(8), offset = i * size;
    header[0] = 165; header[1] = 1;
    header.writeUInt16LE(sequence & 65535, 2);
    header.writeUInt16LE(data.length, 4); header.writeUInt16LE(offset, 6);
    return [...Buffer.concat([header, data.subarray(offset, offset + size)])];
  });
}

// The public QuickJS BLE bridge is unmodified. Only its Dart/GATT boundary is
// simulated; assert Grinder snapshot types/capabilities at that boundary.
export async function load(settings = {}) {
  const clock = new Clock(), logs = [], handlers = new Map(), links = [], factories = [];
  const context = vm.createContext({
    pluginId: 'bookoo-motto80.reaplugin', pluginGeneration: 1,
    pluginBridgeToken: 'test', __deviceNonce: 'test', __deviceSeq: 0,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    __deviceSetHandlers: (handle, entry) => handlers.set(handle, entry),
    __deviceRemoveHandlers: handle => handlers.delete(handle),
    __deviceCall: async (type, payload) => {
      if (type === 'bindDriver') {
        assert.equal(payload.driverId, 'motto80'); factories.push(handlers.get(payload.registrationHandle)); return {};
      }
      const link = links.find(item => item.handle === payload.registrationHandle &&
        (payload.authority ? item.authority === payload.authority : item.domainSession === payload.session));
      if (!link || link.retired || payload.authority && payload.authority !== link.authority) throw new Error('Retired authority');
      if (type === 'gatt') {
        if (payload.operation === 'discoverServices') return {value: link.options.services ?? [SERVICE]};
        const {args} = payload;
        assert.equal(args.service, SERVICE);
        if (payload.operation === 'subscribe') {
          assert.equal(args.characteristic, TX);
          link.listener = args.listener;
          if (link.options.subscribeError) throw link.options.subscribeError;
          await link.options.duringSubscribe?.(link);
          await link.options.subscriptionDelay;
          return {value: {subscription: link.handle}};
        }
        if (payload.operation === 'write') {
          assert.equal(args.characteristic, RX); assert.equal(args.withResponse, true);
          await link.write(args.data); return {value: null};
        }
      }
      assert.equal(payload.session, link.domainSession);
      if (type === 'blePublish') {
        const value = plain(payload.snapshot);
        assert.ok(['idle', 'grinding', 'error', 'unknown'].includes(value.state));
        assert.deepEqual(Object.keys(value).sort(), ['observedRpm', 'observedSetting', 'rpm', 'state']);
        assert.equal(typeof value.observedSetting, 'string');
        assert.ok(Number.isInteger(value.rpm) && value.rpm >= 0);
        assert.ok(Number.isInteger(value.observedRpm) && value.observedRpm >= 0);
        await link.options.publish?.(value);
        link.published.push(value); return {};
      }
      if (type === 'bleDisconnected') {link.reported++; return {};}
      throw new Error('Unexpected operation: ' + type);
    }
  });
  vm.runInContext(readFileSync(new URL('./fixtures/decaid-v0.9.0-ble-bridge.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(sourceUrl, 'utf8'), context);
  const plugin = context.createPlugin({log: message => logs.push(message), devices: {
    bindDriver: vm.runInContext('__bindBleDriver', context)}});
  await plugin.onLoad(settings);
  function create(index = links.length) {
    const handle = 'physical-' + index;
    const deviceId = 'plugin:bookoo-motto80.reaplugin:motto80:aa:bb:' + index;
    factories[0].handlers.create({registrationHandle: handle, device: {
      id: deviceId, name: 'BOOKOO MT80 1234567' + index,
      advertisement: {name: 'BOOKOO MT80 1234567' + index, nameComplete: true, serviceUuids: [], servicesComplete: true}
    }});
    const entry = handlers.get(handle);
    return {handle, deviceId, entry};
  }
  function connect(driver = create(), options = {}) {
    let inbound = [], total, next = 0;
    const link = {handle: driver.handle, driver, options, authority: 'live-' + links.length,
      domainSession: 'domain-' + links.length, writes: [], requests: [], published: [], reported: 0, retired: false,
      async write(encoded) {
        const bytes = [...Buffer.from(encoded, 'base64')];
        link.writes.push(bytes);
        assert.ok(bytes.length <= 20 && bytes.length > 8);
        await options.write?.(bytes, link);
        const offset = bytes[6] + 256 * bytes[7];
        if (!offset) {inbound = []; total = bytes[4] + 256 * bytes[5]; next = 0;}
        assert.equal(offset, next); inbound.push(...bytes.slice(8)); next = inbound.length;
        if (inbound.length !== total) return;
        const request = JSON.parse(Buffer.from(inbound).toString('utf8')); link.requests.push(request);
        if (options.request) await options.request(request, link);
        else if (request.request.appHello && options.autoHello !== false) {
          await link.emit({broadcast: {baseInfo: {releaseVer: options.firmware ?? 102190820, snCode: 'PRIVATE', wifiName: 'PRIVATE'}, periodInfo: {...period, ...options.period}}});
        } else if (request.request.geneSetting && options.autoResponse !== false) {
          await link.emit({response: {geneSetting: {result: 'success', data: request.request.geneSetting.data}}});
        }
      },
      emitPacket(bytes) {return driver.entry.handlers.bleEvent({session: link.authority,
        type: 'notification', listener: link.listener, data: Buffer.from(bytes).toString('base64')});},
      emitBase64(data) {return driver.entry.handlers.bleEvent({session: link.authority,
        type: 'notification', listener: link.listener, data});},
      async emit(value, options) {for (const bytes of fragments(value, options)) await link.emitPacket(bytes);},
      async waitForRequests(count) {
        for (let i = 0; i < 500 && link.requests.length < count; i++) await Promise.resolve();
        assert.equal(link.requests.length, count, 'Expected a completed request');
      },
      async drop() {link.retired = true; await driver.entry.handlers.bleEvent({session: link.authority, type: 'disconnect'});},
      async disconnect() {await driver.entry.handlers.disconnect({gattSession: 'cleanup'}); await link.drop();},
      setRpm: value => driver.entry.handlers.setRpm(value)
    };
    links.push(link);
    const transport = driver.entry.connectTransport('connect', {gattSession: link.authority, session: link.domainSession});
    link.connection = driver.entry.handlers.connect(transport); link.connection.catch(() => {});
    return link;
  }
  async function http(endpoint, {method = endpoint === 'configure' ? 'POST' : 'GET', deviceId, body} = {}) {
    const result = await plugin.handleHttpRequest({endpoint, method, query: {deviceId}, body});
    return {...plain(result), value: result.headers['Content-Type'] === 'application/json' ? JSON.parse(result.body) : result.body};
  }
  return {clock, logs, context, plugin, create, connect, links, http};
}

export async function connected(options = {}, settings = {}) {
  const host = await load(settings), driver = host.create(), link = host.connect(driver, options);
  await link.connection;
  return {host, driver, link, deviceId: driver.deviceId};
}
