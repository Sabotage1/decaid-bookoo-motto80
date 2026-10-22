// Copyright (C) 2026 Roy Ackerman.
// SPDX-License-Identifier: GPL-3.0-or-later

function createPlugin(host) {
  "use strict";

  const id = "bookoo-motto80.reaplugin";
  const service = "4d543830-0001-4b80-8f00-424f4f4b4f4f";
  const rx = "4d543830-0002-4b80-8f00-424f4f4b4f4f";
  const tx = "4d543830-0003-4b80-8f00-424f4f4b4f4f";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const sessions = new Set();
  const devices = new Map();
  const limits = {feedingRpm: [10, 65], grindRpm: [500, 1500], brightness: [1, 5],
    standbySec: [60, 900], selectPreset: [-1, 9]};
  const switches = ["cupDetect", "autoStop", "fastClean"];
  let unloaded = false, packetTimeout = 5000;

  function failure(message, code = "invalid_argument") {return Object.assign(new Error(message), {code});}
  function stale() {return failure("Motto 80 is not connected", "stale_session");}
  function object(value) {return value !== null && typeof value === "object" && !Array.isArray(value);}
  function integer(value, min, max) {return Number.isInteger(value) && value >= min && value <= max;}
  function own(value, key) {return Object.prototype.hasOwnProperty.call(value, key);}
  function decodeBase64(encoded) {
    if (typeof encoded !== "string" || encoded.length < 12 || encoded.length > 684 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
    const bytes = [];
    for (let i = 0; i < encoded.length; i += 4) {
      const a = alphabet.indexOf(encoded[i]), b = alphabet.indexOf(encoded[i + 1]);
      const c = alphabet.indexOf(encoded[i + 2]), d = alphabet.indexOf(encoded[i + 3]);
      bytes.push((a << 2) | (b >> 4));
      if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2));
      if (d >= 0) bytes.push(((c & 3) << 6) | d);
    }
    return bytes;
  }
  // QuickJS has neither TextEncoder/TextDecoder nor Node's Buffer. Decode strictly:
  // replacement characters must not turn malformed UTF-8 into an accepted message.
  function utf8(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length;) {
      const first = bytes[i++];
      if (first < 128) {text += String.fromCharCode(first); continue;}
      let count, code, minimum;
      if (first >= 194 && first <= 223) {count = 1; code = first & 31; minimum = 128;}
      else if (first >= 224 && first <= 239) {count = 2; code = first & 15; minimum = 2048;}
      else if (first >= 240 && first <= 244) {count = 3; code = first & 7; minimum = 65536;}
      else throw failure("Invalid UTF-8");
      if (i + count > bytes.length) throw failure("Incomplete UTF-8");
      while (count--) {
        const next = bytes[i++];
        if (next < 128 || next > 191) throw failure("Invalid UTF-8 continuation");
        code = code * 64 + (next & 63);
      }
      if (code < minimum || code > 1114111 || code >= 55296 && code <= 57343) throw failure("Invalid UTF-8 code point");
      text += String.fromCodePoint(code);
    }
    return text;
  }
  function clearFragments(state) {
    clearTimeout(state.fragmentTimer);
    state.fragmentTimer = null;
    state.fragment = null;
  }
  function message(state, encoded) {
    const bytes = decodeBase64(encoded);
    if (!bytes || bytes.length <= 8 || bytes.length > 512 || bytes[0] !== 165 || bytes[1] !== 1) {
      clearFragments(state); return null;
    }
    const sequence = bytes[2] + bytes[3] * 256;
    const total = bytes[4] + bytes[5] * 256, offset = bytes[6] + bytes[7] * 256;
    if (!integer(total, 1, 4096) || offset + bytes.length - 8 > total) {clearFragments(state); return null;}
    if (offset === 0) {clearFragments(state); state.fragment = {sequence, total, bytes: []};}
    const fragment = state.fragment;
    if (!fragment || fragment.sequence !== sequence || fragment.total !== total || fragment.bytes.length !== offset) {
      clearFragments(state); return null;
    }
    fragment.bytes.push(...bytes.slice(8));
    clearTimeout(state.fragmentTimer);
    if (fragment.bytes.length !== total) {
      state.fragmentTimer = setTimeout(() => clearFragments(state), 2000);
      return null;
    }
    clearFragments(state);
    try {const decoded = JSON.parse(utf8(fragment.bytes)); return object(decoded) ? decoded : null;}
    catch (_) {return null;}
  }
  function stop(state, error = stale()) {
    if (!state || state.stopped) return;
    state.stopped = true;
    state.ready = false;
    clearFragments(state);
    clearTimeout(state.initializationTimer);
    clearTimeout(state.packetTimer);
    if (state.pending) {clearTimeout(state.pending.timer); state.pending.reject(error); state.pending = null;}
    state.rejectReady(error);
    state.end(error);
    sessions.delete(state);
    if (devices.get(state.deviceId) === state) devices.delete(state.deviceId);
  }
  function report(state, error) {
    if (state.stopped) return;
    stop(state, error);
    host.log("[bookoo-motto80] " + error.message);
    state.session.reportDisconnected().catch(() => {});
  }
  function live(state, promise) {
    if (state.stopped) return Promise.reject(stale());
    return Promise.race([promise, state.ended.then(error => {throw error;})]);
  }
  function publish(state, snapshot) {
    const result = state.publications.then(() => {
      if (state.stopped) throw stale();
      return live(state, state.session.publish(snapshot));
    });
    state.publications = result.catch(() => {});
    return result;
  }
  async function send(state, value) {
    // Requests contain only ASCII keys and numeric/boolean values. Keep complete
    // writes at 20 bytes so the default ATT MTU (23) is sufficient on every OS.
    const json = JSON.stringify(value), sequence = state.sequence++ & 65535;
    if (!json.length || json.length > 4096 || /[^\x00-\x7f]/.test(json)) throw failure("Invalid outgoing request");
    for (let offset = 0; offset < json.length; offset += 12) {
      if (state.stopped) throw stale();
      const header = [165, 1, sequence & 255, sequence >> 8, json.length & 255, json.length >> 8,
        offset & 255, offset >> 8];
      await live(state, state.session.gatt.writeWithResponse(service, rx,
        btoa(String.fromCharCode(...header) + json.slice(offset, offset + 12))));
    }
  }
  function configuration(data) {
    if (!object(data) || !Object.keys(data).length) throw failure("Supply at least one grinder setting");
    for (const key of Object.keys(data)) {
      if (own(limits, key)) {
        if (!integer(data[key], ...limits[key])) throw failure(key + " is outside the supported integer range");
      } else if (!switches.includes(key) || typeof data[key] !== "boolean") {
        throw failure("Unsupported or invalid setting: " + key);
      }
    }
    return {...data};
  }
  function configure(state, data) {
    const values = configuration(data);
    if (!state || state.stopped || !state.ready) return Promise.reject(stale());
    // There is no request/response correlation id. Permit exactly one business
    // request, including its response, at a time; do not confuse sequence with id.
    if (state.busy) return Promise.reject(failure("A grinder setting is still being applied", "busy"));
    if (!state.baseInfo || state.baseInfo.releaseVer < 102190820) {
      return Promise.reject(failure("Firmware v1.2.19.0820 or later must be confirmed before changing settings", "unsupported_firmware"));
    }
    if (state.periodInfo.devState.toUpperCase() !== "IDLE") {
      return Promise.reject(failure("Wait until the grinder is idle before changing settings", "busy"));
    }
    state.busy = true;
    const work = (async () => {
      let resolve, reject;
      const response = new Promise((yes, no) => {resolve = yes; reject = no;});
      response.catch(() => {});
      state.pending = {values, resolve, reject, timer: setTimeout(() => report(state,
        failure("Grinder settings response timed out; reconnect before retrying", "response_timeout")), 6500)};
      let sent = false;
      try {
        await send(state, {request: {geneSetting: {op: "set", data: values}}});
        sent = true;
        return await live(state, response);
      } catch (error) {
        // A partial write or ambiguous timeout cannot be retried in this session:
        // a delayed response has no operation id and might acknowledge a new write.
        if (!state.stopped && (!sent || state.pending)) report(state, failure("Grinder settings write failed", "transport_error"));
        throw error;
      } finally {
        if (state.pending) {clearTimeout(state.pending.timer); state.pending = null;}
        state.busy = false;
      }
    })();
    return work;
  }
  async function notification(state, encoded) {
    if (state.stopped || !state.handshake) return;
    const value = message(state, encoded);
    if (!value) return;
    const broadcast = value.broadcast;
    if (object(broadcast)) {
      const base = broadcast.baseInfo;
      if (object(base) && integer(base.releaseVer, 0, 2147483647)) {
        state.baseInfo = {releaseVer: base.releaseVer};
        if (base.releaseVer < 102190820) {
          const error = failure("Motto 80 firmware v1.2.19.0820 or later is required", "unsupported_firmware");
          if (state.ready) report(state, error); else stop(state, error);
          return;
        }
      }
      const period = broadcast.periodInfo;
      if (object(period) && typeof period.devState === "string" && period.devState.trim().length &&
          period.devState.length <= 80 && integer(period.bladeGap, 0, 999) && integer(period.grindRpm, 500, 1500)) {
        const status = period.devState.toUpperCase();
        const snapshot = {state: status === "IDLE" ? "idle" : ["GRINDING", "HIGHSPEEDCLEAN", "HIGH_SPEED_CLEAN"].includes(status)
          ? "grinding" : status === "WARNING" ? "error" : "unknown",
        observedSetting: String(period.bladeGap), observedRpm: period.grindRpm, rpm: period.grindRpm};
        const info = {devState: period.devState, bladeGap: period.bladeGap, grindRpm: period.grindRpm};
        for (const key of Object.keys(limits)) if (integer(period[key], ...limits[key])) info[key] = period[key];
        for (const key of switches) if (typeof period[key] === "boolean") info[key] = period[key];
        if (integer(period.humidity, 0, 100)) info.humidity = period.humidity;
        if (integer(period.totalGrinds, 0, Number.MAX_SAFE_INTEGER)) info.totalGrinds = period.totalGrinds;
        state.periodInfo = info;
        clearTimeout(state.packetTimer);
        state.packetTimer = setTimeout(() => report(state,
          failure("Motto 80 notification stream timed out", "packet_timeout")), packetTimeout);
        try {
          await publish(state, snapshot);
          if (state.stopped) return;
          state.resolveReady();
        } catch (error) {report(state, error); throw error;}
      }
    }
    if (state.stopped) return;
    const result = object(value.response) && value.response.geneSetting;
    if (!object(result) || !state.pending) return;
    const pending = state.pending;
    if (result.result === "fail") {
      state.pending = null;
      clearTimeout(pending.timer);
      const error = object(result.error) ? result.error : {};
      pending.reject(failure("Grinder rejected settings" + (typeof error.code === "string" ? ": " + error.code.slice(0,80) : ""), "device_rejected"));
    } else if (result.result === "success" && object(result.data) &&
        Object.keys(pending.values).every(key => result.data[key] === pending.values[key])) {
      // Broadcasts remain the source of live state. Never synthesize telemetry
      // from a successful write; setting acceptance is distinct from motor RPM.
      state.pending = null;
      clearTimeout(pending.timer);
      pending.resolve({...pending.values});
    }
  }
  function response(status, value) {
    return {status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}, body: JSON.stringify(value)};
  }
  function current(deviceId) {
    const state = devices.get(deviceId);
    if (!state || state.stopped || !state.ready) throw stale();
    return state;
  }

  return {
    id, version: "0.1.0",
    onLoad(values) {
      const timeout = values && values.PacketTimeoutMs !== undefined ? values.PacketTimeoutMs : 5000;
      if (!integer(timeout, 1000, 10000)) throw failure("PacketTimeoutMs must be an integer between 1000 and 10000");
      packetTimeout = timeout;
      unloaded = false;
      return host.devices.bindDriver("motto80", {
        create(device) {
          let active;
          // Decaid passes the full public plugin ID, including normalized BLE ID.
          const deviceId = device.id;
          return {
            async connect(session) {
              if (unloaded) throw stale();
              if (active && !active.stopped) throw failure("Motto 80 is already connected", "busy");
              let resolveReady, rejectReady, end;
              const readiness = new Promise((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
              readiness.catch(() => {});
              const state = {session, deviceId, name: device.name, stopped: false, ready: false,
                resolveReady, rejectReady, ended: new Promise(resolve => {end = resolve;}), end,
                sequence: 0, publications: Promise.resolve(), baseInfo: null, periodInfo: null};
              active = state;
              sessions.add(state);
              devices.set(deviceId, state);
              state.initializationTimer = setTimeout(() => stop(state,
                failure("Motto 80 handshake timed out", "initialization_timeout")), 8000);
              try {
                session.gatt.onDisconnect(() => stop(state, failure("Motto 80 Bluetooth link lost", "link_lost")));
                const services = await live(state, session.gatt.discoverServices());
                if (!services.includes(service)) throw failure("Motto 80 Custom GATT service unavailable", "protocol_mismatch");
                await live(state, session.gatt.subscribe(service, tx, encoded => notification(state, encoded)));
                if (state.stopped) throw stale();
                state.handshake = true;
                await send(state, {request: {appHello: {op: "handshake"}}});
                await live(state, readiness);
                if (state.stopped) throw stale();
                clearTimeout(state.initializationTimer);
                state.ready = true;
              } catch (error) {stop(state, error); throw error;}
            },
            async disconnect() {stop(active);},
            setRpm(rpm) {return configure(active, {grindRpm: rpm}).then(() => undefined);}
          };
        }
      });
    },
    onUnload() {unloaded = true; for (const state of sessions) stop(state);},
    async handleHttpRequest(request) {
      const method = request.method, endpoint = request.endpoint;
      if (endpoint === "device-settings") {
        if (method !== "GET") return response(405, {error: "Use GET"});
        return {status: 200, headers: {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}, body: mottoSettingsPage()};
      }
      if (endpoint !== "status" && endpoint !== "configure") return response(404, {error: "Unknown endpoint"});
      if (endpoint === "status" && method !== "GET" || endpoint === "configure" && method !== "POST") return response(405, {error: "Method not allowed"});
      try {
        const state = current(request.query && request.query.deviceId);
        if (endpoint === "status") return response(200, {deviceId: state.deviceId, name: state.name,
          firmware: state.baseInfo && state.baseInfo.releaseVer, writable: !!state.baseInfo,
          busy: !!state.busy, ...state.periodInfo});
        if (!object(request.body) || Object.keys(request.body).some(key => key !== "settings")) throw failure("Supply a settings object");
        const applied = await configure(state, request.body.settings);
        return response(200, {applied});
      } catch (error) {
        return response(error.code === "stale_session" ? 503 : error.code === "busy" ? 409 : error.code === "invalid_argument" ? 400 : 502,
          {error: error.message, code: error.code || "device_error"});
      }
    }
  };
}

function mottoSettingsPage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motto 80 settings</title><style>
:root{color-scheme:light dark;font:17px system-ui,sans-serif;background:#151918;color:#f3f4ef}*{box-sizing:border-box}
body{max-width:680px;margin:0 auto;padding:28px 20px 48px}h1{font-size:28px;margin:8px 0}p{line-height:1.5;color:#bcc9c3}
section,form{background:#202824;border:1px solid #38483f;border-radius:16px;padding:20px;margin:20px 0}
dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0}dt{color:#bcc9c3}dd{margin:0;text-align:right}
label{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:18px 0;line-height:1.4}
input,select,button{font:inherit;border-radius:8px;min-height:44px;border:1px solid #697b70;padding:8px;background:#151918;color:inherit}
input[type=number],select{width:120px}input[type=checkbox]{width:26px;height:26px;accent-color:#b8e7b1}button{cursor:pointer;font-weight:600}
button[type=submit]{width:100%;background:#b8e7b1;color:#142218;border:0}button:disabled{opacity:.45;cursor:default}
#message{min-height:1.5em}fieldset{border:0;padding:0;margin:0}a{color:#b8e7b1}:focus-visible{outline:3px solid #b8e7b1;outline-offset:3px}
</style><body><h1>Motto 80</h1><p id="name">Connect your grinder in Decaid to view settings.</p>
<section><dl><dt>Burr gap</dt><dd id="gap">—</dd><dt>Grinding speed</dt><dd id="rpm">—</dd><dt>State</dt><dd id="state">—</dd><dt>Firmware</dt><dd id="firmware">—</dd><dt>Humidity</dt><dd id="humidity">—</dd><dt>Total grinds</dt><dd id="count">—</dd></dl></section>
<p>Adjust the physical burr gap by hand on the grinder. Start and stop grinding using the grinder's controls.</p>
<form id="form"><fieldset id="fields" disabled><label>Grinding speed (RPM)<input name="grindRpm" type="number" min="500" max="1500" step="1" required></label>
<label>Feeder speed (RPM)<input name="feedingRpm" type="number" min="10" max="65" step="1" required></label>
<label>Brightness<input name="brightness" type="number" min="1" max="5" step="1" required></label>
<label>Standby delay (seconds)<input name="standbySec" type="number" min="60" max="900" step="1" required></label>
<label>Mode / preset<select name="selectPreset"><option value="-1">N mode</option>${Array.from({length:10}, (_,i) => '<option value="'+i+'">Preset '+(i+1)+'</option>').join("")}</select></label>
<label>Cup detection<input name="cupDetect" type="checkbox"></label><label>Automatic stop<input name="autoStop" type="checkbox"></label>
<label>Fast residual clearing<input name="fastClean" type="checkbox"></label><button type="submit">Apply changes</button></fieldset></form>
<button id="refresh" type="button">Refresh readings</button><p id="message" role="status" aria-live="polite"></p>
<script>
"use strict";
const deviceId = new URLSearchParams(location.search).get("deviceId");
const form = document.getElementById("form"), fields = document.getElementById("fields"), message = document.getElementById("message");
const numeric = ["grindRpm","feedingRpm","brightness","standbySec","selectPreset"], switches = ["cupDetect","autoStop","fastClean"];
let baseline = null, saving = false;
function text(id, value) {document.getElementById(id).textContent = value;}
function firmware(version) {return version == null ? "Unknown" : "v" + Math.floor(version / 100000000) + "." + Math.floor(version / 1000000) % 100 + "." + Math.floor(version / 10000) % 100 + "." + String(version % 10000).padStart(4,"0");}
async function api(endpoint, options) {
  if (!deviceId) throw new Error("Open this page from the grinder's Settings action in Decaid.");
  const res = await fetch("/api/v1/plugins/bookoo-motto80.reaplugin/" + endpoint + "?deviceId=" + encodeURIComponent(deviceId), options);
  const value = await res.json(); if (!res.ok) throw new Error(value.error || "Unable to reach grinder"); return value;
}
async function refresh(updateForm = true) {
  fields.disabled = true;
  try {
    const value = await api("status");
    text("name",value.name); text("gap",value.bladeGap + " µm"); text("rpm",value.grindRpm + " RPM"); text("state",value.devState);
    text("firmware",firmware(value.firmware));
    text("humidity",value.humidity == null ? "—" : value.humidity + "%"); text("count",value.totalGrinds == null ? "—" : value.totalGrinds);
    if (updateForm) {
      baseline = {};
      for (const key of numeric) {form.elements[key].value = value[key] == null ? "" : value[key]; form.elements[key].disabled = value[key] == null; baseline[key] = value[key];}
      for (const key of switches) {form.elements[key].checked = value[key] === true; form.elements[key].disabled = typeof value[key] !== "boolean"; baseline[key] = value[key];}
    }
    fields.disabled = saving || !value.writable || value.devState.toUpperCase() !== "IDLE" || value.busy;
    if (fields.disabled && !saving) message.textContent = !value.writable ? "Confirm supported firmware before changing settings." : "Wait until the grinder is idle.";
  } catch (error) {message.textContent = error.message; throw error;}
}
document.getElementById("refresh").onclick = () => {if (!saving) refresh().then(() => {if (!fields.disabled) message.textContent = "Readings refreshed.";}).catch(() => {});};
form.onsubmit = async event => {
  event.preventDefault(); if (saving || !baseline) return;
  const settings = {};
  for (const key of numeric) {if (form.elements[key].disabled) continue; const value = Number(form.elements[key].value); if (value !== baseline[key]) settings[key] = value;}
  for (const key of switches) {if (form.elements[key].disabled) continue; const value = form.elements[key].checked; if (value !== baseline[key]) settings[key] = value;}
  if (!Object.keys(settings).length) {message.textContent = "No changes to apply."; return;}
  saving = true; fields.disabled = true; message.textContent = "Applying changes…";
  try {await api("configure",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({settings})});
    Object.assign(baseline, settings); message.textContent = "Changes accepted by the grinder. Refresh to read its current values.";
  } catch (error) {message.textContent = error.message;}
  finally {saving = false; await refresh(false).catch(() => {});}
};
refresh().catch(() => {});
</script></body></html>`;
}
