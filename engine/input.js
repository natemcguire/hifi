/** Pointer Events only. emit(type, cell, detail); hitTest receives local CSS coordinates. */
export function pointerAdapter(element, { emit, hitTest = (x, y) => ({ x, y }),
  isRevealed = () => false, dragThreshold = 8, longPressMs = 450, slop = 8 } = {}) {
  const pointers = new Map(), listeners = [];
  const oldTouchAction = element.style.touchAction;
  element.style.touchAction = 'none';
  let lastTouch = -Infinity;
  const on = (target, name, fn) => { target.addEventListener(name, fn); listeners.push(() => target.removeEventListener(name, fn)); };
  const point = e => {
    const rect = element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const notify = (type, p, e, extra = {}) => {
    const pos = e ? point(e) : p.pos;
    emit(type, hitTest(pos.x, pos.y, e), { pointerId: p.id, pointerType: p.type,
      x: pos.x, y: pos.y, startCell: p.cell, dx: pos.x - p.start.x, dy: pos.y - p.start.y,
      button: e?.button ?? p.button, buttons: e?.buttons ?? p.buttons,
      originalEvent: e, ...extra });
  };
  function chord(p, e) {
    if (p.chord) return;
    p.chord = true; clearTimeout(p.timer); notify('chordPress', p, e);
  }
  function finish(p, e, canceled = false) {
    clearTimeout(p.timer); pointers.delete(p.id);
    if (p.type === 'touch') lastTouch = performance.now();
    if (element.hasPointerCapture(p.id)) element.releasePointerCapture(p.id);
    notify(canceled ? 'cancel' : 'release', p, e, {
      dragging: p.dragging, longPressed: p.long, chord: p.chord,
      tap: !canceled && !p.dragging && !p.long && !p.chord && !p.moved,
    });
  }
  on(element, 'pointerdown', e => {
    if (e.pointerType === 'touch') lastTouch = performance.now();
    if (e.pointerType === 'mouse' && performance.now() - lastTouch < 800) return;
    e.preventDefault();
    if (pointers.has(e.pointerId)) return;
    const pos = point(e);
    const p = { id: e.pointerId, type: e.pointerType, pos, start: pos,
      clientX: e.clientX, clientY: e.clientY, cell: hitTest(pos.x, pos.y, e),
      button: e.button, buttons: e.buttons, dragging: false, long: false, chord: false, moved: false };
    pointers.set(p.id, p); element.setPointerCapture(p.id);
    notify('press', p, e);
    if (e.button === 1 || (e.buttons & 3) === 3 || (e.button === 0 && isRevealed(p.cell))) chord(p, e);
    if (e.button === 0 && !p.chord) p.timer = setTimeout(() => {
      if (!p.moved && !p.dragging && pointers.has(p.id)) { p.long = true; notify('longPress', p); }
    }, longPressMs);
  });
  on(element, 'pointermove', e => {
    const p = pointers.get(e.pointerId); if (!p) return;
    e.preventDefault(); p.pos = point(e); p.buttons = e.buttons;
    // Additional mouse buttons arrive as pointermove, not another pointerdown.
    if ((e.buttons & 3) === 3 || (e.buttons & 4)) chord(p, e);
    const distance = Math.hypot(e.clientX - p.clientX, e.clientY - p.clientY);
    if (distance > slop) { p.moved = true; clearTimeout(p.timer); }
    if (distance > dragThreshold && !p.long && !p.chord) { p.dragging = true; clearTimeout(p.timer); }
    if (p.dragging) notify('drag', p, e);
  });
  on(element, 'pointerup', e => { const p = pointers.get(e.pointerId); if (p) finish(p, e); });
  on(element, 'pointercancel', e => { const p = pointers.get(e.pointerId); if (p) finish(p, e, true); });
  on(element, 'lostpointercapture', e => { const p = pointers.get(e.pointerId); if (p) finish(p, e, true); });
  on(element, 'contextmenu', e => e.preventDefault());
  const cancel = () => { for (const p of [...pointers.values()]) finish(p, null, true); };
  on(window, 'blur', cancel);
  on(document, 'visibilitychange', () => { if (document.hidden) cancel(); });
  return { cancel, destroy() { cancel(); listeners.forEach(off => off()); element.style.touchAction = oldTouchAction; } };
}
/** event.code → action; multiple keys mapped to an action hold it until the last release. */
export function keyboardAdapter(bindings, emit, target = window) {
  const held = new Set();
  const active = action => [...held].some(code => bindings[code] === action);
  function down(e) {
    if (!(e.code in bindings) || e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    if (e.repeat || held.has(e.code)) return;
    const action = bindings[e.code], already = active(action); held.add(e.code);
    if (!already) emit('press', action);
  }
  function up(e) {
    if (!held.delete(e.code)) return;
    e.preventDefault(); if (!active(bindings[e.code])) emit('release', bindings[e.code]);
  }
  function cancel() {
    const actions = new Set([...held].map(code => bindings[code])); held.clear();
    for (const action of actions) emit('cancel', action);
  }
  const visibility = () => { if (document.hidden) cancel(); };
  target.addEventListener('keydown', down); target.addEventListener('keyup', up);
  window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', visibility);
  return { destroy() { cancel(); target.removeEventListener('keydown', down); target.removeEventListener('keyup', up);
    window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); } };
}
