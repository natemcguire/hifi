// Skins are presentation only: switching never changes the audio graph or station.
const themes = [
  ['classic', 'Classic · Midnight metal'],
  ['acid-lab', 'Acid Lab · Alien hardware'],
  ['solar-transit', 'Solar Transit · Space-age hi-fi'],
];
const storageKey = 'hifi:skin:v1';
const deck = document.querySelector('.deck');
if (deck) {
  const panel = document.createElement('div');
  panel.className = 'skin-controls';
  const label = document.createElement('label');
  label.htmlFor = 'hifi-skin';
  label.textContent = 'Player skin';
  const select = document.createElement('select');
  select.id = 'hifi-skin';
  for (const [value, title] of themes) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = title;
    select.append(option);
  }
  panel.append(label, select);
  deck.querySelector('.titlebar')?.after(panel);
  function apply(value) {
    const theme = themes.some(([id]) => id === value) ? value : 'classic';
    document.body.dataset.theme = theme;
    select.value = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', {
      classic: '#36394e', 'acid-lab': '#183c20', 'solar-transit': '#e87825',
    }[theme]);
  }
  let saved = 'classic';
  try { saved = localStorage.getItem(storageKey) || saved; } catch { /* Embedded/private mode can deny storage. */ }
  // A host mirroring another listener's receiver can pin the skin for this load.
  const requested = new URLSearchParams(location.search).get('skin');
  apply(requested && themes.some(([id]) => id === requested) ? requested : saved);
  const announce = () => document.dispatchEvent(new CustomEvent('hifi:skin', { detail: document.body.dataset.theme }));
  announce();
  select.addEventListener('change', () => {
    apply(select.value);
    announce();
    try { localStorage.setItem(storageKey, select.value); } catch { /* Session-only skin still works. */ }
  });
  window.addEventListener('storage', event => {
    if (event.key === storageKey) apply(event.newValue || 'classic');
  });
}
