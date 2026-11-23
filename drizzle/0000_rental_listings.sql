CREATE TABLE rental_listings (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  rent_cents INTEGER NOT NULL CHECK (rent_cents > 0),
  area REAL NOT NULL CHECK (area > 0),
  rooms REAL NOT NULL CHECK (rooms > 0),
  description TEXT NOT NULL,
  photo_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX rental_listings_created_at ON rental_listings (created_at DESC, id DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX rental_listings_photo_key ON rental_listings (photo_key) WHERE photo_key IS NOT NULL;
