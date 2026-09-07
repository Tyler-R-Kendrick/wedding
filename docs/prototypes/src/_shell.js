/* Feature lab shell. No dependencies: a scene switcher, a theme switch that
   swaps which kit's tokens the device viewport resolves against, and a
   viewport-width toggle that starts at the 390px phone the site is built for. */
(function () {
  'use strict';

  var device = document.getElementById('device');
  var urlBar = document.getElementById('device-url');
  var widthOut = document.getElementById('device-w');
  var notes = document.getElementById('notes-body');

  function pressGroup(name, value) {
    var buttons = document.querySelectorAll('[data-' + name + ']');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      b.setAttribute('aria-pressed', String(b.dataset[name] === value));
    }
  }

  /* Theme: the device carries data-theme, so every token under it resolves
     from the chosen kit's generated block. */
  function setTheme(id) {
    if (device) device.setAttribute('data-theme', id);
    pressGroup('labTheme', id);
  }

  function setWidth(px) {
    if (device) device.style.setProperty('--device-w', px + 'px');
    if (widthOut) widthOut.textContent = px + '×';
    pressGroup('labWidth', px);
  }

  function setScene(id) {
    var panels = document.querySelectorAll('[data-scene-panel]');
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].dataset.scenePanel !== id;
    }
    var buttons = document.querySelectorAll('[data-scene]');
    for (var j = 0; j < buttons.length; j++) {
      var b = buttons[j];
      var on = b.dataset.scene === id;
      b.setAttribute('aria-current', String(on));
      if (on && urlBar && b.dataset.url) urlBar.textContent = b.dataset.url;
    }
    var tpl = document.querySelector('template[data-notes="' + id + '"]');
    if (tpl && notes) {
      notes.innerHTML = '';
      notes.appendChild(tpl.content.cloneNode(true));
    }
    var vp = document.querySelector('.viewport');
    if (vp) vp.scrollTop = 0;
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-lab-theme], [data-lab-width], [data-scene]');
    if (!t) return;
    if (t.dataset.labTheme) setTheme(t.dataset.labTheme);
    else if (t.dataset.labWidth) setWidth(t.dataset.labWidth);
    else if (t.dataset.scene) setScene(t.dataset.scene);
  });

  /* Local interactivity inside a scene: [data-go] moves to another step of the
     same flow, [data-toggle] flips a disclosure. Both are plain DOM so a scene
     stays testable with the keyboard. */
  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      var scope = go.closest('[data-flow]');
      if (!scope) return;
      var steps = scope.querySelectorAll('[data-step]');
      for (var i = 0; i < steps.length; i++) steps[i].hidden = steps[i].dataset.step !== go.dataset.go;
      var vp = go.closest('.viewport');
      if (vp) vp.scrollTop = 0;
      return;
    }
    var tg = e.target.closest('[data-toggle]');
    if (tg) {
      var target = document.getElementById(tg.dataset.toggle);
      if (!target) return;
      var open = target.hidden;
      target.hidden = !open;
      tg.setAttribute('aria-expanded', String(open));
    }
  });

  var first = document.querySelector('[data-scene]');
  if (first) setScene(first.dataset.scene);
  setTheme('gilded-hour');
  setWidth('390');
})();
