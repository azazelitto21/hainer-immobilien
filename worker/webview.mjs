const apiPrefix = '/api/webview/';
const sessionCookie = '__Host-webview_session';
const sessionDuration = 7 * 24 * 60 * 60;
const authWindow = 15 * 60;
const passwordIterations = 100_000;
const encoder = new TextEncoder();
const berlinCalendar = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: 'numeric', day: 'numeric',
});
const bookingColumns = 'id, listing_id, title, location, visit_date, visit_time, created_at';
const viewingTimes = Array.from({ length: 8 }, (_, index) => (index + 10) + ':00');

function apiJson(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { ...PRIVATE, 'x-content-type-options': 'nosniff', ...headers } });
}

function apiError(error, status, headers) {
  return apiJson({ error }, status, headers);
}

function bookingWindow() {
  const parts = Object.fromEntries(berlinCalendar.formatToParts().map(part => [part.type, part.value]));
  const dateAfter = days => new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days))
    .toISOString().slice(0, 10);
  return { minDate: dateAfter(3), maxDate: dateAfter(30) };
}

function validViewingDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { minDate, maxDate } = bookingWindow();
  if (value < minDate || value > maxDate) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function base64url(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function unbase64url(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
}

async function hashToken(token) {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return base64url(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt, iterations: passwordIterations,
  }, key, 256));
}

function equalHash(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function cookieHeader(token, maxAge) {
  return sessionCookie + '=' + token + '; Path=/; Max-Age=' + maxAge + '; Secure; HttpOnly; SameSite=Lax';
}

async function requestTokenHash(request) {
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-webview_session=([\w-]{43})(?:;|$)/);
  return cookie ? hashToken(cookie[1]) : null;
}

async function sessionUser(db, tokenHash) {
  if (!tokenHash) return null;
  return db.prepare(
    'SELECT u.id, u.email FROM webview_sessions s JOIN webview_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
}

async function startSession(db, userId, oldTokenHash, newUser = null) {
  const now = Math.floor(Date.now() / 1000);
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const statements = [
    db.prepare(`INSERT INTO webview_sessions (token_hash, user_id, expires_at)
      SELECT ?, id, ? FROM webview_users WHERE id = ?`)
      .bind(await hashToken(token), now + sessionDuration, userId),
    db.prepare('DELETE FROM webview_sessions WHERE expires_at <= ?').bind(now),
  ];
  if (oldTokenHash) {
    statements.push(db.prepare(`DELETE FROM webview_sessions WHERE token_hash = ?
      AND EXISTS (SELECT 1 FROM webview_users WHERE id = ?)`).bind(oldTokenHash, userId));
  }
  if (newUser) {
    statements.unshift(db.prepare(`INSERT INTO webview_users (id, email, password_salt, password_hash)
      VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`).bind(
      userId, newUser.email, newUser.salt, newUser.hash,
    ));
  }
  const result = await db.batch(statements);
  if (!result[newUser ? 1 : 0].meta.changes) return null;
  return { 'set-cookie': cookieHeader(token, sessionDuration) };
}

async function smallJson(request) {
  if (!request.headers.get('content-type')?.split(';')[0].trim().match(/^application\/json$/i) || !request.body) {
    return null;
  }
  if (Number(request.headers.get('content-length')) > 4096) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function allowedAuthAttempt(request, db, action) {
  const now = Math.floor(Date.now() / 1000);
  const address = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = await hashToken(action + ':' + address);
  const [, attempt] = await db.batch([
    db.prepare('DELETE FROM webview_auth_limits WHERE window_end <= ?').bind(now),
    db.prepare(`INSERT INTO webview_auth_limits (key, window_end, attempts) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET attempts = MIN(webview_auth_limits.attempts + 1, 31)
      RETURNING attempts`).bind(key, now + authWindow),
  ]);
  return attempt.results[0].attempts <= (action === 'register' ? 10 : 30);
}

async function authenticate(request, db, action, oldTokenHash) {
  const body = await smallJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body?.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return apiError('Bitte geben Sie eine gültige E-Mail-Adresse und ein Passwort mit 12 bis 128 Zeichen ein.', 422);
  }

  if (!await allowedAuthAttempt(request, db, action)) {
    return apiError('Zu viele Versuche. Bitte versuchen Sie es später erneut.', 429, { 'retry-after': String(authWindow) });
  }

  if (action === 'register') {
    const id = crypto.randomUUID();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await passwordHash(password, salt);
    const headers = await startSession(db, id, oldTokenHash, { email, salt: base64url(salt), hash });
    if (!headers) return apiError('Für diese E-Mail-Adresse gibt es bereits ein Konto.', 409);
    return apiJson({ user: { id, email } }, 201, headers);
  }

  const user = await db.prepare(
    'SELECT id, email, password_salt, password_hash FROM webview_users WHERE email = ?',
  ).bind(email).first();
  const salt = user ? unbase64url(user.password_salt) : new Uint8Array(16);
  const hash = await passwordHash(password, salt);
  if (!user || !equalHash(hash, user.password_hash)) return apiError('E-Mail-Adresse oder Passwort ist falsch.', 401);
  const headers = await startSession(db, user.id, oldTokenHash);
  if (!headers) return apiError('E-Mail-Adresse oder Passwort ist falsch.', 401);
  return apiJson({ user: { id: user.id, email: user.email } }, 200, headers);
}

async function webviewListings(db) {
  await ensureOriginalListing(db);
  const { results } = await db.prepare(`SELECT id, title, location, rent_cents, area, rooms, description, photo_key
    FROM rental_listings WHERE is_active = 1 ORDER BY created_at DESC, id DESC`).all();
  return apiJson({
    ...bookingWindow(),
    listings: results.map(({ photo_key, ...row }) => ({
      ...row,
      photo_url: listingPhoto({ id: row.id, photo_key }),
      detail_url: '/objekte/' + row.id,
    })),
  });
}

async function availableViewingTimes(db, user, params) {
  const listingId = params.get('listingId') ?? '';
  const date = params.get('visitDate');
  if (!idPattern.test(listingId) || !validViewingDate(date)) {
    return apiError('Bitte wählen Sie ein Datum innerhalb des Buchungszeitraums.', 422);
  }

  const listing = await db.prepare('SELECT 1 FROM rental_listings WHERE id = ? AND is_active = 1').bind(listingId).first();
  if (!listing) return apiError('Dieses Objekt ist zurzeit nicht verfügbar.', 404);
  const { results } = await db.prepare(
    'SELECT user_id, visit_time FROM webview_bookings WHERE listing_id = ? AND visit_date = ?',
  ).bind(listingId, date).all();
  const alreadyBooked = results.some(row => row.user_id === user.id);
  const reserved = new Set(results.map(row => row.visit_time));
  return apiJson({ alreadyBooked, times: alreadyBooked ? [] : viewingTimes.filter(time => !reserved.has(time)) });
}

async function webviewBookings(request, db, user) {
  if (request.method === 'GET') {
    const { results } = await db.prepare(
      'SELECT ' + bookingColumns + ' FROM webview_bookings WHERE user_id = ? ORDER BY visit_date DESC, visit_time DESC, created_at DESC, id DESC',
    ).bind(user.id).all();
    return apiJson({ bookings: results });
  }

  const body = await smallJson(request);
  if (typeof body?.listingId !== 'string' || !idPattern.test(body.listingId) ||
      !validViewingDate(body.visitDate) || !viewingTimes.includes(body.visitTime)) {
    return apiError('Bitte wählen Sie ein verfügbares Datum und eine gültige Uhrzeit aus.', 422);
  }

  const booking = await db.prepare(`
    INSERT INTO webview_bookings (id, user_id, listing_id, title, location, visit_date, visit_time)
    SELECT ?, ?, id, title, location, ?, ? FROM rental_listings WHERE id = ? AND is_active = 1
    ON CONFLICT DO NOTHING
    RETURNING ${bookingColumns}
  `).bind(crypto.randomUUID(), user.id, body.visitDate, body.visitTime, body.listingId).first();
  if (booking) return apiJson({ booking }, 201);
  const listing = await db.prepare('SELECT 1 FROM rental_listings WHERE id = ? AND is_active = 1').bind(body.listingId).first();
  return listing
    ? apiError('Dieser Termin ist nicht mehr verfügbar oder Sie haben bereits eine Buchung für dieses Objekt an diesem Tag.', 409)
    : apiError('Dieses Objekt ist zurzeit nicht verfügbar.', 404);
}

async function handleWebviewApi(request, env, url) {
  const action = url.pathname.slice(apiPrefix.length);
  const methods = {
    session: ['GET'], register: ['POST'], login: ['POST'], logout: ['POST'],
    listings: ['GET'], availability: ['GET'], bookings: ['GET', 'POST'],
  };
  const allowed = Object.hasOwn(methods, action) ? methods[action] : null;
  if (!allowed) return apiError('Seite nicht gefunden.', 404);
  if (!allowed.includes(request.method)) return apiError('Methode nicht erlaubt.', 405, { allow: allowed.join(', ') });
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) {
    return apiError('Anfrage nicht erlaubt.', 403);
  }

  try {
    const db = env.DB;
    const tokenHash = await requestTokenHash(request);
    if (action === 'login' || action === 'register') return await authenticate(request, db, action, tokenHash);
    if (action === 'logout') {
      if (tokenHash) await db.prepare('DELETE FROM webview_sessions WHERE token_hash = ?').bind(tokenHash).run();
      return new Response(null, { status: 204, headers: { ...PRIVATE, 'set-cookie': cookieHeader('', 0) } });
    }
    const user = await sessionUser(db, tokenHash);
    if (action === 'session') return apiJson({ user });
    if (!user) return apiError('Bitte melden Sie sich an.', 401);
    if (action === 'listings') return await webviewListings(db);
    if (action === 'availability') return await availableViewingTimes(db, user, url.searchParams);
    return await webviewBookings(request, db, user);
  } catch {
    console.error('Webview API error on ' + action);
    return apiError('Der Dienst ist gerade nicht verfügbar. Bitte versuchen Sie es später erneut.', 503);
  }
}
