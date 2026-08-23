/**
 * @file Thornweave reading client. Server mode fetches /story.json; offline
 * export mode reads window.__THORN_STORY__ and performs zero network requests.
 * Written against src/runtime/engine.js, src/render/html.js and
 * src/state/{model,persistence}.js; styling comes only from player/styles.
 */
import { Engine } from '../src/runtime/engine.js';
import { blocksToHtml, blocksToText } from '../src/render/html.js';
import { deepClone } from '../src/state/model.js';
import { SaveManager, RewindStack, Transcript, SLOT_COUNT } from '../src/state/persistence.js';

const OFFLINE = window.__THORN_OFFLINE__ === true;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
const SETTINGS_KEY = 'tw.settings';
const THEME_KEY = 'tw.theme';
const DEFAULT_SETTINGS = { timers: 'normal', reveal: false, fontSize: 19, lineHeight: 1.65, scroll: true };

const E = {};
let story = null;
let fingerprint = '';
let engine = null;
let state = null;
let lastRender = null;
let lastSection = null;
let rewindStack = null;
let transcriptLog = null;
let savesMgr = null;
let settings = { ...DEFAULT_SETTINGS };
let activeTimers = [];
let timerInt = null;
let fromServer = false;
let debugOn = false;
let debugBox = null;
let jumpSel = null;
let inspect = null;
let inspBody = null;
let varsDl = null;
let invUl = null;
let savesBox = null;
let autoRow = null;
let backBtn = null;

const storage = {
  get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* unavailable */ } },
  delete(k) { try { window.localStorage.removeItem(k); } catch { /* unavailable */ } },
  keys() { try { return Object.keys(window.localStorage); } catch { return []; } },
};

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function mkbtn(label, fn) {
  const b = el('button', 'btn');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function announce(msg) {
  E.live.textContent = '';
  window.setTimeout(() => { E.live.textContent = msg; }, 40);
}

function loadPrefs() {
  let stored = {};
  try { stored = JSON.parse(storage.get(SETTINGS_KEY) || '{}') || {}; } catch { stored = {}; }
  settings = {
    timers: ['off', 'normal', 'long'].includes(stored.timers) ? stored.timers : DEFAULT_SETTINGS.timers,
    reveal: typeof stored.reveal === 'boolean' ? stored.reveal : DEFAULT_SETTINGS.reveal,
    fontSize: clampInt(stored.fontSize, 16, 24, DEFAULT_SETTINGS.fontSize),
    lineHeight: clampStep(stored.lineHeight, 1.4, 2, 0.05, DEFAULT_SETTINGS.lineHeight),
    scroll: typeof stored.scroll === 'boolean' ? stored.scroll : DEFAULT_SETTINGS.scroll,
  };
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

function clampStep(v, lo, hi, step, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  const snapped = Math.round((n - lo) / step) * step + lo;
  return Math.min(hi, Math.max(lo, Math.round(snapped * 100) / 100));
}

function persistSettings() {
  storage.set(SETTINGS_KEY, JSON.stringify(settings));
}

function applyReaderCss() {
  document.documentElement.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--reader-line-height', String(settings.lineHeight));
}

function syncSettingsControls() {
  E.setTheme.value = document.documentElement.dataset.theme || 'light';
  E.setFont.value = String(settings.fontSize);
  E.outFont.textContent = `${settings.fontSize}px`;
  E.setLh.value = String(settings.lineHeight);
  E.outLh.textContent = Number(settings.lineHeight).toFixed(2);
  E.setReveal.checked = settings.reveal === true;
  if (E.setScroll) E.setScroll.checked = settings.scroll !== false;
  E.setTimers.value = settings.timers;
}

async function getPayload() {
  const injected = window.__THORN_STORY__;
  if (typeof injected === 'string') {
    fromServer = false;
    return JSON.parse(injected);
  }
  fromServer = true;
  const res = await fetch('/story.json');
  if (!res.ok) throw new Error(`story request failed (${res.status})`);
  return res.json();
}

function initSSE() {
  if (OFFLINE || !fromServer) return;
  try {
    const es = new EventSource('/events');
    es.addEventListener('reload', () => window.location.reload());
  } catch { /* SSE unavailable */ }
}

function loadingSection() {
  const sec = el('section', 'loading-state');
  sec.setAttribute('aria-label', 'Loading story');
  sec.appendChild(el('div'));
  sec.appendChild(el('div'));
  sec.appendChild(el('div'));
  return sec;
}

async function loadStory() {
  E.reader.replaceChildren(loadingSection());
  let pl = null;
  try {
    pl = await getPayload();
  } catch (err) {
    clearReader();
    showError(`The story could not be loaded. ${err && err.message ? err.message : ''}`, { retry: true });
    return;
  }
  if (!pl || pl.ok !== true || !pl.story) {
    clearReader();
    const diags = Array.isArray(pl && pl.diagnostics)
      ? pl.diagnostics
        .map((d) => `${d.severity}[${d.code}] ${d.message}${d.line != null ? ` (${d.line}:${d.col})` : ''}`)
        .join('\n')
      : 'unknown compiler error';
    showError(`The story failed to compile.\n${diags}`, { retry: true });
    return;
  }
  story = pl.story;
  fingerprint = pl.fingerprint || '';
  engine = new Engine(story);
  savesMgr = new SaveManager(storage);
  debugOn = pl.debug === true;
  document.title = (story.meta && story.meta.title) || 'Thornweave';
  buildStatusShell();
  if (debugOn) buildDebugArea();
  updateStatus();
  renderSaves();
  if (fromServer && !OFFLINE && document.body.dataset.sse === '1') initSSE();
  newGame();
}

function newGame(seed) {
  stopTimers();
  state = engine.newGame(seed);
  rewindStack = new RewindStack();
  transcriptLog = new Transcript();
  E.trList.replaceChildren();
  lastSection = null;
  lastRender = null;
  clearReader();
  let r = null;
  try {
    r = engine.start(state);
  } catch (err) {
    showError(String((err && err.message) || err));
    updateStatus();
    renderSaves();
    return;
  }
  renderTurn(r);
}

let sealedCount = 0;

function clearReader() {
  E.reader.replaceChildren();
  sealedCount = 0;
}

function sealHistory() {
  const kids = E.reader.children;
  for (; sealedCount < kids.length; sealedCount++) {
    const sec = kids[sealedCount];
    if (sec === lastSection) break;
    sec.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    sec.querySelectorAll('a.inline-link').forEach((a) => {
      const sp = document.createElement('span');
      sp.textContent = a.textContent;
      a.replaceWith(sp);
    });
  }
}

function buildSectionInto(sec, r) {
  sec.replaceChildren();
  const h2 = el('h2', 'sr-only');
  h2.tabIndex = -1;
  h2.textContent = r.passage;
  sec.appendChild(h2);
  sec.insertAdjacentHTML('beforeend', blocksToHtml(r.blocks, (i) => `#tw-choice-${i}`));
  if (settings.reveal) {
    sec.querySelectorAll('p, hr.scene-break').forEach((x) => x.classList.add('passage-fade'));
  }
  if (Array.isArray(r.choices) && r.choices.length > 0) {
    sec.appendChild(buildChoices(r.choices));
  }
}

function buildChoices(choices) {
  const nav = el('nav');
  nav.setAttribute('aria-label', 'Choices');
  const ol = el('ol');
  for (const c of choices) {
    const li = el('li');
    const b = el('button', 'choice');
    b.type = 'button';
    b.dataset.choice = String(c.i);
    b.dataset.num = String(c.i + 1);
    const taken = c.consumed || c.disabled;
    b.setAttribute('aria-label', `${c.i + 1}. ${c.label}${taken ? ' (already taken)' : ''}`);
    const labelSpan = document.createElement('span');
    labelSpan.textContent = c.label;
    b.appendChild(labelSpan);
    if (taken) {
      li.classList.add('choice--consumed');
      b.classList.add('choice--consumed');
      b.disabled = true;
      const note = el('span', 'sr-only');
      note.textContent = '(already taken)';
      b.appendChild(note);
    } else if (settings.timers !== 'off' && c.time > 0) {
      const tt = el('span', 'choice__timer-text');
      tt.textContent = `· ${Math.ceil(effSeconds(c.time))}s`;
      const tb = el('span', 'choice__timer-bar');
      tb.style.width = '100%';
      b.appendChild(tt);
      b.appendChild(tb);
    }
    li.appendChild(b);
    ol.appendChild(li);
  }
  nav.appendChild(ol);
  return nav;
}

function buildEndCard(passageName) {
  const sec = el('section', 'end-card');
  const h = el('h2');
  h.textContent = 'The End';
  const p = el('p', 'end-card__name');
  p.textContent = passageName;
  const acts = el('div', 'end-card__actions');
  acts.appendChild(mkbtn('Restart', restart));
  const sb = mkbtn('Step back', doRewindStep);
  sb.setAttribute('data-act', 'stepback');
  acts.appendChild(sb);
  acts.appendChild(mkbtn('Download transcript', downloadTranscript));
  sec.append(h, p, acts);
  return sec;
}

function renderTurn(r, opts = {}) {
  transcriptLog.passage(state.turn, r.passage);
  const suffix = opts.chose
    ? `chose \u201C${opts.chose}\u201D`
    : (opts.note ? `(${opts.note})` : null);
  addDrawerEntry(state.turn, r.passage, suffix);
  sealHistory();
  const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
  const sec = el('section', 'prose');
  sec.dataset.passage = r.passage;
  buildSectionInto(sec, r);
  E.reader.appendChild(sec);
  lastSection = sec;
  lastRender = r;
  if (r.ending) E.reader.appendChild(buildEndCard(r.passage));
  const text = blocksToText(r.blocks).replace(/\s+/g, ' ').trim().slice(0, 900);
  postNavigation(sec, nearBottom, `${r.passage}. ${text}`);
  startTimers(r);
  updateStatus();
  renderSaves();
  updateRewindButton();
  refreshInspector();
}

function postNavigation(sec, nearBottom, announcement) {
  if (nearBottom && settings.scroll !== false) {
    const top = sec.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top), behavior: REDUCED.matches ? 'auto' : 'smooth' });
  }
  const h = sec.querySelector('h2');
  if (h) h.focus({ preventScroll: true });
  announce(announcement);
}

function takeChoice(i) {
  if (!state || !lastRender) return;
  const c = (lastRender.choices || []).find((x) => x.i === i);
  if (!c) return;
  if (c.disabled || c.consumed) {
    notice('That choice has already been taken.');
    return;
  }
  doChoose(c, c.label);
}

function doChoose(choiceObj, label) {
  if (!state) return;
  rewindStack.push(deepClone(state), label || '');
  let r = null;
  try {
    r = engine.choose(state, choiceObj);
  } catch (err) {
    recoverFault(err);
    return;
  }
  stopTimers();
  transcriptLog.choice(state.turn, label || '', choiceObj.target);
  try {
    savesMgr.autosave(state, `${(story.meta && story.meta.title) || 'Story'} — ${r.passage}`);
  } catch { /* autosave is best-effort */ }
  renderTurn(r, { chose: label || choiceObj.target });
}

function recoverFault(err) {
  showError(String((err && err.message) || err));
  const snap = rewindStack.pop();
  if (snap) state = snap.state;
  stopTimers();
  updateStatus();
  renderSaves();
  updateRewindButton();
}

function effSeconds(t) {
  return settings.timers === 'long' ? t * 2 : t;
}

function startTimers(r) {
  stopTimers();
  if (!state || settings.timers === 'off' || !lastSection) return;
  const timed = (r.choices || []).filter((c) => c.time > 0 && !c.consumed && !c.disabled);
  if (timed.length === 0) return;
  for (const c of timed) {
    const total = effSeconds(c.time);
    const btn = lastSection.querySelector(`button.choice[data-choice="${c.i}"]`);
    activeTimers.push({
      index: c.i,
      id: c.id,
      total,
      remaining: total,
      textEl: btn ? btn.querySelector('.choice__timer-text') : null,
      barEl: btn ? btn.querySelector('.choice__timer-bar') : null,
    });
  }
  timerInt = window.setInterval(tickTimers, 1000);
  const soonest = timed.reduce((a, b) => (effSeconds(b.time) < effSeconds(a.time) ? b : a), timed[0]);
  window.setTimeout(() => {
    if (activeTimers.length > 0) {
      announce(`"${soonest.label}": ${Math.ceil(effSeconds(soonest.time))} seconds. When time runs out, the story moves on.`);
    }
  }, 900);
}

function tickTimers() {
  const expired = [];
  for (const t of activeTimers) {
    t.remaining -= 1;
    if (t.remaining <= 0) {
      expired.push(t);
      continue;
    }
    if (t.textEl) t.textEl.textContent = `· ${Math.ceil(t.remaining)}s`;
    if (t.barEl) t.barEl.style.width = `${Math.max(0, (t.remaining / t.total) * 100)}%`;
  }
  for (const t of expired) {
    const pos = activeTimers.indexOf(t);
    if (pos >= 0) activeTimers.splice(pos, 1);
    fireTimeout(t);
  }
}

function fireTimeout(t) {
  if (!state || !lastRender) return;
  const live = (lastRender.choices || []).find((c) => c.i === t.index && c.id === t.id);
  if (!live || live.disabled || live.consumed) return;
  const target = engine.timeoutTarget(live, lastRender);
  doChoose({ ...live, target }, live.label);
}

function stopTimers() {
  if (timerInt !== null) {
    window.clearInterval(timerInt);
    timerInt = null;
  }
  activeTimers = [];
}

function doRewindStep() {
  if (!rewindStack || rewindStack.size() === 0) {
    notice('Nothing to step back to.');
    return;
  }
  const prevTurn = state.turn;
  const snap = rewindStack.pop();
  transcriptLog.rewind(prevTurn);
  addDrawerEntry(prevTurn, '(stepped back)', null, true);
  state = snap.state;
  stopTimers();
  let r = null;
  try {
    r = dryRenderCurrent();
  } catch (err) {
    showError(String((err && err.message) || err));
    return;
  }
  clearReader();
  lastSection = null;
  lastRender = null;
  renderTurn(r);
}

function dryRenderCurrent() {
  const clone = deepClone(state);
  return engine.enter(clone, state.current, { dry: true });
}

function rerenderLastSection(r) {
  lastRender = r;
  stopTimers();
  if (!lastSection) return;
  const hadFocus = lastSection.contains(document.activeElement);
  buildSectionInto(lastSection, r);
  if (hadFocus) {
    const h = lastSection.querySelector('h2');
    if (h) h.focus({ preventScroll: true });
  }
  startTimers(r);
  updateStatus();
  renderSaves();
  refreshInspector();
}

function restart() {
  newGame(undefined);
}

function doSave(slot) {
  if (!state) return;
  try {
    savesMgr.save(slot, state, `${lastRender ? lastRender.passage : ''} (turn ${state.turn})`);
    renderSaves();
    notice(`Saved to slot ${slot}.`);
  } catch {
    notice('Saving failed in this browser.');
  }
}

function doLoad(slot) {
  let rec = null;
  try {
    rec = savesMgr.load(slot, fingerprint);
  } catch (err) {
    showError(String((err && err.message) || err));
    return;
  }
  if (!rec) {
    notice(`Slot ${slot} is empty.`);
    return;
  }
  state = rec.state;
  stopTimers();
  let r = null;
  try {
    r = dryRenderCurrent();
  } catch (err) {
    showError(String((err && err.message) || err));
    return;
  }
  clearReader();
  lastSection = null;
  lastRender = null;
  notice(`Loaded slot ${slot}.`);
  renderTurn(r);
}

function renderSaves() {
  if (!savesBox) return;
  savesBox.replaceChildren();
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const slot = String(i);
    let meta = null;
    try { meta = savesMgr.peek(slot); } catch { meta = null; }
    const row = el('div', 'nosave-row');
    const name = el('span');
    name.textContent = `Slot ${slot}`;
    const mid = el('span');
    if (meta) mid.textContent = `${meta.label || 'Save'} · ${formatWhen(meta.when)}`;
    else mid.appendChild(Object.assign(el('span', 'empty-label'), { textContent: 'Empty' }));
    const btns = el('span', 'drawer-actions');
    const saveB = mkbtn('Save', () => doSave(slot));
    saveB.disabled = !state;
    const loadB = mkbtn('Load', () => doLoad(slot));
    loadB.disabled = !engine;
    btns.append(saveB, loadB);
    row.append(name, mid, btns);
    savesBox.appendChild(row);
  }
  autoRow.replaceChildren();
  const an = el('span');
  an.textContent = 'Autosave';
  const am = el('span');
  let ameta = null;
  try { ameta = savesMgr.peek('autosave'); } catch { ameta = null; }
  if (ameta) am.textContent = `${ameta.label || 'Save'} · ${formatWhen(ameta.when)}`;
  else am.appendChild(Object.assign(el('span', 'empty-label'), { textContent: 'Empty' }));
  autoRow.append(an, am);
}

function formatWhen(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '?' : d.toLocaleString();
}

function fmtVal(v) {
  if (v === undefined || v === null) return '—';
  if (Array.isArray(v)) return v.map((x) => fmtVal(x)).join(', ');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function updateStatus() {
  if (!varsDl || !invUl) return;
  varsDl.replaceChildren();
  const showNames = (story && story.meta && Array.isArray(story.meta.show)) ? story.meta.show : [];
  for (const name of showNames) {
    const wrap = el('div');
    const dt = el('dt');
    dt.textContent = name;
    const dd = el('dd');
    dd.textContent = state ? fmtVal(state.vars[name]) : '—';
    wrap.append(dt, dd);
    varsDl.appendChild(wrap);
  }
  invUl.replaceChildren();
  const items = state
    ? Object.keys(state.inv).filter((k) => state.inv[k] > 0).sort()
    : [];
  if (items.length === 0) {
    const li = el('li');
    li.appendChild(Object.assign(el('span', 'empty-label'), { textContent: 'Nothing carried.' }));
    invUl.appendChild(li);
  } else {
    for (const k of items) {
      const li = el('li');
      const nm = el('span');
      nm.textContent = k;
      const ct = el('span', 'count');
      ct.textContent = `× ${state.inv[k]}`;
      li.append(nm, ct);
      invUl.appendChild(li);
    }
  }
}

function addDrawerEntry(turn, text, suffix, rewindStyle) {
  const li = el('li', 'transcript-entry' + (rewindStyle ? ' transcript-entry--rewind' : ''));
  li.textContent = `Turn ${turn} — ${text}${suffix ? ` — ${suffix}` : ''}`;
  E.trList.appendChild(li);
  while (E.trList.children.length > 400) E.trList.removeChild(E.trList.firstChild);
  E.trList.scrollTop = E.trList.scrollHeight;
}

function toggleDrawer(d) {
  const isOpen = d.style.display !== 'none';
  const opener = d === E.trDrawer ? E.tbTranscript : E.tbSettings;
  closeDrawers();
  if (!isOpen) {
    d.dataset.opener = '1';
    d.style.display = '';
    const first = d.querySelector('button, input, select');
    if (first) first.focus();
  } else if (opener) {
    opener.focus();
  }
}

function closeDrawers() {
  let reopen = null;
  for (const d of [E.trDrawer, E.setDrawer]) {
    if (d.style.display !== 'none' && d.dataset.opener === '1') {
      reopen = d === E.trDrawer ? E.tbTranscript : E.tbSettings;
    }
    d.style.display = 'none';
    delete d.dataset.opener;
  }
  if (reopen && document.activeElement !== reopen && !E.reader.contains(document.activeElement)) {
    reopen.focus();
  }
}

function anyDrawerOpen() {
  return E.trDrawer.style.display !== 'none' || E.setDrawer.style.display !== 'none';
}

function copyTranscript() {
  const txt = transcriptLog
    ? transcriptLog.text((story && story.meta && story.meta.title) || 'Thornweave')
    : '# Transcript\n(empty)\n';
  navigator.clipboard.writeText(txt).then(
    () => notice('Transcript copied to the clipboard.'),
    () => legacyCopy(txt),
  );
}

function legacyCopy(txt) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.className = 'sr-only';
  ta.setAttribute('readonly', '');
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  notice(ok ? 'Transcript copied to the clipboard.' : 'Copying is not available here.');
}

function downloadTranscript() {
  const txt = transcriptLog
    ? transcriptLog.text((story && story.meta && story.meta.title) || 'Thornweave')
    : '# Transcript\n(empty)\n';
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugTitle()}-transcript.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function slugTitle() {
  return ((story && story.meta && story.meta.title) || 'story')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'story';
}

function showError(message, opts = {}) {
  const sec = el('section', 'error-banner');
  sec.setAttribute('role', 'alert');
  const s = el('strong');
  s.textContent = 'Something went wrong.';
  sec.appendChild(s);
  sec.appendChild(document.createTextNode(` ${message}`));
  const acts = el('div', 'error-actions');
  if (opts.retry) acts.appendChild(mkbtn('Try again', () => loadStory()));
  if (rewindStack && rewindStack.size() > 0 && state) {
    const sb = mkbtn('Step back', doRewindStep);
    sb.setAttribute('data-act', 'stepback');
    acts.appendChild(sb);
  }
  acts.appendChild(mkbtn('Dismiss', () => sec.remove()));
  sec.appendChild(acts);
  E.reader.prepend(sec);
}

function updateRewindButton() {
  if (backBtn) backBtn.disabled = !rewindStack || rewindStack.size() === 0;
  E.reader.querySelectorAll('[data-act="stepback"]').forEach((b) => {
    b.disabled = !rewindStack || rewindStack.size() === 0;
  });
}

function passageNames() {
  if (story && Array.isArray(story.order) && story.order.length > 0) return story.order;
  return story ? Object.keys(story.passages) : [];
}

function buildDebugArea() {
  debugBox = el('div');
  const hd = el('div', 'status-heading');
  hd.textContent = 'Debug';
  const lbl = el('label', 'transcript-entry');
  lbl.textContent = 'Jump to passage ';
  jumpSel = el('select');
  for (const name of passageNames()) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    jumpSel.appendChild(o);
  }
  lbl.appendChild(jumpSel);
  inspect = el('details');
  const sum = el('summary');
  sum.textContent = 'State inspector';
  inspBody = el('div');
  inspect.append(sum, inspBody);
  debugBox.append(hd, lbl, inspect);
  E.statusBody.appendChild(debugBox);
  jumpSel.addEventListener('change', () => doJump(jumpSel.value));
}

function refreshInspector() {
  if (!debugOn || !inspBody || !state) return;
  const open = inspect.open;
  inspBody.replaceChildren();
  const jp = el('p', 'transcript-entry');
  const code = el('code');
  code.textContent = JSON.stringify(
    { vars: state.vars, inv: state.inv, consumed: state.consumed },
    null,
    1,
  );
  jp.appendChild(code);
  inspBody.appendChild(jp);
  for (const key of Object.keys(state.vars)) {
    inspBody.appendChild(varRow(key));
  }
  inspect.open = open;
}

function varRow(key) {
  const row = el('p', 'transcript-entry');
  const nm = el('strong');
  nm.textContent = key;
  row.appendChild(nm);
  row.appendChild(document.createTextNode(' '));
  const typeSel = el('select');
  for (const t of ['number', 'string', 'boolean', 'list']) {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    typeSel.appendChild(o);
  }
  typeSel.value = state.vtypes[key] || typeof state.vars[key];
  const input = document.createElement('input');
  input.type = 'text';
  input.value = Array.isArray(state.vars[key]) ? JSON.stringify(state.vars[key]) : String(state.vars[key]);
  input.setAttribute('aria-label', `Value for ${key}`);
  const setB = mkbtn('Set', () => applyVar(key, typeSel.value, input.value));
  row.append(typeSel, input, setB);
  return row;
}

function applyVar(key, type, raw) {
  let v = null;
  try {
    if (type === 'number') {
      v = Number(raw);
      if (!Number.isFinite(v)) throw new Error('not a number');
    } else if (type === 'boolean') {
      v = ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
    } else if (type === 'list') {
      v = JSON.parse(raw);
      if (!Array.isArray(v)) throw new Error('not a list');
    } else {
      v = raw;
    }
  } catch {
    notice(`Could not read '${key}' as ${type}.`);
    return;
  }
  state.vars[key] = v;
  state.vtypes[key] = type;
  notice(`Set ${key}.`);
  let r = null;
  try {
    r = dryRenderCurrent();
  } catch (err) {
    recoverFault(err);
    return;
  }
  rerenderLastSection(r);
}

function doJump(name) {
  if (!story.passages[name]) {
    notice('No such passage.');
    return;
  }
  rewindStack.push(deepClone(state), 'debug jump');
  let r = null;
  try {
    r = engine.enter(state, name);
  } catch (err) {
    recoverFault(err);
    return;
  }
  stopTimers();
  renderTurn(r, { note: 'debug jump' });
}

function activateByNumber(n) {
  if (!lastSection) return;
  const b = lastSection.querySelector(`ol button.choice[data-num="${n}"]`);
  if (b && !b.disabled) b.click();
}

function bindEvents() {
  E.reader.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    const hit = e.target.closest('a.inline-link, button.choice');
    if (!hit || !state) return;
    const sec = hit.closest('section');
    if (sec !== lastSection) return;
    e.preventDefault();
    takeChoice(Number(hit.dataset.choice));
  });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (e.key === 'Escape') {
      if (anyDrawerOpen()) {
        closeDrawers();
        e.preventDefault();
      }
      return;
    }
    const ae = document.activeElement;
    const tag = ae ? ae.tagName : '';
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ae && ae.isContentEditable);
    if (e.ctrlKey || e.metaKey || e.altKey || editing) return;
    if (/^[1-9]$/.test(e.key)) activateByNumber(Number(e.key));
    else if (e.key === 'b' || e.key === 'B') doRewindStep();
    else if (e.key === 't' || e.key === 'T') toggleDrawer(E.trDrawer);
    else if (e.key === 'g' || e.key === 'G') toggleDrawer(E.setDrawer);
    else if (e.key === 's' || e.key === 'S') E.statusDetails.open = !E.statusDetails.open;
  });

  E.trCopy.addEventListener('click', copyTranscript);
  E.trDownload.addEventListener('click', downloadTranscript);
  E.trClose.addEventListener('click', () => toggleDrawer(E.trDrawer));
  E.setClose.addEventListener('click', () => toggleDrawer(E.setDrawer));

  E.setForm.addEventListener('submit', (e) => e.preventDefault());
  E.setTheme.addEventListener('change', () => {
    document.documentElement.dataset.theme = E.setTheme.value;
    storage.set(THEME_KEY, E.setTheme.value);
  });
  E.setFont.addEventListener('input', () => {
    settings.fontSize = clampInt(E.setFont.value, 16, 24, 19);
    E.outFont.textContent = `${settings.fontSize}px`;
    applyReaderCss();
    persistSettings();
  });
  E.setLh.addEventListener('input', () => {
    settings.lineHeight = clampStep(E.setLh.value, 1.4, 2, 0.05, 1.65);
    E.outLh.textContent = settings.lineHeight.toFixed(2);
    applyReaderCss();
    persistSettings();
  });
  E.setReveal.addEventListener('change', () => {
    settings.reveal = E.setReveal.checked;
    persistSettings();
  });
  if (E.setScroll) {
    E.setScroll.addEventListener('change', () => {
      settings.scroll = E.setScroll.checked;
      persistSettings();
    });
  }
  E.setTimers.addEventListener('change', () => {
    settings.timers = ['off', 'normal', 'long'].includes(E.setTimers.value) ? E.setTimers.value : 'normal';
    persistSettings();
    if (lastRender && (lastRender.choices || []).some((c) => c.time > 0)) {
      let r = null;
      try { r = dryRenderCurrent(); } catch { r = lastRender; }
      if (r === lastRender) {
        stopTimers();
        if (lastSection) buildSectionInto(lastSection, r);
      } else {
        rerenderLastSection(r);
      }
    }
  });
}

function buildStatusShell() {
  E.statusBody.replaceChildren();
  const bar = el('div', 'drawer-actions');
  backBtn = mkbtn('Step back', doRewindStep);
  backBtn.id = 'tb-back';
  backBtn.setAttribute('data-act', 'stepback');
  E.tbTranscript = mkbtn('Transcript', () => toggleDrawer(E.trDrawer));
  E.tbSettings = mkbtn('Settings', () => toggleDrawer(E.setDrawer));
  bar.append(backBtn, E.tbTranscript, E.tbSettings);

  const hVars = el('div', 'status-heading');
  hVars.textContent = 'Status';
  varsDl = el('dl', 'status-vars');

  const hInv = el('div', 'status-heading');
  hInv.textContent = 'Inventory';
  invUl = el('ul', 'status-inventory');

  const hSaves = el('div', 'status-heading');
  hSaves.textContent = 'Saves';
  savesBox = el('div');
  autoRow = el('div', 'nosave-row');

  E.statusBody.append(bar, hVars, varsDl, hInv, invUl, hSaves, savesBox, autoRow);
  updateRewindButton();
}

function cacheEls() {
  E.reader = document.getElementById('reader');
  E.statusDetails = document.getElementById('status-details');
  E.statusBody = document.getElementById('status-body');
  E.trDrawer = document.getElementById('transcript-drawer');
  E.trList = document.getElementById('transcript-list');
  E.trCopy = document.getElementById('tr-copy');
  E.trDownload = document.getElementById('tr-download');
  E.trClose = document.getElementById('tr-close');
  E.setDrawer = document.getElementById('settings-drawer');
  E.setForm = document.getElementById('settings-form');
  E.setTheme = document.getElementById('set-theme');
  E.setFont = document.getElementById('set-fontsize');
  E.outFont = document.getElementById('out-fontsize');
  E.setLh = document.getElementById('set-lineheight');
  E.outLh = document.getElementById('out-lineheight');
  E.setReveal = document.getElementById('set-reveal');
  E.setScroll = document.getElementById('set-scroll');
  E.setTimers = document.getElementById('set-timers');
  E.setClose = document.getElementById('set-close');
  E.live = document.getElementById('live-region');
}

const notice = announce;

function init() {
  cacheEls();
  savesMgr = new SaveManager(storage);
  loadPrefs();
  applyReaderCss();
  syncSettingsControls();
  bindEvents();
  buildStatusShell();
  updateStatus();
  renderSaves();
  loadStory();
}

try {
  init();
} catch (err) {
  const main = document.getElementById('reader');
  if (main) {
    const sec = el('section', 'error-banner');
    sec.setAttribute('role', 'alert');
    sec.textContent = `The player failed to start: ${(err && err.message) || err}`;
    main.appendChild(sec);
  }
}
