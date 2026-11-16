import { FEEDBACK_PATH, REPORTER_FLAG_KEY, REPORTER_GLOBAL, REPORTER_HOTKEY } from './constants';

/**
 * The shortcut, as a few lines of script written into every page by the root layout.
 *
 * Inline, and plain DOM, because it is the part of the reporter that has to survive the rest of
 * the page's script failing: a chunk that 404s after a deploy, a hydration error, a component that
 * throws on mount. If the widget is alive it has put a function on `window` and this calls it. If
 * not, this goes to the plain form (src/lib/feedback/fallback-page.ts), which needs no script.
 *
 * It does nothing at all unless this device carries the reporter flag, which only an owner's
 * signed-in visit sets (src/components/feedback/ReporterLauncher.tsx). The flag opens no door: the
 * form and the endpoint check the signed pass and answer 404 without it.
 */
export function reporterHotkeyScript(): string {
  const k = JSON.stringify;
  return (
    `(function(){document.addEventListener('keydown',function(e){` +
    `if(e.code!==${k(REPORTER_HOTKEY.code)}||!e.altKey||!e.shiftKey||e.ctrlKey||e.metaKey||e.repeat)return;` +
    `var on=false;try{on=localStorage.getItem(${k(REPORTER_FLAG_KEY)})==='1'}catch(_){}` +
    `if(!on)return;e.preventDefault();` +
    `var open=window[${k(REPORTER_GLOBAL)}];` +
    `if(typeof open==='function'){try{open();return}catch(_){}}` +
    `location.href=${k(FEEDBACK_PATH)}+'?from='+encodeURIComponent(location.pathname)` +
    `})})();`
  );
}
