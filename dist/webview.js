'use strict';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map(element => [element.id, element]),
);
const apiRoot = '/api/webview';
const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: 'Europe/Berlin' });
const initialListing = new URL(location.href).searchParams.get('objekt');

let user = null;
let registering = false;
let loadingData = false;
let dataRequest = 0;
let bookingWindow = null;
let listings = [];
let bookings = [];
let initialListingPending = Boolean(initialListing);
let selectedListingId = null;
let slotRequest = 0;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, options) {
  const response = await fetch(apiRoot + path, options);
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    throw new ApiError(body?.error || 'Die Anfrage konnte nicht abgeschlossen werden.', response.status);
  }
  return body;
}

function post(path, body = {}) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setMessage(element, text = '', type = 'error') {
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle('error', type === 'error');
}

function makeElement(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function sameOriginPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  const url = new URL(value, location.href);
  if (url.origin !== location.origin) return null;
  return url.href;
}

function setDate(element, date, time) {
  element.dateTime = time ? date + 'T' + time : date;
  const day = dateFormat.format(new Date(date + 'T12:00:00Z'));
  element.textContent = time ? day + ' · ' + time + ' Uhr' : day;
}

function propertyCard(listing) {
  const card = makeElement('article', 'property');
  card.id = 'objekt-' + listing.id;
  const photo = sameOriginPath(listing.photo_url);
  if (photo) {
    const image = makeElement('img', 'property-image');
    image.src = photo;
    image.alt = '';
    image.loading = 'lazy';
    card.append(image);
  }

  const content = makeElement('div', 'property-content');
  const facts = [
    number.format(listing.area) + ' m²',
    number.format(listing.rooms) + ' Zimmer',
    currency.format(listing.rent_cents / 100) + ' Warmmiete',
  ];
  content.append(
    makeElement('p', 'property-location', listing.location),
    makeElement('h3', '', listing.title),
    makeElement('p', 'property-facts', facts.join(' · ')),
  );
  if (listing.description) {
    const details = makeElement('details');
    details.append(makeElement('summary', '', 'Beschreibung'), makeElement('p', '', listing.description));
    content.append(details);
  }

  const actions = makeElement('div', 'property-actions');
  const button = makeElement('button', 'button button-primary', 'Besichtigung buchen');
  button.type = 'button';
  button.setAttribute('aria-label', 'Besichtigung buchen für ' + listing.title);
  button.addEventListener('click', () => prepareBooking(listing));
  actions.append(button);
  const detail = sameOriginPath(listing.detail_url);
  if (detail) {
    const link = makeElement('a', '', 'Exposé ansehen');
    link.href = detail;
    actions.append(link);
  }
  content.append(actions);
  card.append(content);
  return card;
}

function bookingItem(booking) {
  const item = makeElement('li', 'booking-item');
  const info = makeElement('div');
  info.append(
    makeElement('h3', '', booking.title),
    makeElement('p', 'property-location', booking.location),
  );
  const date = makeElement('time');
  setDate(date, booking.visit_date, booking.visit_time);
  item.append(info, date);
  return item;
}

function renderData() {
  elements.listings.replaceChildren(...listings.map(propertyCard));
  elements.bookings.replaceChildren(...bookings.map(bookingItem));
  elements['catalog-empty'].hidden = listings.length > 0;
  elements['bookings-empty'].hidden = bookings.length > 0;
  elements['catalog-date'].hidden = false;
  setDate(elements['visit-date'], bookingWindow.minDate);

  if (initialListingPending && location.hash !== '#buchungen') {
    const card = document.getElementById('objekt-' + initialListing);
    if (card) card.scrollIntoView({ block: 'nearest' });
    initialListingPending = false;
  }
}

function showPanel(focus = false) {
  const showBookings = location.hash === '#buchungen';
  elements['catalog-panel'].hidden = showBookings;
  elements['bookings-panel'].hidden = !showBookings;
  const catalog = elements['catalog-tab'];
  const history = elements['bookings-tab'];
  (showBookings ? catalog : history).removeAttribute('aria-current');
  (showBookings ? history : catalog).setAttribute('aria-current', 'page');
  if (focus && user) elements[showBookings ? 'bookings-heading' : 'catalog-heading'].focus();
}

function setAuthMode(nextRegistering) {
  registering = nextRegistering;
  const action = registering ? 'Registrieren' : 'Anmelden';
  elements['auth-heading'].textContent = registering ? 'Konto erstellen' : 'Anmelden';
  elements['auth-intro'].textContent = registering
    ? 'Erstellen Sie ein Konto, um Besichtigungen zu buchen.'
    : 'Melden Sie sich an, um Besichtigungen zu buchen und Ihre Termine einzusehen.';
  elements['auth-submit'].textContent = action;
  elements['auth-question'].textContent = registering ? 'Bereits ein Konto?' : 'Noch kein Konto?';
  elements['toggle-auth'].textContent = registering ? 'Anmelden' : 'Registrieren';
  elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  elements.password.minLength = registering ? 12 : 1;
  elements['password-hint'].hidden = !registering;
  if (registering) elements.password.setAttribute('aria-describedby', 'password-hint');
  else elements.password.removeAttribute('aria-describedby');
  setMessage(elements['auth-error']);
}

function showSession(nextUser) {
  user = nextUser;
  dataRequest += 1;
  loadingData = false;
  bookingWindow = null;
  listings = [];
  bookings = [];
  elements.listings.replaceChildren();
  elements.bookings.replaceChildren();
  elements['catalog-date'].hidden = true;
  elements['catalog-empty'].hidden = true;
  elements['bookings-empty'].hidden = true;
  elements['retry-data'].hidden = true;
  elements.application.removeAttribute('aria-busy');
  elements.loading.hidden = true;
  elements['account-email'].textContent = user?.email || '';
  elements['website-link'].hidden = Boolean(user);
  elements.logout.hidden = !user;
  elements.application.hidden = !user;
  elements.auth.hidden = Boolean(user);
  elements.password.value = '';
  showPanel();
}

function expireSession() {
  elements['confirm-booking'].close();
  showSession(null);
  setAuthMode(false);
  setMessage(elements.message, 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  elements.email.focus();
}

async function loadData() {
  if (!user || loadingData) return;
  const request = ++dataRequest;
  loadingData = true;
  elements.application.setAttribute('aria-busy', 'true');
  elements['retry-data'].hidden = true;
  try {
    const [available, personal] = await Promise.all([api('/listings'), api('/bookings')]);
    if (request !== dataRequest) return;
    bookingWindow = { minDate: available.minDate, maxDate: available.maxDate };
    listings = available.listings;
    bookings = personal.bookings;
    renderData();
  } catch (error) {
    if (request !== dataRequest) return;
    if (error.status === 401) {
      expireSession();
    } else {
      setMessage(elements.message, 'Objekte und Buchungen konnten nicht geladen werden. Bitte versuchen Sie es erneut.');
      elements['retry-data'].hidden = false;
    }
  } finally {
    if (request === dataRequest) {
      loadingData = false;
      elements.application.removeAttribute('aria-busy');
    }
  }
}

async function start() {
  elements['reload'].hidden = true;
  elements['loading-message'].textContent = 'App wird geladen …';
  try {
    const session = await api('/session');
    showSession(session.user);
    await loadData();
  } catch {
    elements['loading-message'].textContent = 'Die App konnte nicht geladen werden.';
    elements['reload'].hidden = false;
  }
}

async function refreshSlots() {
  const dialog = elements['confirm-booking'];
  const input = elements['booking-date'];
  const select = elements['booking-time'];
  const status = elements['slot-status'];
  const request = ++slotRequest;
  const placeholder = makeElement('option', '', 'Uhrzeit auswählen');
  placeholder.value = '';
  select.replaceChildren(placeholder);
  select.disabled = true;
  elements['submit-booking'].disabled = true;
  status.textContent = '';
  if (!input.value || !input.validity.valid) return;

  status.textContent = 'Freie Zeiten werden geladen …';
  try {
    const query = new URLSearchParams({ listingId: selectedListingId, visitDate: input.value });
    const { times, alreadyBooked } = await api('/availability?' + query);
    if (request !== slotRequest || !dialog.open) return;
    status.textContent = alreadyBooked
      ? 'Sie haben dieses Objekt an diesem Tag bereits gebucht.'
      : times.length ? '' : 'An diesem Tag sind keine Termine frei.';
    for (const time of times) {
      const option = makeElement('option', '', time + ' Uhr');
      option.value = time;
      select.append(option);
    }
    select.disabled = times.length === 0;
  } catch (error) {
    if (request !== slotRequest || !dialog.open) return;
    status.textContent = '';
    if (error.status === 401) expireSession();
    else setMessage(elements['booking-error'], error.message);
  }
}

function prepareBooking(listing) {
  if (!bookingWindow) return;
  selectedListingId = listing.id;
  elements['confirm-title'].textContent = listing.title;
  const input = elements['booking-date'];
  input.min = bookingWindow.minDate;
  input.max = bookingWindow.maxDate;
  input.value = bookingWindow.minDate;
  setMessage(elements['booking-error']);
  elements['confirm-booking'].showModal();
  refreshSlots();
}

elements['reload'].addEventListener('click', start);
elements['retry-data'].addEventListener('click', () => {
  setMessage(elements.message);
  loadData();
});
elements['toggle-auth'].addEventListener('click', () => {
  setAuthMode(!registering);
  elements.password.value = '';
  elements['auth-heading'].tabIndex = -1;
  elements['auth-heading'].focus();
});
elements['auth-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const submit = elements['auth-submit'];
  submit.disabled = true;
  elements['toggle-auth'].disabled = true;
  setMessage(elements['auth-error']);
  setMessage(elements.message);
  try {
    const session = await post(registering ? '/register' : '/login', {
      email: elements.email.value.trim(),
      password: elements.password.value,
    });
    showSession(session.user);
    elements['application-title'].focus();
    await loadData();
  } catch (error) {
    setMessage(elements['auth-error'], error.status ? error.message : 'Die Verbindung ist fehlgeschlagen. Bitte versuchen Sie es erneut.');
  } finally {
    submit.disabled = false;
    elements['toggle-auth'].disabled = false;
  }
});
elements.logout.addEventListener('click', async () => {
  elements.logout.disabled = true;
  setMessage(elements.message);
  try {
    await post('/logout');
    showSession(null);
    setAuthMode(false);
    elements.email.value = '';
    elements.email.focus();
  } catch (error) {
    if (error.status === 401) expireSession();
    else setMessage(elements.message, 'Sie konnten nicht abgemeldet werden. Bitte versuchen Sie es erneut.');
  } finally {
    elements.logout.disabled = false;
  }
});
elements['cancel-booking'].addEventListener('click', () => elements['confirm-booking'].close());
elements['confirm-booking'].addEventListener('cancel', event => {
  if (elements['cancel-booking'].disabled) event.preventDefault();
});
elements['booking-date'].addEventListener('input', () => {
  setMessage(elements['booking-error']);
  refreshSlots();
});
elements['booking-time'].addEventListener('change', () => {
  elements['submit-booking'].disabled = !elements['booking-time'].value;
});
elements['booking-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const input = elements['booking-date'];
  const select = elements['booking-time'];
  const submit = elements['submit-booking'];
  if (submit.disabled || !selectedListingId || !input.validity.valid || !select.value) return;
  const selection = { listingId: selectedListingId, visitDate: input.value, visitTime: select.value };
  submit.disabled = true;
  elements['cancel-booking'].disabled = true;
  input.disabled = true;
  select.disabled = true;
  setMessage(elements['booking-error']);
  setMessage(elements.message);
  try {
    const { booking } = await post('/bookings', selection);
    bookings = [booking, ...bookings];
    elements['confirm-booking'].close();
    renderData();
    setMessage(elements.message, 'Ihre Besichtigung wurde gebucht.', 'success');
    if (location.hash !== '#buchungen') location.hash = '#buchungen';
    else showPanel(true);
  } catch (error) {
    if (error.status === 401) {
      expireSession();
    } else if (error.status === 409) {
      setMessage(elements['booking-error'], error.message);
      await refreshSlots();
    } else if (error.status === 404 || error.status === 422) {
      elements['confirm-booking'].close();
      setMessage(elements.message, error.message);
      await loadData();
    } else {
      setMessage(elements['booking-error'], error.status ? error.message : 'Die Verbindung ist fehlgeschlagen. Bitte versuchen Sie es erneut.');
    }
  } finally {
    elements['cancel-booking'].disabled = false;
    input.disabled = false;
    if (select.value) select.disabled = false;
    submit.disabled = !select.value;
  }
});
window.addEventListener('hashchange', () => showPanel(true));

start();
