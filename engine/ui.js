import { domSprite } from './sprites.js';
/** Caller-owned artwork; native controls retain keyboard/focus semantics. */
export function bevel(element, sunken = false) {
  Object.assign(element.style, { border: '2px solid', borderColor: sunken ? '#808080 #fff #fff #808080' : '#fff #808080 #808080 #fff' });
  return element;
}
export function spriteButton(sheet, frames, label) {
  const element = document.createElement('button'); element.type = 'button'; element.setAttribute('aria-label', label);
  const sprite = domSprite(sheet, frames.normal, { element }); element.style.position = 'relative';
  const down = () => sprite.frame(frames.pressed ?? frames.normal), up = () => sprite.frame(frames.normal);
  element.addEventListener('pointerdown', e => { element.setPointerCapture(e.pointerId); down(); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) element.addEventListener(event, up);
  element.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') down(); });
  element.addEventListener('keyup', up);
  return element;
}
export function spriteLamp(sheet, { off, on }, label = 'Status') {
  const sprite = domSprite(sheet, off); sprite.element.style.position = 'relative';
  sprite.element.setAttribute('role', 'img');
  const set = lit => { sprite.frame(lit ? on : off); sprite.element.setAttribute('aria-label', `${label}: ${lit ? 'on' : 'off'}`); };
  set(false); return { element: sprite.element, set };
}
export function spriteDigits(sheet, frames, count = 3) {
  const element = document.createElement('span'); element.style.display = 'inline-flex'; element.setAttribute('role', 'img');
  const digits = Array.from({ length: count }, () => {
    const sprite = domSprite(sheet, frames['0']); sprite.element.style.position = 'relative';
    element.append(sprite.element); return sprite;
  });
  return { element, set(value) {
    const text = String(value).padStart(count, '0').slice(-count); element.setAttribute('aria-label', String(value));
    [...text].forEach((char, i) => digits[i].frame(frames[char] ?? frames['0']));
  } };
}
export function spriteSlider(sheet, thumbFrame, { label = 'Volume', min = 0, max = 1, step = 0.01, value = 1 } = {}) {
  const element = document.createElement('label'), input = document.createElement('input');
  element.style.cssText = 'position:relative;display:inline-block;width:160px';
  input.type = 'range'; Object.assign(input, { min, max, step, value }); input.setAttribute('aria-label', label);
  input.style.cssText = 'width:100%;margin:0';
  const thumb = domSprite(sheet, thumbFrame); thumb.element.style.pointerEvents = 'none';
  thumb.element.style.top = '0';
  const sync = () => { const ratio = (Number(input.value) - min) / (max - min);
    thumb.element.style.left = `calc(${ratio * 100}% - ${ratio * thumbFrame.width}px)`; };
  input.addEventListener('input', sync); element.append(input, thumb.element); sync();
  return { element, input, set(value) { input.value = value; sync(); } };
}
