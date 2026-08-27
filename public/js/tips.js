/**
 * One floating tooltip for the whole app.
 *
 * Anything carrying `data-tip` gets it, on hover and on keyboard focus alike.
 * A tip never carries information that is not also somewhere permanent - the
 * chart tables, the nutrient sheets - because a tooltip is unreachable to a
 * touchscreen and easy to miss with a screen reader.
 *
 * Listeners are attached once, to the document, and read the DOM at event time.
 * Re-rendering a view therefore costs nothing and cannot leave duplicates
 * behind.
 */

let tip = null;

function hide() {
  tip?.remove();
  tip = null;
}

function show(el, ev) {
  const text = el.dataset.tip;
  if (!text) return hide();
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.setAttribute('role', 'presentation');
    document.body.appendChild(tip);
  }
  tip.textContent = text;

  const box = el.getBoundingClientRect();
  const x = ev?.clientX ?? box.left + box.width / 2;
  const left = Math.max(8, Math.min(window.innerWidth - 8 - tip.offsetWidth, x - tip.offsetWidth / 2));
  // Above the mark by preference; below it when there is no room up there.
  const above = box.top - tip.offsetHeight - 10;
  tip.style.left = `${left}px`;
  tip.style.top = `${above > 8 ? above : box.bottom + 10}px`;
}

export function wireTips() {
  document.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return; // a tap should open the sheet, not hover
    const el = ev.target.closest?.('[data-tip]');
    if (el) show(el, ev); else hide();
  }, { passive: true });

  document.addEventListener('focusin', (ev) => {
    const el = ev.target.closest?.('[data-tip]');
    if (el) show(el); else hide();
  });

  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('blur', hide);
}
