CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  username text NOT NULL UNIQUE CHECK (username = lower(username)),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','owner')),
  verified_at timestamptz,
  mfa_secret text,
  last_otp_step bigint NOT NULL DEFAULT -1,
  preferences jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role = 'customer' OR mfa_secret IS NOT NULL)
);
CREATE UNIQUE INDEX only_one_owner ON users(role) WHERE role = 'owner';
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  mfa_at timestamptz,
  reauth_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE account_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify','reset')),
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_tokens_user ON account_tokens(user_id,purpose);
CREATE TABLE recovery_codes (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rate_limits (
  rate_key text NOT NULL,
  bucket bigint NOT NULL,
  hits integer NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (rate_key,bucket)
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('download','license','service','physical')),
  currency char(3) NOT NULL CHECK (currency IN ('USD','EUR','GBP','RON','CAD','AUD')),
  price int NOT NULL CHECK (price BETWEEN 1 AND 100000000),
  sale_price int CHECK (sale_price > 0 AND sale_price < price),
  cost int CHECK (cost >= 0),
  stock int CHECK (stock >= 0),
  active bool NOT NULL DEFAULT false,
  featured bool NOT NULL DEFAULT false,
  publish_at timestamptz,
  tags text[] NOT NULL DEFAULT '{}',
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_catalog ON products (category_id,created_at DESC) WHERE active;
CREATE TABLE variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  price int CHECK (price BETWEEN 1 AND 100000000),
  stock int CHECK (stock >= 0),
  active bool NOT NULL DEFAULT true,
  UNIQUE(product_id,name)
);
CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt text NOT NULL DEFAULT '',
  position int NOT NULL DEFAULT 0
);
CREATE INDEX product_images_product ON product_images(product_id,position);
CREATE TABLE digital_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 15728640),
  download_limit int NOT NULL DEFAULT 3 CHECK (download_limit BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX digital_assets_product ON digital_assets(product_id);
CREATE TABLE license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  secret text NOT NULL,
  fingerprint text UNIQUE,
  assigned_order_item uuid,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX license_available ON license_keys(product_id,id) WHERE assigned_order_item IS NULL;
CREATE INDEX license_assignment ON license_keys(assigned_order_item) WHERE assigned_order_item IS NOT NULL;
CREATE TABLE inventory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES variants(id) ON DELETE SET NULL,
  delta int NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_events_product ON inventory_events(product_id,created_at DESC);

CREATE TABLE store_settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  product_id uuid NOT NULL REFERENCES products(id),
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL CHECK (length(body) BETWEEN 5 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','hidden','rejected')),
  owner_reply text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,product_id)
);
CREATE INDEX reviews_public ON reviews(product_id,created_at DESC) WHERE status = 'published';
CREATE TABLE wishlist (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,product_id)
);
CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  invoice_id text,
  email text NOT NULL,
  subject text NOT NULL,
  category text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  reply text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_by_customer ON support_tickets(user_id,created_at DESC);
CREATE TABLE newsletter (email text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_recent ON audit_logs(created_at DESC);
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient text NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  next_attempt timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  lock_id uuid,
  delivered_at timestamptz,
  failed_at timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending ON outbox(next_attempt) WHERE delivered_at IS NULL AND failed_at IS NULL;
