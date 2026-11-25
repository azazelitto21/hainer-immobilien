const HTML = 'text/html; charset=utf-8';
const PRIVATE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
const MAX_PHOTO = 5 * 1024 * 1024;
const ID = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const listingPath = new RegExp('^/objekte/(' + ID + ')/?$');
const photoPath = new RegExp('^/objektfotos/(' + ID + '\\.(?:jpg|png|webp))$');
const idPattern = new RegExp('^' + ID + '$');
const originalListingId = '2870294b-1311-42c6-8f04-c12bf701a970';
const originalListingPhoto = '/assets/suedstadt/image12.webp';
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

function page(title, main, { admin = false } = {}) {
  return '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><link rel="stylesheet" href="/styles.css?v=9">' +
    (admin ? '<link rel="stylesheet" href="/admin.css">' : '<link rel="stylesheet" href="/wohnung.css">') +
    '</head><body>' +
    '<header class="site-header"><div class="shell header-inner"><a class="page-home" href="/">Wohnungsdatenbank Köln</a></div></header>' +
    main + '<footer class="site-footer"><div class="footer-bottom">© 2026 · Unabhängiges Projekt · Köln</div></footer>' +
    '</body></html>';
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

const adminSignOut = '<a href="/signout-with-chatgpt?return_to=%2Fadmin" target="_top">Abmelden</a>';

function adminPage(title, content, layout = '') {
  return page(title + ' · Wohnungsdatenbank Köln',
    '<main class="shell admin' + layout + '"><div class="admin-heading"><h1>' + escapeHtml(title) +
    '</h1>' + adminSignOut + '</div>' + content + '</main>', { admin: true });
}

function adminMessage(message, error = false) {
  if (!message) return '';
  return '<p class="admin-message' + (error ? ' admin-error" role="alert">' : '" role="status">') +
    escapeHtml(message) + '</p>';
}

function adminForm({ id, values = {}, problem = '' } = {}) {
  const formPath = '/admin/objekte' + (id ? '/' + id : '');
  const input = (name, label, attributes) => '<label>' + label + '<input name="' + name + '" value="' +
    escapeHtml(values[name] ?? '') + '" ' + attributes + ' required></label>';
  return adminPage(id ? 'Mietobjekt bearbeiten' : 'Mietobjekt hinzufügen',
    '<p><a href="/admin">Zur Verwaltung</a></p>' + adminMessage(problem, true) +
    '<form class="admin-form" action="' + formPath + '" method="post" enctype="multipart/form-data">' +
    (id ? '' : '<input type="hidden" name="id" value="' + escapeHtml(values.id || crypto.randomUUID()) + '">') +
    input('title', 'Titel', 'maxlength="100"') + input('location', 'Stadtteil oder Ort', 'maxlength="90"') +
    '<div class="admin-fields">' +
    input('rent', 'Warmmiete (€)', 'inputmode="decimal" maxlength="10"') +
    input('area', 'Wohnfläche (m²)', 'inputmode="decimal" maxlength="9"') +
    input('rooms', 'Zimmer', 'inputmode="decimal" maxlength="7"') + '</div>' +
    '<label>Beschreibung<textarea name="description" rows="7" maxlength="4000" required>' +
    escapeHtml(values.description ?? '') + '</textarea></label>' +
    '<label>' + (id ? 'Titelbild ersetzen' : 'Titelbild') +
    ' <span>(optional, bis 5 MB)</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>' +
    '<button type="submit" class="download">' + (id ? 'Änderungen speichern' : 'Objekt veröffentlichen') +
    '</button></form>');
}

const adminPageSize = 50;
const adminDate = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'Europe/Berlin' });

function adminPageNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER / adminPageSize
    ? number : 1;
}

function adminPagination(section, current, other, hasNext) {
  if (current === 1 && !hasNext) return '';
  const users = section === 'users';
  const link = (number, label) => '<a href="/admin?objects=' + (users ? other : number) +
    '&amp;users=' + (users ? number : other) + '#' + section + '">' + label + '</a>';
  return '<nav class="admin-pagination" aria-label="' + (users ? 'Benutzerseiten' : 'Objektseiten') + '">' +
    (current > 1 ? link(current - 1, 'Zurück') : '') + '<span>Seite ' + current + '</span>' +
    (hasNext ? link(current + 1, 'Weiter') : '') + '</nav>';
}

function adminListingRow(row) {
  const path = '/admin/objekte/' + encodeURIComponent(row.id);
  const active = row.is_active === 1;
  return '<tr><th scope="row">' + escapeHtml(row.title) + '<span>' + escapeHtml(row.location) + '</span></th>' +
    '<td>' + euros.format(row.rent_cents / 100) + '</td>' +
    '<td><span class="admin-status' + (active ? ' admin-status-active' : '') + '">' +
    (active ? 'Veröffentlicht' : 'Ausgeblendet') + '</span></td>' +
    '<td><div class="admin-actions"><a href="' + path + '">Bearbeiten</a>' +
    '<form action="' + path + '/status" method="post">' +
    '<input type="hidden" name="active" value="' + (active ? '0' : '1') + '">' +
    '<button type="submit">' + (active ? 'Ausblenden' : 'Veröffentlichen') + '</button></form></div></td></tr>';
}

function adminUserRow(row) {
  const timestamp = String(row.created_at);
  const date = new Date(timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T') + 'Z');
  return '<tr><th scope="row">' + escapeHtml(row.email) + '</th><td>' +
    (Number.isNaN(date.getTime()) ? '—' : adminDate.format(date)) + '</td></tr>';
}

async function adminDashboard(url, env) {
  const objects = adminPageNumber(url.searchParams.get('objects'));
  const users = adminPageNumber(url.searchParams.get('users'));
  const [{ results: listings }, { results: accounts }] = await Promise.all([
    env.DB.prepare('SELECT id, title, location, rent_cents, is_active FROM rental_listings ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .bind(adminPageSize + 1, (objects - 1) * adminPageSize).all(),
    env.DB.prepare('SELECT email, created_at FROM webview_users ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .bind(adminPageSize + 1, (users - 1) * adminPageSize).all(),
  ]);
  const notices = {
    created: 'Objekt veröffentlicht.',
    saved: 'Änderungen gespeichert.',
    shown: 'Objekt veröffentlicht.',
    hidden: 'Objekt ausgeblendet.',
  };
  const notice = Object.keys(notices).find(key => idPattern.test(url.searchParams.get(key) ?? ''));
  return reply(adminPage('Verwaltung', adminMessage(notice && notices[notice]) +
    '<section class="admin-panel" id="objects" aria-labelledby="admin-objects-title">' +
    '<div class="admin-panel-heading"><h2 id="admin-objects-title">Mietobjekte</h2>' +
    '<a class="download" href="/admin/objekte">Objekt hinzufügen</a></div>' +
    (listings.length ? '<div class="admin-table-scroll"><table><thead><tr><th scope="col">Objekt</th>' +
      '<th scope="col">Warmmiete</th><th scope="col">Status</th><th scope="col">Aktionen</th></tr></thead><tbody>' +
      listings.slice(0, adminPageSize).map(adminListingRow).join('') + '</tbody></table></div>' :
      '<p class="admin-empty">Keine Mietobjekte auf dieser Seite.</p>') +
    adminPagination('objects', objects, users, listings.length > adminPageSize) + '</section>' +
    '<section class="admin-panel" id="users" aria-labelledby="admin-users-title">' +
    '<div class="admin-panel-heading"><h2 id="admin-users-title">Registrierte Benutzer</h2></div>' +
    (accounts.length ? '<div class="admin-table-scroll"><table><thead><tr><th scope="col">E-Mail</th>' +
      '<th scope="col">Registriert am</th></tr></thead><tbody>' +
      accounts.slice(0, adminPageSize).map(adminUserRow).join('') + '</tbody></table></div>' :
      '<p class="admin-empty">Keine registrierten Benutzer auf dieser Seite.</p>') +
    adminPagination('users', users, objects, accounts.length > adminPageSize) + '</section>',
  ' admin-dashboard'), 200, PRIVATE);
}

async function ensureOriginalListing(db) {
  if (await db.prepare('SELECT 1 FROM rental_listings WHERE id = ?').bind(originalListingId).first()) return;
  await db.prepare(`INSERT INTO rental_listings (id, title, location, rent_cents, area, rooms, description, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO NOTHING`).bind(
    originalListingId, '1-Zimmer-Wohnung in Köln-Südstadt', '50678 Köln · Südstadt / Severinsviertel',
    73000, 38, 1, 'Testobjekt für Probebuchungen. Einzimmerwohnung im Kölner Severinsviertel mit Einbauküche und Balkon.',
  ).run();
}

function listingPhoto(row) {
  if (row.photo_key) return '/objektfotos/' + row.photo_key;
  return row.id === originalListingId ? originalListingPhoto : null;
}

function card(row) {
  const title = escapeHtml(row.title);
  const src = listingPhoto(row);
  const image = src ? '<img src="' + escapeHtml(src) + '" alt="" loading="lazy">' : '';
  return '<article class="catalog-card"><a href="/objekte/' + escapeHtml(row.id) + '" class="catalog-link' +
    (image ? '' : ' catalog-link--no-photo') + '" aria-labelledby="catalog-' + escapeHtml(row.id) + '">' + image +
    '<div class="catalog-details"><p class="catalog-meta">' + escapeHtml(row.location) + '</p>' +
    '<h3 id="catalog-' + escapeHtml(row.id) + '">' + title + '</h3>' +
    '<p class="catalog-facts">' + numbers.format(row.area) + ' m² · ' + euros.format(row.rent_cents / 100) + ' Warmmiete</p>' +
    '<span class="catalog-action">Exposé ansehen</span></div></a></article>';
}

function detail(row) {
  const title = escapeHtml(row.title);
  const src = listingPhoto(row);
  const photo = src ? '<div class="listing-photo"><img src="' + escapeHtml(src) + '" alt=""></div>' : '';
  return page(row.title + ' · Exposé', '<main class="shell listing"><div class="listing-heading">' +
    '<p class="listing-location">' + escapeHtml(row.location) + '</p><h1>' + title + '</h1></div>' +
    '<div class="listing-grid"><section aria-labelledby="listing-description-title">' + photo +
    '<div class="listing-description"><h2 id="listing-description-title">Über das Objekt</h2>' +
    '<p class="listing-description-text">' + escapeHtml(row.description) + '</p></div></section>' +
    '<aside class="listing-card" aria-label="Miete und Besichtigung"><p class="listing-price">' +
    euros.format(row.rent_cents / 100) + '</p><p class="listing-price-label">Warmmiete</p><dl class="listing-facts">' +
    '<div><dt>Wohnfläche</dt><dd>' + numbers.format(row.area) + ' m²</dd></div>' +
    '<div><dt>Zimmer</dt><dd>' + numbers.format(row.rooms) + '</dd></div></dl>' +
    '<a class="download viewing-button" href="/webview?objekt=' + encodeURIComponent(row.id) + '">' +
    'Besichtigung buchen</a></aside></div></main>');
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

async function discardUnreferencedPhoto(env, id, key) {
  try {
    const row = await env.DB.prepare('SELECT photo_key FROM rental_listings WHERE id = ?').bind(id).first();
    if (row?.photo_key !== key) await env.BUCKET.delete(key);
  } catch {
    // Keep the image when a failed read prevents verifying its reference.
  }
}

async function saveListing(request, env, id) {
  const invalid = (problem, values = {}) => reply(adminForm({ id, problem, values }), 422, PRIVATE);
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
  const listingId = id ?? values.id;
  if (!idPattern.test(listingId)) return invalid('Bitte laden Sie das Formular neu.');
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

  let previousPhoto;
  try {
    if (id && upload) {
      const row = await env.DB.prepare('SELECT photo_key FROM rental_listings WHERE id = ?').bind(id).first();
      if (!row) return adminNotice('Objekt nicht gefunden', '<p><a href="/admin">Zur Verwaltung</a></p>', 404);
      previousPhoto = row.photo_key;
    }
    if (upload) await env.BUCKET.put(upload.key, upload.data, { httpMetadata: { contentType: upload.mime } });
    const metadata = [values.title, values.location, Math.round(rent * 100), area, rooms, values.description];
    let result;
    if (id) {
      const update = 'UPDATE rental_listings SET title = ?, location = ?, rent_cents = ?, area = ?, rooms = ?, description = ?';
      result = upload
        ? await env.DB.prepare(update + ', photo_key = ? WHERE id = ? AND photo_key IS ?')
          .bind(...metadata, upload.key, listingId, previousPhoto).run()
        : await env.DB.prepare(update + ' WHERE id = ?').bind(...metadata, listingId).run();
    } else {
      result = await env.DB.prepare(
        'INSERT INTO rental_listings (id, title, location, rent_cents, area, rooms, description, photo_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      ).bind(listingId, ...metadata, upload?.key ?? null).run();
    }
    if (result.meta.changes === 0) {
      if (upload) await discardUnreferencedPhoto(env, listingId, upload.key);
      if (id && upload) {
        return reply(adminForm({ id, values, problem: 'Das Objekt wurde zwischenzeitlich geändert. Bitte laden Sie das Formular neu.' }), 409, PRIVATE);
      }
      if (id) return adminNotice('Objekt nicht gefunden', '<p><a href="/admin">Zur Verwaltung</a></p>', 404);
    }
  } catch {
    if (upload) await discardUnreferencedPhoto(env, listingId, upload.key);
    return reply(adminForm({ id, values, problem: 'Das Objekt konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.' }), 503, PRIVATE);
  }
  if (previousPhoto) await discardUnreferencedPhoto(env, listingId, previousPhoto);
  return redirect('/admin?' + (id ? 'saved=' : 'created=') + listingId + '#objects');
}

async function changeListingStatus(request, env, id) {
  let active;
  try { active = (await request.formData()).get('active'); }
  catch { return reply('Ungültiges Formular', 400, PRIVATE); }
  if (active !== '0' && active !== '1') return reply('Ungültiger Status', 422, PRIVATE);
  const result = await env.DB.prepare('UPDATE rental_listings SET is_active = ? WHERE id = ?').bind(Number(active), id).run();
  if (!result.meta.changes) {
    return adminNotice('Objekt nicht gefunden', '<p><a href="/admin">Zur Verwaltung</a></p>', 404);
  }
  return redirect('/admin?' + (active === '1' ? 'shown=' : 'hidden=') + id + '#objects');
}

const adminListingPath = new RegExp('^/admin/objekte/(' + ID + ')(/status)?$');

async function handleAdmin(request, url, env) {
  const path = url.pathname.replace(/\/$/, '');
  const match = path.match(adminListingPath);
  const dashboard = path === '/admin';
  const create = path === '/admin/objekte';
  if (!dashboard && !create && !match) return adminNotice('Seite nicht gefunden', '<p><a href="/admin">Zur Verwaltung</a></p>', 404);
  const id = match?.[1];
  const statusChange = Boolean(match?.[2]);
  const allow = dashboard ? 'GET' : statusChange ? 'POST' : 'GET, POST';
  if (!allow.split(', ').includes(request.method)) {
    return reply('Method not allowed', 405, { ...PRIVATE, allow });
  }

  const access = adminAccess(request, env);
  const write = request.method === 'POST';
  if (write && (access !== 'allowed' || request.headers.get('origin') !== url.origin)) {
    return reply('Forbidden', 403, PRIVATE);
  }
  if (access === 'unconfigured') return adminNotice('Verwaltung', '<p>Der Verwaltungszugang ist noch nicht eingerichtet.</p>', 503);
  if (access === 'denied') return adminNotice('Kein Zugriff', '<p>Dieses Konto hat keinen Zugriff auf die Verwaltung.</p><p>' + adminSignOut + '</p>', 403);
  if (access === 'anonymous') {
    const returnTo = escapeHtml(encodeURIComponent(url.pathname + url.search));
    return adminNotice('Verwaltung', '<a class="download" href="/signin-with-chatgpt?return_to=' + returnTo +
      '" target="_top">Mit ChatGPT anmelden</a>', 401);
  }

  try {
    await ensureOriginalListing(env.DB);
    if (dashboard) return await adminDashboard(url, env);
    if (statusChange) return await changeListingStatus(request, env, id);
    if (write) return await saveListing(request, env, id);
    if (create) return reply(adminForm(), 200, PRIVATE);
    const values = await env.DB.prepare(
      'SELECT title, location, rent_cents / 100.0 AS rent, area, rooms, description FROM rental_listings WHERE id = ?',
    ).bind(id).first();
    if (!values) return adminNotice('Objekt nicht gefunden', '<p><a href="/admin">Zur Verwaltung</a></p>', 404);
    return reply(adminForm({ id, values }), 200, PRIVATE);
  } catch {
    return adminNotice('Verwaltung', '<p>Die Verwaltung ist vorübergehend nicht erreichbar.</p><p><a href="/admin">Erneut versuchen</a></p>', 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith(apiPrefix)) return handleWebviewApi(request, env, url);
    if (path === '/admin' || path.startsWith('/admin/')) return handleAdmin(request, url, env);

    if (!['GET', 'HEAD'].includes(request.method)) return reply('Method not allowed', 405, { allow: 'GET, HEAD' });
    const body = data => request.method === 'HEAD' ? null : data;

    if (path === '/webview' || path === '/webview/' || path === '/webview.html') {
      return reply(body(staticText('/webview.html')), 200, {
        ...PRIVATE,
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
      });
    }

    if (path === '/' || path === '/index.html') {
      const home = staticText('/index.html');
      try {
        await ensureOriginalListing(env.DB);
        const listings = await env.DB.prepare(
          'SELECT id, title, location, rent_cents, area, photo_key FROM rental_listings WHERE is_active = 1 ORDER BY created_at DESC, id DESC',
        ).all();
        const catalog = listings.results.some(row => row.id === originalListingId)
          ? home.replace(/<!-- original-listing -->[\s\S]*?<!-- end-original-listing -->/, '')
          : home;
        return reply(body(catalog.replace('<!-- rental-listings -->', () => listings.results.map(card).join(''))), 200, { 'cache-control': 'no-cache' });
      } catch {
        console.error('Unable to read rental catalog from D1');
        return reply(body(home), 200, { 'cache-control': 'no-store' });
      }
    }

    const listing = path.match(listingPath);
    if (listing) {
      const row = await env.DB.prepare('SELECT * FROM rental_listings WHERE id = ? AND is_active = 1').bind(listing[1]).first();
      if (row) return reply(body(detail(row)), 200, { 'cache-control': 'no-cache' });
      return reply(body('Objekt nicht gefunden'), 404);
    }

    const photo = path.match(photoPath);
    if (photo) {
      const row = await env.DB.prepare('SELECT 1 FROM rental_listings WHERE photo_key = ? AND is_active = 1').bind(photo[1]).first();
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
