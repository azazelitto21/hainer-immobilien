ALTER TABLE webview_bookings ADD COLUMN visit_time TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX webview_bookings_viewing_slot
  ON webview_bookings (listing_id, visit_date, visit_time) WHERE visit_time IS NOT NULL;
--> statement-breakpoint
CREATE INDEX webview_bookings_listing_date ON webview_bookings (listing_id, visit_date);
