CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  platform_role text NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user','platform_admin')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  tax_id text,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','suspended')),
  payout_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizer_members (
  organizer_id uuid NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','event_manager','box_office','finance')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizer_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  title text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other',
  venue_name text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  starts_at timestamptz,
  timezone text NOT NULL DEFAULT 'Europe/Madrid',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','published','rejected','cancelled','completed')),
  review_note text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  currency char(3) NOT NULL DEFAULT 'EUR',
  fee_type text NOT NULL DEFAULT 'fixed' CHECK (fee_type IN ('fixed','percent')),
  fee_value numeric(10,2) NOT NULL DEFAULT 0 CHECK (fee_value >= 0),
  fee_payer text NOT NULL DEFAULT 'organizer' CHECK (fee_payer IN ('organizer','buyer')),
  settlement_rule text NOT NULL DEFAULT 'after_event' CHECK (settlement_rule IN ('after_event','scheduled')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizer_id, slug)
);
CREATE INDEX IF NOT EXISTS events_org_status_idx ON events(organizer_id, status);
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events(starts_at);

CREATE TABLE IF NOT EXISTS ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  capacity integer NOT NULL CHECK (capacity > 0),
  sold_count integer NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  sale_starts_at timestamptz,
  sale_ends_at timestamptz,
  max_per_order integer NOT NULL DEFAULT 8 CHECK (max_per_order > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sold_count <= capacity)
);
CREATE INDEX IF NOT EXISTS ticket_types_event_idx ON ticket_types(event_id);

CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count integer NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, code)
);
CREATE INDEX IF NOT EXISTS promotions_event_idx ON promotions(event_id);

CREATE TABLE IF NOT EXISTS giveaways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  prize text NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  terms_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','open','closed','drawn','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_reference text NOT NULL UNIQUE,
  event_id uuid NOT NULL REFERENCES events(id),
  buyer_email text NOT NULL,
  buyer_name text NOT NULL DEFAULT '',
  currency char(3) NOT NULL DEFAULT 'EUR',
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  platform_fee_cents integer NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  organizer_net_cents integer NOT NULL DEFAULT 0 CHECK (organizer_net_cents >= 0),
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid','payment_failed','expired','partially_refunded','refunded','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS orders_event_status_idx ON orders(event_id, status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES ticket_types(id),
  ticket_name_snapshot text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total_cents integer NOT NULL CHECK (line_total_cents >= 0)
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL DEFAULT 'redsys',
  method text NOT NULL CHECK (method IN ('card','bizum','unknown')),
  provider_reference text UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','redirecting','authorized','declined','unknown','refunded')),
  provider_response_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_key text NOT NULL UNIQUE,
  payment_attempt_id uuid REFERENCES payment_attempts(id),
  signature_valid boolean NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id),
  ticket_code_hash text NOT NULL UNIQUE,
  attendee_name text NOT NULL DEFAULT '',
  attendee_email text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','checked_in','void','refunded')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  event_id uuid NOT NULL REFERENCES events(id),
  order_id uuid REFERENCES orders(id),
  entry_type text NOT NULL CHECK (entry_type IN ('sale','platform_fee','refund','chargeback','payout','adjustment','reserve')),
  amount_cents bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'EUR',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_org_event_idx ON ledger_entries(organizer_id, event_id, created_at);

CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  currency char(3) NOT NULL DEFAULT 'EUR',
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','approved','submitted','paid','rejected','returned')),
  period_start date,
  period_end date,
  external_reference text,
  approved_by uuid REFERENCES users(id),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id),
  organizer_id uuid REFERENCES organizers(id),
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
