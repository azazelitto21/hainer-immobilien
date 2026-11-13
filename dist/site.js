const cards = document.querySelector('#cards');
const form = document.querySelector('#search');
const kind = document.querySelector('#search-kind');
const query = document.querySelector('#search-query');
const filters = [...document.querySelectorAll('[data-filter]')];
const savedButton = document.querySelector('#saved');
const dialog = document.querySelector('#details');
const searchAppDialog = document.querySelector('#search-app');
const savedKey = 'hainer-favorites';
let saved = new Set();
try {
  const stored = JSON.parse(localStorage.getItem(savedKey));
  if (Array.isArray(stored)) saved = new Set(stored);
} catch {}
let onlySaved = false;
let type = 'Alle';

const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const price = item => new Intl.NumberFormat('de-DE', {style:'currency', currency:'EUR', maximumFractionDigits:0}).format(item.price) + (item.type === 'Mieten' ? ' / Monat' : '');
function render() {
  const visible = listings.filter(i => (!onlySaved || saved.has(i.id)) &&
    (type === 'Alle' || i.type === type));
  cards.innerHTML = visible.map(i => `<article class="card">
    <div class="card-media photo-${i.photo}" role="img" aria-label="${i.title}"></div>
    <span class="card-tag">${i.type === 'Mieten' ? 'ZUR MIETE' : 'ZUM KAUF'}</span>
    <button type="button" class="favorite" data-save="${i.id}" aria-pressed="${saved.has(i.id)}" aria-label="${i.title} merken">${icon('heart')}</button>
    <div class="card-info"><p class="location">${icon('pin')}${i.city} · ${i.district}</p>
    <h3><button type="button" data-detail="${i.id}">${i.title}</button></h3>
    <p class="card-facts">${i.size} m² <span>·</span> ${i.rooms} Zimmer</p>
    <div class="card-bottom"><strong>${price(i)}</strong><button type="button" data-detail="${i.id}" aria-label="Details: ${i.title}">${icon('right')}</button></div></div>
  </article>`).join('');
  document.querySelector('#results-meta').textContent = (onlySaved ? 'Merkliste · ' : '') +
    (visible.length === 0 ? 'Keine passenden Angebote gefunden.' : visible.length + (visible.length === 1 ? ' Angebot' : ' Angebote'));
  document.querySelector('#saved-count').textContent = saved.size;
  savedButton.setAttribute('aria-pressed', onlySaved);
  document.querySelector('#clear').hidden = !onlySaved && type === 'Alle';
  filters.forEach(b => { if (b.matches('button')) b.setAttribute('aria-pressed', !onlySaved && b.dataset.filter === type); });
}
function setType(value) {
  type = value;
  kind.value = value;
  onlySaved = false;
}
form.addEventListener('submit', e => {
  e.preventDefault();
  if (query.value.trim()) {
    searchAppDialog.showModal();
    return;
  }
  setType(kind.value);
  render();
  document.querySelector('#angebote').scrollIntoView();
});
filters.forEach(b => b.addEventListener('click', () => {
  setType(b.dataset.filter);
  if (b.matches('a')) query.value = '';
  render();
}));
savedButton.addEventListener('click', () => {
  const next = !onlySaved;
  setType('Alle');
  onlySaved = next;
  query.value = '';
  render();
  document.querySelector('#angebote').scrollIntoView();
});
document.querySelector('#clear').addEventListener('click', () => {
  setType('Alle');
  query.value = '';
  render();
  document.querySelector('#angebote').scrollIntoView();
});
cards.addEventListener('click', e => {
  const favorite = e.target.closest('[data-save]');
  if (favorite) {
    const id = Number(favorite.dataset.save);
    if (saved.has(id)) saved.delete(id); else saved.add(id);
    try { localStorage.setItem(savedKey, JSON.stringify([...saved])); } catch {}
    render();
    (cards.querySelector('[data-save="' + id + '"]') || savedButton).focus({preventScroll:true});
  }
  const detail = e.target.closest('[data-detail]');
  if (detail) {
    const i = listings.find(i => i.id === Number(detail.dataset.detail));
    document.querySelector('#details-body').innerHTML = `<div class="detail-media photo-${i.photo}"></div><div class="detail-info"><p class="eyebrow">${i.city} · ${i.district}</p><h2 id="detail-title">${i.title}</h2><p>${i.description}</p><p>${i.size} m² · ${i.rooms} Zimmer · ${price(i)}</p></div>`;
    dialog.setAttribute('aria-labelledby', 'detail-title');
    dialog.showModal();
  }
});
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
searchAppDialog.addEventListener('click', e => {
  if (e.target === searchAppDialog) searchAppDialog.close();
});
render();
