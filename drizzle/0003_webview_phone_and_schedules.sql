ALTER TABLE webview_users ADD COLUMN phone TEXT;
--> statement-breakpoint
ALTER TABLE rental_listings ADD COLUMN custom_schedule INTEGER NOT NULL DEFAULT 0 CHECK (custom_schedule IN (0, 1));
--> statement-breakpoint
CREATE TABLE rental_viewing_slots (
  listing_id TEXT NOT NULL REFERENCES rental_listings(id) ON DELETE CASCADE,
  visit_date TEXT NOT NULL,
  visit_time TEXT NOT NULL,
  PRIMARY KEY (listing_id, visit_date, visit_time)
);
