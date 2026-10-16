/** Call update(dt) from a fixed-step loop, or manually; no private timers. */
export function createTicker(element, { text = '', speed = 30, gap = 32 } = {}) {
  const original = element.style.cssText;
  Object.assign(element.style, { overflow: 'hidden', whiteSpace: 'nowrap', position: 'relative' });
  const strip = document.createElement('span');
  strip.style.display = 'inline-block';
  const first = document.createElement('span'), second = document.createElement('span');
  second.setAttribute('aria-hidden', 'true');
  strip.append(first, second); element.append(strip);
  let offset = 0, width = 0;
  function measure() {
    first.style.paddingRight = '0px'; second.hidden = true;
    width = first.getBoundingClientRect().width;
    if (width > element.clientWidth) {
      first.style.paddingRight = `${gap}px`; width += gap; second.hidden = false;
    } else { width = 0; offset = 0; }
  }
  const api = {
    setText(value) { first.textContent = second.textContent = value; offset = 0; measure(); api.render(); },
    measure,
    update(dt) { if (width) offset = (offset + speed * dt) % width; },
    render() { strip.style.transform = `translateX(${-Math.floor(offset)}px)`; },
    destroy() { strip.remove(); element.style.cssText = original; },
  };
  api.setText(text); return api;
}
