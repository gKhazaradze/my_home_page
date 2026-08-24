/* Speed Tracker — toggle on to record, toggle off to stop. */
(() => {
  'use strict';

  // ---------- tuning ----------
  const MIN_ACCURACY_M   = 35;   // ignore fixes worse than this for distance
  const MIN_STEP_M       = 2;    // ignore sub-2m jitter between fixes
  const MAX_PLAUSIBLE_MS = 90;   // 324 km/h — anything faster is a GPS glitch
  const MOVING_MS        = 0.7;  // ~2.5 km/h — below this you count as stopped
  const STALE_MS         = 8000; // no fix for this long -> show 0
  const ANCHOR_HOLD_S    = 10;   // give up holding a rejected anchor after this
  const SMOOTHING        = 0.4;  // EMA weight for the live readout

  const UNITS = {
    kmh: { speed: 3.6,      sLabel: 'km/h', dist: 0.001,        dLabel: 'km' },
    mph: { speed: 2.2369363, sLabel: 'mph',  dist: 0.000621371, dLabel: 'mi' },
  };

  const KEY = { sessions: 'st.sessions', unit: 'st.unit', active: 'st.active' };

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    toggle: $('toggle'), toggleText: $('toggleText'), status: $('status'),
    speedNow: $('speedNow'), speedUnit: $('speedUnit'), gaugeFill: $('gaugeFill'),
    avgSpeed: $('avgSpeed'), avgUnit: $('avgUnit'), movingAvg: $('movingAvg'),
    maxSpeed: $('maxSpeed'), distance: $('distance'), duration: $('duration'),
    movingTime: $('movingTime'), accuracy: $('accuracy'), unitBtn: $('unitBtn'),
    hint: $('hint'), historyWrap: $('historyWrap'), historyList: $('historyList'),
    clearBtn: $('clearBtn'),
  };

  // ---------- state ----------
  let unit = load(KEY.unit, 'kmh');
  if (!UNITS[unit]) unit = 'kmh';

  let recording = false;
  let watchId = null;
  let ticker = null;
  let wakeLock = null;

  let s = blank();          // live session accumulator
  let last = null;          // previous accepted fix
  let displaySpeed = 0;     // smoothed m/s for the big number
  let lastFixAt = 0;
  let pendingResume = false;   // set when boot finds an interrupted session

  function blank() {
    return { startedAt: 0, endedAt: 0, distance: 0, movingMs: 0, maxSpeed: 0, samples: 0 };
  }

  // ---------- storage ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (_) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }
  function drop(key) { try { localStorage.removeItem(key); } catch (_) {} }

  // ---------- geo math ----------
  function haversine(a, b) {
    const R = 6371000, toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad;
    const dLon = (b.lon - a.lon) * toRad;
    const la1 = a.lat * toRad, la2 = b.lat * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // ---------- formatting ----------
  const u = () => UNITS[unit];
  const fmtSpeed = (ms, dp = 1) => (ms * u().speed).toFixed(dp);
  const fmtDist  = (m) => {
    const v = m * u().dist;
    return v < 10 ? v.toFixed(2) : v.toFixed(1);
  };
  function fmtClock(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }
  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
           d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // ---------- derived ----------
  const elapsedMs = () => (s.startedAt ? (s.endedAt || Date.now()) - s.startedAt : 0);
  const avgOf = (dist, ms) => (ms > 1000 ? dist / (ms / 1000) : 0);

  // ---------- render ----------
  function render() {
    const stale = !recording || (Date.now() - lastFixAt > STALE_MS);
    const now = stale ? 0 : displaySpeed;

    el.speedNow.textContent = fmtSpeed(now);
    el.speedUnit.textContent = u().sLabel;
    el.avgUnit.textContent = u().sLabel;
    el.unitBtn.textContent = u().sLabel;

    el.avgSpeed.textContent  = fmtSpeed(avgOf(s.distance, elapsedMs()));
    el.movingAvg.textContent = fmtSpeed(avgOf(s.distance, s.movingMs));
    el.maxSpeed.textContent  = fmtSpeed(s.maxSpeed);
    el.distance.textContent  = fmtDist(s.distance);
    el.duration.textContent  = fmtClock(elapsedMs());
    el.movingTime.textContent = fmtClock(s.movingMs);

    // gauge scales in steps so the needle stays readable at any pace
    const shown = now * u().speed;
    const peak = Math.max(s.maxSpeed * u().speed, shown);
    const scale = peak <= 30 ? 30 : peak <= 60 ? 60 : peak <= 120 ? 120 : 240;
    const pct = Math.min(1, shown / scale);
    el.gaugeFill.style.strokeDashoffset = String(270 - 270 * pct);
    // the round line cap would otherwise leave a stray dot at a standstill
    el.gaugeFill.style.opacity = pct > 0.002 ? '1' : '0';
  }

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---------- position handling ----------
  function onPosition(pos) {
    if (!recording) return;
    const c = pos.coords;
    const t = pos.timestamp || Date.now();
    lastFixAt = Date.now();

    el.accuracy.textContent = c.accuracy != null ? `±${Math.round(c.accuracy)} m` : '—';

    const fix = { lat: c.latitude, lon: c.longitude, t, acc: c.accuracy == null ? 999 : c.accuracy };

    // Getting a first fix can take a while. Start the clock when GPS actually
    // arrives, so the wait doesn't drag the average down.
    if (s.samples === 0) s.startedAt = Date.now();

    // Prefer the GPS Doppler speed; fall back to distance/time between fixes.
    let speed = (typeof c.speed === 'number' && isFinite(c.speed) && c.speed >= 0) ? c.speed : null;
    let dt = 0;
    let advanceAnchor = true;   // whether this fix becomes the point we measure from next

    if (last) {
      dt = (fix.t - last.t) / 1000;
      if (dt > 0 && dt < 60) {
        const step = haversine(last, fix);
        const implied = step / dt;
        const accurate = fix.acc <= MIN_ACCURACY_M && last.acc <= MIN_ACCURACY_M;
        const plausible = implied <= MAX_PLAUSIBLE_MS;

        if (accurate && plausible && step >= MIN_STEP_M) {
          s.distance += step;
          if (speed === null) speed = implied;
        } else {
          // Below the jitter floor, or an implausible jump: hold the old anchor so
          // slow movement still adds up and one glitch doesn't eat the next leg.
          if (!plausible || step < MIN_STEP_M) advanceAnchor = dt > ANCHOR_HOLD_S;
          if (speed === null) speed = 0;
        }
      } else {
        dt = 0;
      }
    }

    if (speed === null) speed = 0;
    if (speed > MAX_PLAUSIBLE_MS) speed = 0;

    displaySpeed = s.samples === 0 ? speed : displaySpeed + SMOOTHING * (speed - displaySpeed);
    if (displaySpeed > s.maxSpeed) s.maxSpeed = displaySpeed;
    if (dt > 0 && speed >= MOVING_MS) s.movingMs += dt * 1000;

    s.samples++;
    if (advanceAnchor || !last) last = fix;

    setStatus(fix.acc > MIN_ACCURACY_M ? `Weak GPS signal (±${Math.round(fix.acc)} m)` : 'Recording', 'live');
    save(KEY.active, { s, last });
    render();
  }

  function onError(err) {
    const msg = {
      1: 'Location permission denied — enable it in your browser settings.',
      2: 'Position unavailable. Try moving somewhere with a clearer sky view.',
      3: 'Timed out waiting for a GPS fix…',
    }[err.code] || 'Location error.';
    setStatus(msg, err.code === 3 ? '' : 'error');
    if (err.code === 1) stop();
  }

  // ---------- wake lock ----------
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) { /* not fatal */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  // ---------- start / stop ----------
  function start(resumed) {
    if (recording) return;
    if (!('geolocation' in navigator)) {
      setStatus('This browser has no geolocation support.', 'error');
      return;
    }
    if (!window.isSecureContext) {
      setStatus('Needs HTTPS (or localhost) for location access.', 'error');
      return;
    }

    recording = true;
    if (!resumed) { s = blank(); s.startedAt = Date.now(); last = null; }
    s.endedAt = 0;
    displaySpeed = 0;
    lastFixAt = 0;

    el.toggle.classList.add('on');
    el.toggle.setAttribute('aria-pressed', 'true');
    el.toggleText.textContent = 'Stop recording';
    el.hint.textContent = 'Recording. Averages update with every GPS fix.';
    setStatus('Waiting for GPS fix…');

    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 20000,
    });
    ticker = setInterval(render, 1000);
    acquireWakeLock();
    save(KEY.active, { s, last });
    render();
  }

  function stop() {
    if (!recording) return;
    recording = false;
    s.endedAt = Date.now();

    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (ticker) { clearInterval(ticker); ticker = null; }
    releaseWakeLock();
    drop(KEY.active);

    el.toggle.classList.remove('on');
    el.toggle.setAttribute('aria-pressed', 'false');
    el.toggleText.textContent = 'Start recording';
    el.hint.textContent = 'Tap start and allow location access. Keep the screen on for best results.';

    const ms = elapsedMs();
    if (s.samples > 1 && ms > 5000) {
      const sessions = load(KEY.sessions, []);
      sessions.unshift({
        startedAt: s.startedAt, endedAt: s.endedAt, durationMs: ms,
        movingMs: s.movingMs, distance: s.distance, maxSpeed: s.maxSpeed,
        avgSpeed: avgOf(s.distance, ms), movingAvg: avgOf(s.distance, s.movingMs),
      });
      save(KEY.sessions, sessions.slice(0, 50));
      renderHistory();
      setStatus('Session saved');
    } else {
      setStatus('Session too short to save');
    }
    render();
  }

  // ---------- history ----------
  function renderHistory() {
    const sessions = load(KEY.sessions, []);
    el.historyWrap.hidden = sessions.length === 0;
    el.historyList.innerHTML = '';
    for (const x of sessions) {
      const li = document.createElement('li');
      const date = document.createElement('span');
      date.className = 'h-date';
      date.textContent = fmtDate(x.startedAt);
      const avg = document.createElement('span');
      avg.className = 'h-avg';
      avg.textContent = `${fmtSpeed(x.avgSpeed)} ${u().sLabel}`;
      const meta = document.createElement('span');
      meta.className = 'h-meta';
      meta.textContent = `${fmtDist(x.distance)} ${u().dLabel} · ${fmtClock(x.durationMs)} · max ${fmtSpeed(x.maxSpeed, 0)}`;
      li.append(date, avg, meta);
      el.historyList.appendChild(li);
    }
  }

  // ---------- events ----------
  el.toggle.addEventListener('click', () => {
    if (recording) { stop(); return; }
    start(pendingResume);
    pendingResume = false;
  });

  el.unitBtn.addEventListener('click', () => {
    unit = unit === 'kmh' ? 'mph' : 'kmh';
    save(KEY.unit, unit);
    render();
    renderHistory();
  });

  el.clearBtn.addEventListener('click', () => {
    if (confirm('Delete all saved sessions?')) { drop(KEY.sessions); renderHistory(); }
  });

  // Re-acquire the wake lock when coming back from the lock screen / another tab.
  document.addEventListener('visibilitychange', () => {
    if (recording && document.visibilityState === 'visible') acquireWakeLock();
  });

  // ---------- boot ----------
  const stash = load(KEY.active, null);
  if (stash && stash.s && stash.s.startedAt) {
    s = Object.assign(blank(), stash.s);
    last = stash.last || null;
    pendingResume = true;
    el.toggleText.textContent = 'Resume recording';
    setStatus('Recovered an unfinished session — tap resume to keep going');
  }

  renderHistory();
  render();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
