ALTER TABLE rental_listings ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
--> statement-breakpoint
CREATE TABLE webview_users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE webview_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES webview_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX webview_users_created_at ON webview_users (created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX webview_sessions_expiry ON webview_sessions (expires_at);
--> statement-breakpoint
CREATE TABLE webview_bookings (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES webview_users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES rental_listings(id),
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, listing_id, visit_date)
);
--> statement-breakpoint
CREATE TABLE webview_auth_limits (
  key TEXT PRIMARY KEY NOT NULL,
  window_end INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX webview_auth_limits_expiry ON webview_auth_limits (window_end);
