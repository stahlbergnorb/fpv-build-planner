// More tab: saved builds, sharing, data updates, install, about.

import { CLASS_BY_ID, STORES } from '../classes.js';
import { shareUrl, changeSaved, sanitizeBuild, sanitizeOptions, buildIsSaved, buildHasParts, validateAgainst } from '../state.js';
import { loadDB, loadCatalog, checkForUpdates } from '../data.js';
import { newBuild } from '../build.js';
import { esc, toast, safeUrl } from './dom.js';

let checking = false;
let draftName = '';

// Ask before discarding a build that isn't in the saved list.
function okToReplace() {
  return !buildHasParts() || buildIsSaved() || confirm('Your current build isn\'t saved. Replace it anyway?');
}

function repoLinks() {
  // On GitHub Pages (user.github.io/repo/) derive the repo URL for the update workflow.
  const m = /^([\w-]+)\.github\.io$/.exec(location.hostname);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  if (!m || !repo) return null;
  const base = `https://github.com/${m[1]}/${repo}`;
  return { base, workflow: `${base}/actions/workflows/update-data.yml` };
}

export function render(app) {
  const { saved } = app.state;
  const meta = app.db.meta;
  const repo = repoLinks();
  const counts = Object.entries(app.db.byCat).map(([k, v]) => `${v.length} ${k}`).join(' · ');
  return `<section class="more">
    <div class="card">
      <h2>Saved builds</h2>
      <div class="row">
        <input id="save-name" type="text" placeholder="Name this build" maxlength="60" value="${esc(draftName)}" data-in="m-name" aria-label="Build name">
        <button class="btn" data-act="m-save">Save current</button>
      </div>
      ${saved.length ? `<ul class="saved">${saved.map((b) => `
        <li><div><strong>${esc(b.name)}</strong><br><span class="small muted">${esc(CLASS_BY_ID[b.build.classId]?.label || '')} · ${esc(new Date(b.t).toLocaleDateString())}</span></div>
          <div class="row"><button class="btn small" data-act="m-load" data-t="${esc(b.t)}">Load</button><button class="btn small ghost" data-act="m-del" data-t="${esc(b.t)}">Delete</button></div></li>`).join('')}</ul>`
        : '<p class="muted small">No saved builds yet. Builds are stored on this device.</p>'}
      <div class="row wrap">
        <button class="btn ghost" data-act="m-share">Copy share link</button>
        <button class="btn ghost" data-act="m-export">Export builds (JSON)</button>
        <button class="btn ghost" data-act="m-import-pick">Import builds</button>
        <input id="import-file" type="file" accept="application/json,.json" data-in="m-import" hidden>
        <button class="btn ghost" data-act="m-new">New empty build</button>
      </div>
    </div>

    <div class="card">
      <h2>Parts data</h2>
      <p>${app.db.parts.length} parts (${esc(counts)}).</p>
      <p class="small muted">Data version ${esc(app.db.version || '?')} · prices checked ${meta?.prices_checked ? esc(new Date(meta.prices_checked).toLocaleString()) : 'unknown'}.</p>
      <div class="row wrap">
        <button class="btn" data-act="m-update" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check for data update'}</button>
        ${repo ? `<a class="btn ghost" href="${safeUrl(repo.workflow)}" target="_blank" rel="noopener">Run price update on GitHub</a>` : ''}
      </div>
      <p class="small muted">Prices and the store catalog refresh automatically on the 1st of every month via GitHub Actions. The Cost and Search tabs can also pull live prices from the Shopify stores at any time.</p>
    </div>

    <div class="card">
      <h2>Install</h2>
      ${app.installPrompt ? '<button class="btn" data-act="m-install">Install app</button>'
        : '<p class="small">Install from your browser menu: <strong>Add to Home Screen</strong> (iOS Safari: Share → Add to Home Screen) or the install icon in Chrome/Edge\'s address bar. Works offline once installed.</p>'}
    </div>

    <div class="card">
      <h2>About</h2>
      <p class="small">Parts, specs and prices come from ${Object.values(STORES).map((s) => `<a href="${safeUrl(s.base)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(', ')}, manufacturer spec sheets and <a href="https://www.fpvknowitall.com" target="_blank" rel="noopener">FPVKnowItAll</a>'s buyer's guides. Performance numbers are model estimates; compatibility checks cover common issues but always confirm with the manufacturer before buying.</p>
      ${repo ? `<p class="small"><a href="${safeUrl(repo.base)}" target="_blank" rel="noopener">Source on GitHub</a></p>` : ''}
    </div>
  </section>`;
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const byTime = (app, t) => app.state.saved.find((b) => String(b.t) === String(t));

export const actions = {
  'm-save'(el, ev, app) {
    const name = draftName.trim() || `${CLASS_BY_ID[app.state.build.classId]?.short || ''} build ${app.state.saved.length + 1}`.trim();
    const entry = { name, t: Date.now(), build: { ...app.state.build }, options: { ...app.state.options } };
    const ok = changeSaved((list) => [entry, ...list]);
    if (ok) { draftName = ''; toast(`Saved "${name}"`); } else toast('Couldn\'t save — this browser is blocking storage (private mode?)');
  },
  'm-load'(el, ev, app) {
    const b = byTime(app, el.dataset.t);
    if (!b || !okToReplace()) return;
    app.update((s) => { s.build = sanitizeBuild(b.build, app.db); s.options = sanitizeOptions(b.options); s.tab = 'build'; });
    toast(`Loaded "${b.name}"`);
  },
  'm-del'(el, ev, app) {
    const b = byTime(app, el.dataset.t);
    if (!b || !confirm(`Delete "${b.name}"?`)) return;
    changeSaved((list) => list.filter((x) => String(x.t) !== String(b.t)));
  },
  'm-new'(el, ev, app) {
    if (!okToReplace()) return;
    app.update((s) => { s.build = newBuild(s.build.classId); s.tab = 'build'; });
  },
  'm-import-pick'() { document.getElementById('import-file')?.click(); },
  async 'm-share'() {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); toast('Share link copied'); } catch { prompt('Copy this link:', url); }
  },
  'm-export'(el, ev, app) {
    download('fpv-builds.json', JSON.stringify({ app: 'fpv-build-planner', saved: app.state.saved, current: { build: app.state.build, options: app.state.options } }, null, 2));
  },
  async 'm-update'(el, ev, app) {
    checking = true;
    app.render();
    try {
      const { newer, meta } = await checkForUpdates(app.db.version);
      if (newer) {
        const db = await loadDB(true);
        if (db.version !== meta.version) {
          toast('The parts download didn\'t finish — try again on a better connection');
        } else {
          app.db = db;
          validateAgainst(app.db);
          await loadCatalog(true).catch(() => null);
          toast(`Updated parts data (${meta.version})`);
        }
      } else {
        toast('You have the latest data');
      }
    } catch (e) {
      toast(navigator.onLine === false ? 'You\'re offline — try again when connected' : `Update check failed: ${e.message}`);
    }
    checking = false;
    app.render();
  },
  async 'm-install'(el, ev, app) {
    app.installPrompt.prompt();
    await app.installPrompt.userChoice.catch(() => null);
    app.installPrompt = null;
    app.render();
  },
};

export const inputs = {
  'm-name'(el) { draftName = el.value; },
  'm-import'(el, ev, app) {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((txt) => {
      const data = JSON.parse(txt);
      const list = (Array.isArray(data.saved) ? data.saved : [])
        .filter((b) => b && typeof b === 'object' && b.build && typeof b.build === 'object')
        .map((b, i) => ({
          name: String(b.name || 'Imported build').slice(0, 80),
          t: Date.now() + i,
          build: sanitizeBuild(b.build, app.db),
          options: sanitizeOptions(b.options),
        }));
      if (!list.length) throw new Error('no builds found');
      if (!changeSaved((cur) => [...list, ...cur])) throw new Error('storage is blocked');
      toast(`Imported ${list.length} build${list.length > 1 ? 's' : ''}`);
    }).catch((e) => toast(`Import failed: ${e.message}`));
    el.value = '';
  },
};
