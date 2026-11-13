const cards = document.querySelector('#cards');
const searchAppDialog = document.querySelector('#search-app');
const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const currency = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const price = item => currency.format(item.price) + (item.type === 'Mieten' ? ' / Monat' : '');

cards.innerHTML = listings.map(i => `<article class="card">
    <div class="card-media photo-${i.photo}" role="img" aria-label="${i.title}"></div>
    <span class="card-tag">${i.type === 'Mieten' ? 'ZUR MIETE' : 'ZUM KAUF'}</span>
    <button type="button" class="favorite" data-app-gate aria-label="${i.title} merken">${icon('heart')}</button>
    <div class="card-info"><p class="location">${icon('pin')}${i.city} · ${i.district}</p>
    <h3><button type="button" data-app-gate>${i.title}</button></h3>
    <p class="card-facts">${i.size} m² <span>·</span> ${i.rooms} Zimmer</p>
    <div class="card-bottom"><strong>${price(i)}</strong><button type="button" data-app-gate aria-label="Details: ${i.title}">${icon('right')}</button></div></div>
  </article>`).join('');

document.querySelector('#results-meta').textContent = listings.length + ' Angebote';

document.querySelector('#search').addEventListener('submit', event => {
  event.preventDefault();
  searchAppDialog.showModal();
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-app-gate]')) searchAppDialog.showModal();
});
searchAppDialog.addEventListener('click', event => {
  if (event.target === searchAppDialog) searchAppDialog.close();
});
