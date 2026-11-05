/* Public-page cursor behavior; no changes to application logic. */
(() => {
  'use strict';
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const root = document.documentElement;
  const selector = 'a, button, select, summary, label[for], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], .section-head, input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], input[type="file"], input[type="range"], .btn, .button, [tabindex]:not([tabindex="-1"])';
  let hovering = false;
  let pressed = false;
  let alternate = false;
  let selectingText = false;
  // Scroll gesture feedback shares the original 500ms glove animation clock.
  // Native scrollbar cursors are browser-controlled, so the trigger is best effort.
  let scrollHover = false;
  let scrollingByWheel = false;
  let wheelQuietTimer = 0;
  // Do not keep a scroll glove on screen after a wheel gesture has stopped.
  // scrollend gives an event-based signal; the short idle fallback also handles
  // a scroll at a boundary (where browsers may not dispatch scrollend).
  const WHEEL_IDLE_MS = 120;
  const MIN_SCROLL_FRAME_MS = 80; // prevent immediate scrollend from hiding the glove in the same frame
  let lastWheelAt = 0;
  function endWheelFeedback() {
    clearTimeout(wheelQuietTimer);
    wheelQuietTimer = 0;
    if (!scrollingByWheel) return;
    scrollingByWheel = false;
    alternate = false;
    paint();
  }
  function canScrollVertically(el) {
    return el && el.scrollHeight > el.clientHeight + 3;
  }
  // Checklist has nested scrolling panels (including the separate BGM player).
  // Only show the scroll glove for a vertically scrollable region or page.
  function hasVerticalScrollTarget(target) {
    for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
      if (!canScrollVertically(el)) continue;
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return true;
    }
    return canScrollVertically(document.scrollingElement || document.documentElement);
  }
  function nearVerticalScrollbar(target, x, y) {
    if (!(target instanceof Element)) return false;
    // Never replace the editable field's insertion cursor.
    if (target.closest('input, textarea, [contenteditable]')) return false;
    const pageScroller = document.scrollingElement || document.documentElement;
    if (canScrollVertically(pageScroller) && x >= window.innerWidth - 15 && x <= window.innerWidth) {
      return true;
    }
    for (let el = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (!canScrollVertically(el)) continue;
      const overflow = getComputedStyle(el).overflowY;
      if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.right - 15 && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    return false;
  }
  function updateScrollHover(event) {
    const next = nearVerticalScrollbar(event.target, event.clientX, event.clientY);
    if (next !== scrollHover) { scrollHover = next; alternate = false; paint(); }
  }
  function paint() {
    const scrolling = (scrollHover || scrollingByWheel) && !selectingText;
    root.classList.toggle('duoduo-cursor-selecting', selectingText && !pressed);
    root.classList.toggle('duoduo-cursor-pressed', pressed && !scrolling);
    root.classList.toggle('duoduo-cursor-scroll', scrolling && !alternate);
    root.classList.toggle('duoduo-cursor-scroll-alt', scrolling && alternate);
    root.classList.toggle('duoduo-cursor-hover', hovering && !scrolling && !pressed && !selectingText && !alternate);
    root.classList.toggle('duoduo-cursor-hover-alt', hovering && !scrolling && !pressed && !selectingText && alternate);
  }
  function updateHover(target) {
    const next = target instanceof Element && !!target.closest(selector);
    if (next !== hovering) { hovering = next; alternate = false; paint(); }
  }
  document.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') { updateHover(e.target); updateScrollHover(e); } }, true);
  document.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { updateHover(e.target); updateScrollHover(e); } }, {passive:true, capture:true});
  document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { pressed = true; paint(); } }, true);
  document.addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && e.button === 0) { pressed = false; updateHover(e.target); paint(); } }, true);
  window.addEventListener('blur', () => { pressed = false; hovering = false; scrollHover = false; endWheelFeedback(); paint(); });
  document.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && !e.relatedTarget) { hovering = false; scrollHover = false; pressed = false; paint(); } }, true);
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    const active = document.activeElement;
    const editable = active && (active.matches('input, textarea, [contenteditable], [contenteditable] *') || active.isContentEditable);
    const next = !editable && !!selection && !selection.isCollapsed && !!selection.toString();
    if (next !== selectingText) { selectingText = next; paint(); }
  });
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button === 0 && selectingText) { selectingText = false; paint(); }
  }, true);
  // Keep the exact original 500ms period for both existing hover and new scroll gloves.
  window.setInterval(() => {
    if ((hovering || scrollHover || scrollingByWheel) && (!pressed || scrollHover)) {
      alternate = !alternate; paint();
    }
  }, 500);
  document.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (!hasVerticalScrollTarget(event.target)) return;
    if (!scrollingByWheel) { scrollingByWheel = true; alternate = false; paint(); }
    lastWheelAt = performance.now();
    clearTimeout(wheelQuietTimer);
    wheelQuietTimer = setTimeout(endWheelFeedback, WHEEL_IDLE_MS);
  }, {passive:true, capture:true});
  // Prefer the browser's real end-of-scroll event, rather than an arbitrary
  // long visual tail. Capture phase also covers nested overflow panels.
  document.addEventListener('scrollend', () => {
    if (!scrollingByWheel) return;
    const elapsed = performance.now() - lastWheelAt;
    if (elapsed >= MIN_SCROLL_FRAME_MS) {
      endWheelFeedback();
    } else {
      // Chrome may fire scrollend virtually alongside a single wheel tick.
      // Preserve one visible frame, but never retain the old 900ms tail.
      clearTimeout(wheelQuietTimer);
      wheelQuietTimer = setTimeout(endWheelFeedback, MIN_SCROLL_FRAME_MS - elapsed);
    }
  }, {capture:true, passive:true});
  // A tab that was hidden must not retain a scrolling cursor on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) endWheelFeedback();
  });
  root.classList.add('duoduo-cursor-ready');
  paint();
})();
