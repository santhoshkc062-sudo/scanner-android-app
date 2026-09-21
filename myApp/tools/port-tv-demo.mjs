#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   port-tv-demo.mjs — turn a pasted standalone HTML page into Angular files.

     node tools/port-tv-demo.mjs

   Drop a complete page (doctype, <head>, <style>, <script>) into
   src/app/app.html the way you have been, then run this. It splits the page
   three ways, because an Angular component template can hold only one of the
   three parts:

     <style> …    →  src/styles.css              (global — a component
                                                  stylesheet is rewritten to
                                                  match only that component's
                                                  own elements, so :root,
                                                  html, body and the chrome
                                                  the page appends to <body>
                                                  would all stop matching)
     <body> …     →  src/app/app.html            (the markup, and nothing else)
     <script> …   →  src/app/tv-demo.ts          (Angular DROPS <script> from a
                                                  template — it never runs, and
                                                  that is why the board comes up
                                                  empty)

   It also re-applies the four device edits to the loop engine: the stage turns
   a quarter turn on a portrait screen, the keyboard hint reads TAP/SWIPE on a
   touchscreen, and touch gestures are routed back through the same keydown
   handler the keyboard uses. Each one reports whether it matched — if the
   engine changes upstream and a patch stops matching, you get a warning here
   rather than a board that quietly behaves wrong on a phone.

   The pasted page is copied to _backup/ first, every time.
   Running it on an already-split app.html does nothing.
   ══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_HTML = ROOT + '/src/app/app.html';
const STYLES = ROOT + '/src/styles.css';
const DEMO_TS = ROOT + '/src/app/tv-demo.ts';
const INDEX = ROOT + '/src/index.html';
const BACKUP = ROOT + '/_backup';

const say = (...a) => console.log(...a);
const warn = (...a) => console.warn('  ! ' + a.join(' '));

/* ── read, and bail out if this has already been done ───────────────────── */
const raw = readFileSync(APP_HTML, 'utf8');
if (!/<html[\s>]/i.test(raw) && !/<body[\s>]/i.test(raw)) {
  say('src/app/app.html is already a component template — nothing to split.');
  say('Paste a full page into it first, then run this again.');
  process.exit(0);
}

/* ── back the pasted page up before touching anything ───────────────────── */
if (!existsSync(BACKUP)) mkdirSync(BACKUP);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = `${BACKUP}/app.html.pasted-${stamp}`;
writeFileSync(backupPath, raw);
say(`backed the pasted page up to _backup/app.html.pasted-${stamp}`);

/* ── split ──────────────────────────────────────────────────────────────── */
const grab = (tag, from) => {
  const m = from.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*)</${tag}>`, 'i'));
  return m ? m[1] : '';
};
const head = grab('head', raw);
const body = grab('body', raw) || raw;

const STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

const styleBlocks = [...head.matchAll(STYLE_RE), ...body.matchAll(STYLE_RE)].map((m) => m[1]);
const scriptBlocks = [...body.matchAll(SCRIPT_RE), ...head.matchAll(SCRIPT_RE)].map((m) => m[1]);

const external = [...raw.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
const linked = [...head.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)].map((m) => m[0]);

const markup = body
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .trim();

const pageTitle = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();

say(`found ${styleBlocks.length} style block(s), ${scriptBlocks.length} script block(s), ` +
    `${markup.length} bytes of markup`);
if (pageTitle) say(`page <title> was: ${pageTitle}  (src/index.html carries the real one)`);
if (external.length) warn('external <script src> dropped — add it to angular.json or npm i:', external.join(', '));
if (linked.length) warn(`${linked.length} <link rel=stylesheet> dropped — add to angular.json "styles"`);
if (!markup) { console.error('  ✗ no markup found in <body>; refusing to write empty files'); process.exit(1); }

/* ── the four device edits, applied to whichever block is the engine ────── */
const isEngine = (s) => /function fit\s*\(/.test(s) && /addEventListener\('resize', fit\)/.test(s);
const engineIndex = scriptBlocks.findIndex(isEngine);

const patches = [
  {
    name: 'fit() turns the stage on a portrait panel',
    find: /( *)function fit\(\) \{\s*var s = Math\.min\(window\.innerWidth \/ 1920, window\.innerHeight \/ 1080\);\s*stage\.style\.transform = 'translate\(-50%, -50%\) scale\(' \+ s \+ '\)';\s*\}\s*window\.addEventListener\('resize', fit\);\s*fit\(\);/,
    to: `$1/* Turn the board a quarter turn when the panel is taller than it is wide.
$1   Unrotated, a 16:9 stage on a phone or a portrait-mounted screen shrinks to
$1   a strip with two thirds of the glass left black. Nothing in the loop is
$1   pointer-driven, so the rotation costs nothing. Set false for a panel that
$1   is genuinely portrait-first. */
$1var ROTATE_IN_PORTRAIT = true;

$1function fit() {
$1    /* visualViewport, not innerHeight: on Android the URL bar and the
$1       on-screen keyboard move the former and not always the latter. */
$1    var vv = window.visualViewport;
$1    var w = (vv && vv.width)  || window.innerWidth;
$1    var h = (vv && vv.height) || window.innerHeight;
$1    var turn = ROTATE_IN_PORTRAIT && h > w;
$1    var s = turn ? Math.min(h / 1920, w / 1080)
$1                 : Math.min(w / 1920, h / 1080);
$1    stage.style.transform = 'translate(-50%, -50%)'
$1                          + (turn ? ' rotate(90deg)' : '')
$1                          + ' scale(' + s + ')';
$1    document.body.classList.toggle('turned', turn);
$1}
$1window.addEventListener('resize', fit);
$1window.addEventListener('orientationchange', fit);
$1if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
$1fit();`,
  },
  {
    name: 'the keyboard hint reads TAP/SWIPE on a touchscreen',
    find: /( *)var framed = window\.top !== window\.self;/,
    to: `$1/* A touchscreen has no SPACE and no arrow keys, and a hint naming them is
$1   worse than none: it says the board cannot be driven at all. */
$1var touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
$1if (touch) hint.innerHTML = 'TAP pause &middot; SWIPE scene';

$1var framed = window.top !== window.self;`,
  },
  {
    name: 'the paused wording follows the same fork',
    find: /( *)hint\.textContent = paused \? 'PAUSED — SPACE to resume'\s*\n\s*: 'SPACE pause · ← → scene · F fullscreen';/,
    to: `$1hint.textContent = paused
$1    ? (touch ? 'PAUSED — TAP to resume' : 'PAUSED — SPACE to resume')
$1    : (touch ? 'TAP pause · SWIPE scene' : 'SPACE pause · ← → scene · F fullscreen');`,
  },
];

const TOUCH_BLOCK = `
    /* ══ the same three controls, for a panel that is a touchscreen ═══════
       Routed back through the keydown handler above rather than duplicated,
       so pause and scene stepping can only ever behave one way. */
    (function () {
        var x0 = 0, y0 = 0, t0 = 0;
        function press(code, key) {
            document.dispatchEvent(new KeyboardEvent('keydown', { code: code, key: key, bubbles: true }));
        }
        document.addEventListener('touchstart', function (e) {
            var t = e.changedTouches[0];
            x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
        }, { passive: true });
        document.addEventListener('touchend', function (e) {
            var t = e.changedTouches[0];
            var dx = t.clientX - x0, dy = t.clientY - y0;
            if (Date.now() - t0 > 700) return;                    // a rest, not a gesture
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) press('ArrowRight', 'ArrowRight');
                else        press('ArrowLeft',  'ArrowLeft');
            } else if (Math.abs(dx) < 16 && Math.abs(dy) < 16) {
                press('Space', ' ');
            }
        }, { passive: true });
    }());
}());`;

if (engineIndex < 0) {
  warn('no loop engine found among the script blocks — the device edits were skipped');
} else {
  let eng = scriptBlocks[engineIndex];
  for (const p of patches) {
    if (p.find.test(eng)) { eng = eng.replace(p.find, p.to); say(`  ✓ ${p.name}`); }
    else warn(`did not match, skipped: ${p.name}`);
  }
  if (/\}\(\)\);\s*$/.test(eng)) {
    eng = eng.trimEnd().replace(/\}\(\)\);$/, TOUCH_BLOCK.trimStart());
    say('  ✓ touch gestures (tap to pause, swipe for scene)');
  } else warn('could not find the engine IIFE tail — touch gestures skipped');
  scriptBlocks[engineIndex] = eng;
}

/* ── describe each block, so the generated file is readable ─────────────── */
const describe = (s, i) => {
  if (i === engineIndex) return 'the loop engine — chrome, the cut between scenes, the timeline';
  if (/window\.DEMO\s*=/.test(s)) return 'the chapters, merged into window.DEMO';
  if (/getElementById/.test(s)) return 'chapter content — fills the empty containers in app.html';
  return 'page script';
};

/* ══════════ write src/styles.css ══════════ */
writeFileSync(STYLES, `/* ══════════════════════════════════════════════════════════════════════════
   GLOBAL STYLESHEET — generated by tools/port-tv-demo.mjs. Edit the pasted
   page and re-run rather than editing here, or the next run overwrites you.

   These are the <style> blocks from the pasted standalone page. They are
   global on purpose and cannot be component styles:

     · they set :root custom properties and style html, body and * — none of
       which a component stylesheet can reach, because Angular rewrites every
       selector in one to match only that component's own elements;
     · the engine toggles classes on <body> (.bare, .on-tx, .paused, .turned)
       and appends #hint to <body>, all of it outside the component;
     · together they are over the 32 kB anyComponentStyle error budget in
       angular.json, so a production build would fail on them.

   Everything below the blocks is the handful of rules a wall panel does not
   need and a handheld Android device does.
   ══════════════════════════════════════════════════════════════════════════ */

${styleBlocks.map((s, i) => `/* ── style block ${i + 1} of ${styleBlocks.length} ─────────────────────────────── */\n${s}`).join('\n\n')}

/* ══════════════════════════════════════════════════════════════════════════
   ON A DEVICE — added by the port, not part of the authored design
   ══════════════════════════════════════════════════════════════════════════ */

/* app-root sits between <body> and #fit and must not become a box of its own:
   #fit is fixed, so this is belt and braces, but a stray block here is exactly
   the kind of thing that shifts a stage by a few pixels and is hard to find. */
app-root { display: contents; }

html, body {
    overscroll-behavior: none;          /* no rubber-band, no pull-to-refresh */
    touch-action: manipulation;         /* no double-tap zoom, no 300ms delay */
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
}

img { -webkit-user-drag: none; user-select: none; }

/* The stage turns a quarter turn on a portrait panel (see fit() in
   tv-demo.ts). The hint is chrome on <body>, not on the stage, so it
   has to turn with it or it reads sideways along the edge. */
body.turned #hint {
    transform: rotate(90deg);
    transform-origin: 100% 100%;
}
`);

/* ══════════ write src/app/app.html ══════════ */
writeFileSync(APP_HTML, `<!--
  The board itself — generated by tools/port-tv-demo.mjs. Edit the pasted page
  and re-run rather than editing here, or the next run overwrites you.

  This is a component template, not a page: the doctype, the <html>/<head>
  wrapper, the <style> blocks and the <script> blocks that came with the pasted
  file are NOT here. Angular silently drops <script> from a template and scopes
  <style> to the component, so they live in src/styles.css and
  src/app/tv-demo.ts instead.

  The empty divs with ids are filled at runtime by the scripts. They are meant
  to be empty here.
-->

${markup}
`);

/* ══════════ write src/app/power-meter-demo.ts ══════════ */
const indent = (s) => s.split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n');
const blocks = scriptBlocks.map((s, i) => `  /* ══════════════════════════════════════════════════════════════════════
     BLOCK ${i + 1} — ${describe(s, i)}
     ══════════════════════════════════════════════════════════════════════ */
  function block${i + 1}() {
${indent(s.trim())}
  }`).join('\n\n');

writeFileSync(DEMO_TS, `/* eslint-disable */
// @ts-nocheck
/* ══════════════════════════════════════════════════════════════════════════
   The TV loop — generated by tools/port-tv-demo.mjs. Edit the pasted page and
   re-run rather than editing here, or the next run overwrites you.

   Verbatim from the <script> blocks of the pasted standalone page, in their
   original order, wrapped so Angular can run them: a template's <script> tags
   are dropped by the compiler and never execute, which is why the board came
   up empty.

   The blocks are unchanged apart from the device edits the porting script
   applies to the engine — it prints which of them matched on every run.

   @ts-nocheck: this is ES5-era DOM code that predates the project, and typing
   it would mean rewriting it. It is isolated in this one file for that reason.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Builds the board into the markup already rendered by app.html and starts the
 * loop. Browser only — it reads window, Date and document.
 *
 * @returns a teardown that stops every timer and frame the loop owns.
 */
export function startTvDemo(): () => void {
  const _timeouts: number[] = [];
  const _intervals: number[] = [];
  const _frames: number[] = [];

  /* The copied code schedules with the bare globals. Shadowing them here — the
     blocks below are nested in this function — records every handle without
     touching a line of that code, so the loop can actually be stopped when the
     component goes away. */
  function setTimeout(fn: any, ms?: number, ...args: any[]): number {
    const id = window.setTimeout(fn, ms, ...args);
    _timeouts.push(id);
    return id;
  }
  function setInterval(fn: any, ms?: number, ...args: any[]): number {
    const id = window.setInterval(fn, ms, ...args);
    _intervals.push(id);
    return id;
  }
  function requestAnimationFrame(fn: any): number {
    const id = window.requestAnimationFrame(fn);
    _frames.push(id);
    return id;
  }

${scriptBlocks.map((s, i) => `  block${i + 1}();   // ${describe(s, i)}`).join('\n')}

  return function stopTvDemo(): void {
    _timeouts.forEach(clearTimeout);
    _intervals.forEach(clearInterval);
    _frames.forEach((id) => window.cancelAnimationFrame(id));
    _timeouts.length = _intervals.length = _frames.length = 0;
  };

${blocks}
}
`);

/* ══════════ keep src/index.html in step with the pasted page ══════════
   The tab title and the two places the letterbox colour is repeated are the
   only things in index.html that belong to the page rather than to the app.
   Patched in place, not regenerated, so anything else you put there survives. */
const letterbox = (styleBlocks.join('\n').match(/html,\s*body\s*\{[^}]*background:\s*(#[0-9a-fA-F]{3,8})/) || [, ''])[1];
if (existsSync(INDEX)) {
  let idx = readFileSync(INDEX, 'utf8');
  const before = idx;
  if (pageTitle) idx = idx.replace(/<title>[\s\S]*?<\/title>/i, `<title>${pageTitle}</title>`);
  if (letterbox) {
    idx = idx.replace(/(<meta name="theme-color" content=")#[0-9a-fA-F]{3,8}(")/i, `$1${letterbox}$2`);
    idx = idx.replace(/(html,body\{[^}]*background:)#[0-9a-fA-F]{3,8}/i, `$1${letterbox}`);
  }
  if (idx !== before) {
    writeFileSync(INDEX, idx);
    say(`patched src/index.html — title, and the letterbox ${letterbox || '(unchanged)'}`);
  }
}

say('');
say('wrote  src/app/app.html            (markup only)');
say('wrote  src/styles.css              (global stylesheet)');
say('wrote  src/app/tv-demo.ts           (the scripts, wrapped)');
say('');
say('next:  npm run build   —   npx cap sync android');
