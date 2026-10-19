ALTER TABLE events
  ADD COLUMN IF NOT EXISTS venue_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS doors_at time,
  ADD COLUMN IF NOT EXISTS access_conditions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS source_url text;

ALTER TABLE ticket_types
  ADD COLUMN IF NOT EXISTS service_fee_cents integer NOT NULL DEFAULT 0
    CHECK (service_fee_cents >= 0);

CREATE INDEX IF NOT EXISTS events_source_url_idx ON events(source_url)
  WHERE source_url IS NOT NULL;
