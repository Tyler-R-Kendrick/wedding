// Evaluated in the page by scripts/demos/record.mjs when recording against the NODE_ENV=test dev
// server: hides Next's dev badge, which would otherwise sit in the corner of every frame.
// Production has no badge, so the webreel tours need nothing like it.
(() => {
  const add = () => {
    const s = document.createElement('style');
    s.textContent = 'nextjs-portal{display:none!important}';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.documentElement) add();
  else document.addEventListener('DOMContentLoaded', add, { once: true });
})();
