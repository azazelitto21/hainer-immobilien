'use strict';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map(element => [element.id, element]),
);
const apiRoot = '/api/webview';
const currency = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const compact = matchMedia('(max-width: 42rem), (max-height: 43rem)');
const pages = { catalog: 0, bookings: 0, times: 0 };
const initialListing = new URL(location.href).searchParams.get('objekt');

let user = null;
let registering = false;
let loadingData = false;
let dataRequest = 0;
let bookingWindow = null;
let listings = [];
let bookings = [];
let initialListingPending = Boolean(initialListing);
let selectedListing = null;
let calendar = null;
let currentMonth = '';
let selectedDate = '';
let selectedTime = '';
let calendarRequest = 0;
let bookingSaving = false;

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

  const actions = makeElement('div', 'property-actions');
  const button = makeElement('button', 'button button-primary', 'Termin buchen');
  button.type = 'button';
  button.setAttribute('aria-label', 'Besichtigung buchen für ' + listing.title);
  button.addEventListener('click', () => openBooking(listing));
  actions.append(button);
  const detail = sameOriginPath(listing.detail_url);
  if (detail) {
    const link = makeElement('a', '', 'Exposé');
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

function pageSize(name) {
  if (name === 'times') return 12;
  if (compact.matches) return 1;
  return name === 'catalog' ? 3 : 4;
}

function pageItems(name, items) {
  const size = pageSize(name);
  const count = Math.max(1, Math.ceil(items.length / size));
  const page = Math.max(0, Math.min(pages[name], count - 1));
  pages[name] = page;

  const pager = elements[name + '-pager'];
  const [previous, label, next] = pager.children;
  previous.disabled = page === 0;
  next.disabled = page === count - 1;
  label.textContent = (page + 1) + ' / ' + count;
  pager.hidden = count < 2;

  return items.slice(page * size, (page + 1) * size);
}

function renderData() {
  if (!bookingWindow) return;
  if (initialListingPending) {
    const index = listings.findIndex(listing => listing.id === initialListing);
    if (index !== -1) pages.catalog = Math.floor(index / pageSize('catalog'));
    initialListingPending = false;
  }

  elements.listings.replaceChildren(...pageItems('catalog', listings).map(propertyCard));
  elements.bookings.replaceChildren(...pageItems('bookings', bookings).map(bookingItem));
  elements['catalog-empty'].hidden = listings.length > 0;
  elements['bookings-empty'].hidden = bookings.length > 0;
  elements['catalog-date'].hidden = false;
  setDate(elements['visit-date'], bookingWindow.minDate);
}

function showPanel(focus = false) {
  const showBookings = location.hash === '#buchungen';
  const showBooking = Boolean(selectedListing);
  elements.application.classList.toggle('booking-open', showBooking);
  elements['app-nav'].hidden = showBooking;
  elements['catalog-panel'].hidden = showBooking || showBookings;
  elements['bookings-panel'].hidden = showBooking || !showBookings;
  elements['booking-panel'].hidden = !showBooking;
  const catalog = elements['catalog-tab'];
  const history = elements['bookings-tab'];
  (showBookings ? catalog : history).removeAttribute('aria-current');
  (showBookings ? history : catalog).setAttribute('aria-current', 'page');
  if (focus && user) elements[showBooking ? 'booking-heading' : showBookings ? 'bookings-heading' : 'catalog-heading'].focus();
}

function setAuthMode(nextRegistering) {
  registering = nextRegistering;
  const action = registering ? 'Registrieren' : 'Anmelden';
  elements['auth-heading'].textContent = registering ? 'Konto erstellen' : 'Anmelden';
  elements['auth-intro'].hidden = registering;
  elements['auth-submit'].textContent = action;
  elements['auth-question'].textContent = registering ? 'Bereits ein Konto?' : 'Noch kein Konto?';
  elements['toggle-auth'].textContent = registering ? 'Anmelden' : 'Registrieren';
  elements.password.autocomplete = registering ? 'new-password' : 'current-password';
  elements.password.minLength = registering ? 12 : 1;
  elements['password-hint'].hidden = !registering;
  elements['phone-field'].hidden = !registering;
  elements.phone.disabled = !registering;
  elements.phone.required = registering;
  if (registering) elements.password.setAttribute('aria-describedby', 'password-hint');
  else elements.password.removeAttribute('aria-describedby');
  setMessage(elements['auth-error']);
}

function showSession(nextUser) {
  user = nextUser;
  dataRequest += 1;
  calendarRequest += 1;
  selectedListing = null;
  calendar = null;
  initialListingPending = Boolean(initialListing);
  pages.catalog = 0;
  pages.bookings = 0;
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
  elements['catalog-pager'].hidden = true;
  elements['bookings-pager'].hidden = true;
  elements.application.removeAttribute('aria-busy');
  elements.loading.hidden = true;
  elements['account-email'].textContent = user?.email || '';
  elements['website-link'].hidden = Boolean(user);
  elements.logout.hidden = !user;
  elements.application.hidden = !user;
  elements.auth.hidden = Boolean(user);
  elements.password.value = '';
  elements.phone.value = '';
  showPanel();
}

function expireSession() {
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

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function monthStart(date) {
  return date.slice(0, 7) + '-01';
}

function offsetMonth(month, offset) {
  const date = new Date(month + 'T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return isoDay(date);
}

function freeDay(day) {
  return calendar.days[day]?.some(slot => slot.available);
}

function withinWindow(date) {
  return date >= calendar.minDate && date <= calendar.maxDate;
}

function renderCalendar() {
  const first = new Date(currentMonth + 'T12:00:00Z');
  const days = [];
  const padding = (first.getUTCDay() + 6) % 7;
  for (let i = 0; i < padding; i++) {
    const placeholder = makeElement('span');
    placeholder.setAttribute('aria-hidden', 'true');
    days.push(placeholder);
  }

  let available = false;
  const cursor = new Date(first);
  while (cursor.getUTCMonth() === first.getUTCMonth()) {
    const date = isoDay(cursor);
    const day = makeElement('button', 'date-option', cursor.getUTCDate());
    day.type = 'button';
    day.disabled = !withinWindow(date) || !freeDay(date);
    day.setAttribute('aria-label', dateFormat.format(cursor) + (day.disabled ? ' · Nicht verfügbar' : ''));
    if (!day.disabled) {
      day.addEventListener('click', () => chooseDate(date));
      available = true;
    }
    days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  elements['month-title'].textContent = monthFormat.format(first);
  elements['previous-month'].disabled = currentMonth <= monthStart(calendar.minDate);
  elements['next-month'].disabled = currentMonth >= monthStart(calendar.maxDate);
  elements['calendar-days'].replaceChildren(...days);
  elements['calendar-caption'].textContent = available
    ? 'Dunkle Tage sind verfügbar.'
    : 'In diesem Monat sind keine Termine frei.';
}

function showCalendar(focus = true) {
  selectedDate = '';
  selectedTime = '';
  setMessage(elements['booking-error']);
  elements['booking-heading'].textContent = 'Datum auswählen';
  elements['calendar-step'].hidden = false;
  elements['booking-form'].hidden = true;
  renderCalendar();
  if (focus) elements['booking-heading'].focus();
}

function chooseDate(date) {
  selectedDate = date;
  selectedTime = '';
  pages.times = 0;
  setMessage(elements['booking-error']);
  elements['booking-heading'].textContent = 'Uhrzeit auswählen';
  elements['calendar-step'].hidden = true;
  elements['booking-form'].hidden = false;
  setDate(elements['selected-date'], date);
  renderTimes();
  elements['booking-heading'].focus();
}

function updateTimeSelection() {
  for (const button of elements['time-slots'].children) {
    button.setAttribute('aria-pressed', String(button.value === selectedTime));
  }
  const submit = elements['submit-booking'];
  submit.disabled = !selectedTime || bookingSaving;
  submit.textContent = selectedTime ? 'Um ' + selectedTime + ' Uhr buchen' : 'Besichtigung buchen';
}

function renderTimes() {
  const buttons = pageItems('times', calendar.days[selectedDate]).map(({ time, available }) => {
    const button = makeElement('button', 'time-option', time);
    button.type = 'button';
    button.value = time;
    button.disabled = !available;
    button.setAttribute('aria-label', time + ' Uhr' + (available ? '' : ' · Nicht verfügbar'));
    if (available) {
      button.addEventListener('click', () => {
        if (bookingSaving) return;
        selectedTime = time;
        setMessage(elements['booking-error']);
        updateTimeSelection();
      });
    }
    return button;
  });
  elements['time-slots'].replaceChildren(...buttons);
  updateTimeSelection();
}

async function loadCalendar(preferredDate = '') {
  const request = ++calendarRequest;
  const status = elements['calendar-status'];
  calendar = null;
  elements['booking-heading'].textContent = 'Datum auswählen';
  elements['booking-form'].hidden = true;
  elements['calendar-step'].hidden = true;
  elements['retry-calendar'].hidden = true;
  status.textContent = 'Verfügbare Termine werden geladen …';
  status.hidden = false;
  try {
    const params = new URLSearchParams({ listingId: selectedListing.id });
    const data = await api('/calendar?' + params);
    if (request !== calendarRequest) return;
    calendar = data;
    status.hidden = true;
    const firstAvailable = Object.keys(data.days).sort().find(day => withinWindow(day) && freeDay(day));
    currentMonth = monthStart(withinWindow(preferredDate) ? preferredDate : firstAvailable || data.minDate);
    if (withinWindow(preferredDate) && freeDay(preferredDate)) chooseDate(preferredDate);
    else showCalendar();
  } catch (error) {
    if (request !== calendarRequest) return;
    status.hidden = true;
    if (error.status === 401) {
      expireSession();
    } else if (error.status === 404) {
      closeBooking();
      setMessage(elements.message, error.message);
      loadData();
    } else {
      setMessage(elements['booking-error'], error.status ? error.message : 'Termine konnten nicht geladen werden.');
      elements['retry-calendar'].hidden = false;
    }
  }
}

function openBooking(listing) {
  if (bookingSaving) return;
  selectedListing = listing;
  elements['booking-listing'].textContent = listing.title;
  setMessage(elements.message);
  setMessage(elements['booking-error']);
  showPanel(true);
  loadCalendar();
}

function closeBooking(focus = true) {
  if (!selectedListing) return;
  const listingId = selectedListing.id;
  selectedListing = null;
  calendarRequest += 1;
  showPanel();
  if (focus) document.getElementById('objekt-' + listingId)?.querySelector('button')?.focus();
}

function changeMonth(offset) {
  const month = offsetMonth(currentMonth, offset);
  if (month < monthStart(calendar.minDate) || month > monthStart(calendar.maxDate)) return;
  currentMonth = month;
  renderCalendar();
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
    const credentials = { email: elements.email.value.trim(), password: elements.password.value };
    if (registering) credentials.phone = elements.phone.value.trim();
    const session = await post(registering ? '/register' : '/login', credentials);
    showSession(session.user);
    showPanel(true);
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
for (const name of Object.keys(pages)) {
  const pager = elements[name + '-pager'];
  pager.addEventListener('click', event => {
    const direction = event.target.dataset.page;
    if (!direction || (name === 'times' && bookingSaving)) return;
    pages[name] += direction === 'next' ? 1 : -1;
    if (name === 'times') renderTimes();
    else renderData();
  });
}
compact.addEventListener('change', () => {
  const index = listings.findIndex(listing => listing.id === elements.listings.firstElementChild?.id.slice(7));
  if (index !== -1) pages.catalog = Math.floor(index / pageSize('catalog'));
  renderData();
});

elements['cancel-booking'].addEventListener('click', () => closeBooking());
elements['change-date'].addEventListener('click', () => showCalendar());
elements['retry-calendar'].addEventListener('click', () => {
  setMessage(elements['booking-error']);
  loadCalendar();
});
elements['previous-month'].addEventListener('click', () => changeMonth(-1));
elements['next-month'].addEventListener('click', () => changeMonth(1));
elements['booking-form'].addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedListing || !selectedTime || bookingSaving) return;

  const bookingUser = user;
  const listingId = selectedListing.id;
  bookingSaving = true;
  elements['cancel-booking'].disabled = true;
  elements['change-date'].disabled = true;
  elements.logout.disabled = true;
  updateTimeSelection();
  setMessage(elements['booking-error']);
  try {
    const { booking } = await post('/bookings', {
      listingId,
      visitDate: selectedDate,
      visitTime: selectedTime,
    });
    if (user !== bookingUser) return;
    const bookingScreenOpen = selectedListing?.id === listingId;
    bookings = [booking, ...bookings];
    pages.bookings = 0;
    if (bookingScreenOpen) closeBooking(false);
    renderData();
    setMessage(elements.message, 'Ihre Besichtigung wurde gebucht.', 'success');
    if (bookingScreenOpen && location.hash !== '#buchungen') location.hash = '#buchungen';
    else if (bookingScreenOpen) showPanel(true);
  } catch (error) {
    if (!selectedListing) return;
    if (error.status === 401) {
      expireSession();
    } else if (error.status === 404) {
      closeBooking();
      setMessage(elements.message, error.message);
      await loadData();
    } else {
      if (error.status === 409) {
        const preferredDate = selectedDate;
        await loadCalendar(preferredDate);
      }
      if (selectedListing) {
        setMessage(elements['booking-error'], error.status ? error.message : 'Die Verbindung ist fehlgeschlagen. Bitte versuchen Sie es erneut.');
      }
    }
  } finally {
    bookingSaving = false;
    elements['cancel-booking'].disabled = false;
    elements['change-date'].disabled = false;
    elements.logout.disabled = false;
    updateTimeSelection();
  }
});
window.addEventListener('hashchange', () => {
  closeBooking(false);
  showPanel(true);
});

start();
