/**
 * Recording-only preload for the stage tours (node --require, scripts/demos/record-stages.mjs). It
 * patches the DevTools client webreel drives the browser with, chrome-remote-interface, twice:
 *
 * 1. Every frame shows the address the browser is actually on. webreel records the viewport, not
 *    the address bar, and the tours exist to prove which host and path serves what. So each new
 *    page gets one script: a strip along the bottom with the navigation's HTTP status and the
 *    page's own `location.host + location.pathname`. The browser writes it, not the tour, so a
 *    tour cannot claim an address it is not on. It is never part of the site.
 * 2. A navigation to another host does not break the take. While it commits, Page.captureScreenshot
 *    can hang for good or answer "Not attached to an active page" for a moment. webreel's capture
 *    loop waits on a hung call with no timeout (the rest of the take is one frozen frame), and
 *    retries a failed one with no pause, so ten failures in a few milliseconds abort the whole
 *    recording. Here each attempt gives up after 1.5s, and a failure is retried every 150ms for
 *    up to 4s before webreel sees it.
 */
const { realpathSync } = require('node:fs');
const { dirname } = require('node:path');

const from = dirname(realpathSync(process.argv[1]));
const Chrome = require(require.resolve('chrome-remote-interface/lib/chrome.js', { paths: [from] }));

const STRIP = `(() => {
  const draw = () => {
    if (!document.body) return;
    let el = document.getElementById('__address-strip');
    if (!el) {
      el = document.createElement('div');
      el.id = '__address-strip';
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;inset:auto 0 0 0;z-index:2147483647;pointer-events:none;' +
        'padding:10px 16px;font:600 16px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'background:rgb(31 42 36 / .94);color:rgb(246 241 233);letter-spacing:.01em';
      document.body.appendChild(el);
    }
    const nav = performance.getEntriesByType('navigation')[0];
    const status = nav && nav.responseStatus ? nav.responseStatus + '  ' : '';
    const text = status + location.protocol + '//' + location.host + location.pathname;
    if (el.textContent !== text) el.textContent = text;
  };
  document.addEventListener('DOMContentLoaded', draw);
  setInterval(draw, 100);
})();`;

const ATTEMPT_TIMEOUT_MS = 1500;
const RETRY_EVERY_MS = 150;
const RETRY_FOR_MS = 4000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const send = Chrome.prototype.send;

function attempt(client, params, sessionId) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Page.captureScreenshot did not answer')), ATTEMPT_TIMEOUT_MS);
  });
  return Promise.race([send.call(client, 'Page.captureScreenshot', params, sessionId), timeout]).finally(() => clearTimeout(timer));
}

Chrome.prototype.send = async function (method, params, sessionId, callback) {
  if (method !== 'Page.captureScreenshot' || typeof callback === 'function') return send.call(this, method, params, sessionId, callback);
  const until = Date.now() + RETRY_FOR_MS;
  for (;;) {
    try {
      return await attempt(this, params, sessionId);
    } catch (err) {
      if (Date.now() >= until) throw err;
      await sleep(RETRY_EVERY_MS);
    }
  }
};

const connect = Chrome.prototype._connectToWebSocket;
Chrome.prototype._connectToWebSocket = async function (...args) {
  await connect.apply(this, args);
  // Page targets only: webreel also opens a browser-level session, which has no Page domain.
  try {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: STRIP });
  } catch {}
};
