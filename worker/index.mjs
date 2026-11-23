const HTML = 'text/html; charset=utf-8';
const PRIVATE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
const MAX_PHOTO = 5 * 1024 * 1024;
const ID = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const listingPath = new RegExp('^/objekte/(' + ID + ')/?$');
const photoPath = new RegExp('^/objektfotos/(' + ID + '\\.(?:jpg|png|webp))$');
const idPattern = new RegExp('^' + ID + '$');
const euros = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 });
const numbers = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function reply(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: {
    'content-type': HTML, 'x-content-type-options': 'nosniff', ...headers,
  } });
}

function redirect(location) {
  return reply(null, 303, { ...PRIVATE, location });
}

function bytes(asset) {
  return Uint8Array.from(atob(asset.data), char => char.charCodeAt(0));
}

function staticText(path) {
  return new TextDecoder().decode(bytes(staticFiles[path]));
}

function page(title, main, { admin = false, booking = false } = {}) {
  return '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><link rel="stylesheet" href="/styles.css?v=9">' +
    (admin ? '<link rel="stylesheet" href="/admin.css">' : '<link rel="stylesheet" href="/wohnung.css">') +
    (booking ? '<script src="/site.js?v=2" defer></script>' : '') + '</head><body>' +
    '<header class="site-header"><div class="shell header-inner"><a class="page-home" href="/">Wohnungsdatenbank Köln</a></div></header>' +
    main + '<footer class="site-footer"><div class="footer-bottom">© 2026 · Unabhängiges Projekt · Köln</div></footer>' +
    (booking ? bookingDialog : '') + '</body></html>';
}

function adminAccess(request, env) {
  const allowed = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!allowed) return 'unconfigured';
  const email = request.headers.get('oai-authenticated-user-email');
  if (!email || !request.headers.get('oai-authenticated-user-id')) return 'anonymous';
  return email.trim().toLowerCase() === allowed ? 'allowed' : 'denied';
}

function adminNotice(heading, content, status) {
  return reply(page('Verwaltung · Wohnungsdatenbank Köln',
    '<main class="shell admin"><h1>' + heading + '</h1>' + content + '</main>', { admin: true }), status, PRIVATE);
}

function adminForm({ values = {}, problem = '', created = '' } = {}) {
  const input = (name, label, attributes) =>
    '<label>' + label + '<input name="' + name + '" value="' + escapeHtml(values[name] ?? '') + '" ' + attributes + ' required></label>';
  const notice = problem
    ? '<p class="admin-message admin-error" role="alert">' + escapeHtml(problem) + '</p>'
    : '';
  const success = idPattern.test(created)
    ? '<p class="admin-message" role="status">Objekt veröffentlicht. <a href="/objekte/' + created + '">Exposé ansehen</a></p>'
    : '';

  return page('Mietobjekt hinzufügen',
    '<main class="shell admin"><div class="admin-heading"><h1>Mietobjekt hinzufügen</h1>' +
    '<a href="/signout-with-chatgpt?return_to=%2Fadmin" target="_top">Abmelden</a></div>' + success + notice +
    '<form class="admin-form" action="/admin/objekte" method="post" enctype="multipart/form-data">' +
    '<input type="hidden" name="id" value="' + escapeHtml(values.id ?? crypto.randomUUID()) + '">' +
    input('title', 'Titel', 'maxlength="100"') + input('location', 'Stadtteil oder Ort', 'maxlength="90"') +
    '<div class="admin-fields">' +
    input('rent', 'Warmmiete (€)', 'inputmode="decimal" maxlength="10"') +
    input('area', 'Wohnfläche (m²)', 'inputmode="decimal" maxlength="8"') +
    input('rooms', 'Zimmer', 'inputmode="decimal" maxlength="5"') + '</div>' +
    '<label>Beschreibung<textarea name="description" rows="7" maxlength="4000" required>' +
    escapeHtml(values.description ?? '') + '</textarea></label>' +
    '<label>Titelbild <span>(optional, bis 5 MB)</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>' +
    '<button type="submit" class="download">Objekt veröffentlichen</button></form></main>', { admin: true });
}

function card(row) {
  const title = escapeHtml(row.title);
  const image = row.photo_key
    ? '<img src="/objektfotos/' + escapeHtml(row.photo_key) + '" alt="" loading="lazy">'
    : '';
  return '<article class="catalog-card"><a href="/objekte/' + escapeHtml(row.id) + '" class="catalog-link' +
    (image ? '' : ' catalog-link--no-photo') + '" aria-labelledby="catalog-' + escapeHtml(row.id) + '">' + image +
    '<div class="catalog-details"><p class="catalog-meta">' + escapeHtml(row.location) + '</p>' +
    '<h3 id="catalog-' + escapeHtml(row.id) + '">' + title + '</h3>' +
    '<p class="catalog-facts">' + numbers.format(row.area) + ' m² · ' + euros.format(row.rent_cents / 100) + ' Warmmiete</p>' +
    '<span class="catalog-action">Exposé ansehen</span></div></a></article>';
}

const bookingDialog = '<dialog id="app-dialog" aria-labelledby="dialog-title" aria-describedby="dialog-description">' +
  '<form method="dialog"><button class="close-dialog" aria-label="Fenster schließen">×</button></form>' +
  '<h2 id="dialog-title">Besichtigung über die App</h2><p id="dialog-description">Für die Buchung eines verfügbaren Besichtigungstermins benötigen Sie die App.</p>' +
  '<button class="download" type="button" disabled aria-describedby="download-status">APP HERUNTERLADEN</button>' +
  '<p class="download-status" id="download-status">Der Download ist noch nicht verfügbar.</p></dialog>';

function detail(row) {
  const title = escapeHtml(row.title);
  const photo = row.photo_key
    ? '<div class="listing-photo"><img src="/objektfotos/' + escapeHtml(row.photo_key) + '" alt=""></div>'
    : '';
  return page(row.title + ' · Exposé', '<main class="shell listing"><div class="listing-heading">' +
    '<p class="listing-location">' + escapeHtml(row.location) + '</p><h1>' + title + '</h1></div>' +
    '<div class="listing-grid"><section aria-labelledby="listing-description-title">' + photo +
    '<div class="listing-description"><h2 id="listing-description-title">Über das Objekt</h2>' +
    '<p class="listing-description-text">' + escapeHtml(row.description) + '</p></div></section>' +
    '<aside class="listing-card" aria-label="Miete und Besichtigung"><p class="listing-price">' +
    euros.format(row.rent_cents / 100) + '</p><p class="listing-price-label">Warmmiete</p><dl class="listing-facts">' +
    '<div><dt>Wohnfläche</dt><dd>' + numbers.format(row.area) + ' m²</dd></div>' +
    '<div><dt>Zimmer</dt><dd>' + numbers.format(row.rooms) + '</dd></div></dl>' +
    '<button class="download viewing-button" type="button" data-open-app aria-haspopup="dialog" aria-controls="app-dialog">' +
    'Besichtigung buchen</button></aside></div></main>', { booking: true });
}

function decimal(value, max) {
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value.replace(',', '.'));
  return parsed > 0 && parsed <= max ? parsed : null;
}

function photoType(data) {
  const magic = (...sequence) => sequence.every((byte, i) => data[i] === byte);
  if (magic(255, 216, 255)) return ['jpg', 'image/jpeg'];
  if (magic(137, 80, 78, 71, 13, 10, 26, 10)) return ['png', 'image/png'];
  if (magic(82, 73, 70, 70) && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') return ['webp', 'image/webp'];
  return null;
}

async function createListing(request, env) {
  const invalid = (problem, values = {}) => reply(adminForm({ problem, values }), 422, PRIVATE);
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply('Forbidden', 403, PRIVATE);
  if (Number(request.headers.get('content-length')) > MAX_PHOTO + 64 * 1024) {
    return invalid('Das Bild darf höchstens 5 MB groß sein.');
  }
  let form;
  try { form = await request.formData(); }
  catch { return invalid('Das Formular konnte nicht gelesen werden.'); }

  const fields = ['id', 'title', 'location', 'rent', 'area', 'rooms', 'description'];
  const values = Object.fromEntries(fields.map(name => {
    const value = form.get(name);
    return [name, typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : ''];
  }));
  if (!idPattern.test(values.id)) return invalid('Bitte laden Sie das Formular neu.');
  const rent = decimal(values.rent, 1000000);
  const area = decimal(values.area, 100000);
  const rooms = decimal(values.rooms, 1000);
  if (!values.title || values.title.length > 100 || !values.location || values.location.length > 90 ||
      !values.description || values.description.length > 4000 || !rent || !area || !rooms) {
    return invalid('Bitte füllen Sie alle Pflichtfelder aus. Miete, Fläche und Zimmer müssen größer als null sein.', values);
  }

  const photo = form.get('photo');
  let upload = null;
  if (photo instanceof File && photo.size) {
    if (photo.size > MAX_PHOTO) return invalid('Das Bild darf höchstens 5 MB groß sein.', values);
    const data = new Uint8Array(await photo.arrayBuffer());
    const type = photoType(data);
    if (!type) return invalid('Bitte wählen Sie ein JPG-, PNG- oder WebP-Bild.', values);
    upload = { key: crypto.randomUUID() + '.' + type[0], data, mime: type[1] };
  }

  try {
    if (upload) await env.BUCKET.put(upload.key, upload.data, { httpMetadata: { contentType: upload.mime } });
    const result = await env.DB.prepare(
      'INSERT INTO rental_listings (id, title, location, rent_cents, area, rooms, description, photo_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    ).bind(values.id, values.title, values.location, Math.round(rent * 100), area, rooms, values.description, upload?.key ?? null).run();
    if (upload && result.meta.changes === 0) await env.BUCKET.delete(upload.key);
    return redirect('/admin?created=' + values.id);
  } catch {
    // If the write possibly committed, preserve its image until we can verify the reference.
    if (upload) {
      try {
        const row = await env.DB.prepare('SELECT photo_key FROM rental_listings WHERE id = ?').bind(values.id).first();
        if (row?.photo_key !== upload.key) await env.BUCKET.delete(upload.key);
      } catch { /* Do not remove an image that may belong to a published object. */ }
    }
    return reply(adminForm({ values, problem: 'Das Objekt konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.' }), 503, PRIVATE);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/admin' || path === '/admin/' || path === '/admin/objekte') {
      const access = adminAccess(request, env);
      if (path === '/admin/objekte') {
        if (request.method !== 'POST') return reply('Method not allowed', 405, { ...PRIVATE, allow: 'POST' });
        if (access !== 'allowed') return reply('Forbidden', 403, PRIVATE);
        return createListing(request, env);
      }
      if (request.method !== 'GET') return reply('Method not allowed', 405, { ...PRIVATE, allow: 'GET' });
      if (access === 'unconfigured') return adminNotice('Verwaltung', '<p>Der Verwaltungszugang ist noch nicht eingerichtet.</p>', 503);
      if (access === 'denied') return adminNotice('Kein Zugriff', '<p>Dieses Konto hat keinen Zugriff auf die Verwaltung.</p><p><a href="/signout-with-chatgpt?return_to=%2Fadmin" target="_top">Abmelden</a></p>', 403);
      if (access === 'anonymous') return adminNotice('Verwaltung', '<a class="download" href="/signin-with-chatgpt?return_to=%2Fadmin" target="_top">Mit ChatGPT anmelden</a>', 401);
      return reply(adminForm({ created: url.searchParams.get('created') ?? '' }), 200, PRIVATE);
    }

    if (!['GET', 'HEAD'].includes(request.method)) return reply('Method not allowed', 405, { allow: 'GET, HEAD' });
    const body = data => request.method === 'HEAD' ? null : data;

    if (path === '/' || path === '/index.html') {
      const home = staticText('/index.html');
      try {
        const listings = await env.DB.prepare(
          'SELECT id, title, location, rent_cents, area, photo_key FROM rental_listings ORDER BY created_at DESC, id DESC',
        ).all();
        return reply(body(home.replace('<!-- rental-listings -->', () => listings.results.map(card).join(''))), 200, { 'cache-control': 'no-cache' });
      } catch {
        console.error('Unable to read rental catalog from D1');
        return reply(body(home), 200, { 'cache-control': 'no-store' });
      }
    }

    const listing = path.match(listingPath);
    if (listing) {
      const row = await env.DB.prepare('SELECT * FROM rental_listings WHERE id = ?').bind(listing[1]).first();
      if (row) return reply(body(detail(row)), 200, { 'cache-control': 'no-cache' });
      return reply(body('Objekt nicht gefunden'), 404);
    }

    const photo = path.match(photoPath);
    if (photo) {
      const row = await env.DB.prepare('SELECT 1 FROM rental_listings WHERE photo_key = ?').bind(photo[1]).first();
      const file = row ? await env.BUCKET.get(photo[1]) : null;
      if (!file) return reply(body('Foto nicht gefunden'), 404);
      const headers = new Headers({ 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
      file.writeHttpMetadata(headers);
      if (file.httpEtag) headers.set('etag', file.httpEtag);
      return new Response(body(file.body), { headers });
    }

    const asset = staticFiles[path] ?? staticFiles[path + '.html'];
    if (!asset) return reply(body('Seite nicht gefunden'), 404);
    return reply(body(bytes(asset)), 200, {
      'content-type': asset.type,
      'cache-control': asset.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
    });
  },
};
