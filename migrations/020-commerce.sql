CREATE TABLE payment_methods (
  id text PRIMARY KEY CHECK (id IN ('btc', 'eth', 'ltc', 'sol', 'revolut', 'paypal')),
  name text NOT NULL,
  network text,
  destination text NOT NULL,
  recipient_name text NOT NULL DEFAULT '',
  instructions text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  currencies text[] NOT NULL DEFAULT ARRAY['USD','EUR','GBP'],
  sort_order integer NOT NULL DEFAULT 0,
  confirmation_threshold integer CHECK (confirmation_threshold BETWEEN 1 AND 10000),
  expires_minutes integer NOT NULL DEFAULT 30 CHECK (expires_minutes BETWEEN 5 AND 1440)
);

INSERT INTO payment_methods (id, name, network, destination, recipient_name, instructions, enabled, sort_order)
VALUES
  ('btc', 'Bitcoin', 'Bitcoin Mainnet', 'bc1qp3d9ay0vcl30ketz3amacxvvj3es5ms5lgzdpq', '', 'Send the exact quoted amount on Bitcoin Mainnet. Submit the transaction hash for verification after broadcasting the transfer.', false, 1),
  ('eth', 'Ethereum', 'Ethereum Mainnet', '0x3Fb5eC76dCa4DEc5b9b0a378D2c7F65350a360C7', '', 'Send native ETH on Ethereum Mainnet. Submit the transaction hash for verification after broadcasting the transfer.', false, 2),
  ('ltc', 'Litecoin', 'Litecoin Mainnet', 'LQaaeXAK27XFHab9JAXkFxGVpjNtzTG7au', '', 'Send the exact quoted amount on Litecoin Mainnet. Submit the transaction hash for verification after broadcasting the transfer.', false, 3),
  ('sol', 'Solana', 'Solana Mainnet', 'GV2292A261gAfmKeEmDBEZeQppsQBZ2f5DzTvpKPb6ms', '', 'Send native SOL on Solana Mainnet. Submit the transaction signature for verification after broadcasting the transfer.', false, 4),
  ('revolut', 'Revolut', null, '@zewss', '', 'Complete your payment through Revolut using the recipient Revtag shown above. Once your transfer is complete, submit your payment reference and contact our support team with your invoice ID so we can verify your payment and process your order.', true, 5),
  ('paypal', 'PayPal', null, 'zwszews1@gmail.com', '@Zews1', 'Continue to PayPal to approve the commercial purchase. The store checks the capture status before releasing your order.', false, 6);

CREATE TABLE coupons (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{2,40}$'),
  kind text NOT NULL CHECK (kind IN ('percent','fixed','free_shipping')),
  amount integer NOT NULL CHECK (amount >= 0),
  currency text,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer CHECK (max_uses > 0),
  max_per_customer integer CHECK (max_per_customer > 0),
  first_purchase boolean NOT NULL DEFAULT false,
  min_subtotal integer NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  enabled boolean NOT NULL DEFAULT true,
  CHECK (kind != 'percent' OR amount BETWEEN 1 AND 10000),
  CHECK (kind != 'fixed' OR (amount > 0 AND currency IS NOT NULL)),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE carts (
  id uuid PRIMARY KEY,
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  coupon_code text REFERENCES coupons(code) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  UNIQUE NULLS NOT DISTINCT (cart_id, product_id, variant_id)
);

CREATE TABLE invoice_sequences (
  year integer PRIMARY KEY,
  last_number integer NOT NULL CHECK (last_number > 0)
);

CREATE TABLE checkout_identities (
  identity_hash text PRIMARY KEY
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id text UNIQUE NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  cart_id uuid NOT NULL,
  email text NOT NULL,
  customer_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment','awaiting_verification','payment_under_review','paid','processing',
    'completed','cancelled','expired','refunded','partially_refunded','disputed'
  )),
  currency text NOT NULL,
  subtotal integer NOT NULL CHECK (subtotal >= 0),
  discount integer NOT NULL CHECK (discount >= 0 AND discount <= subtotal),
  tax integer NOT NULL CHECK (tax >= 0),
  shipping integer NOT NULL CHECK (shipping >= 0),
  total integer NOT NULL CHECK (total > 0 AND total = subtotal - discount + tax + shipping),
  fee integer NOT NULL DEFAULT 0 CHECK (fee >= 0),
  refund_total integer NOT NULL DEFAULT 0 CHECK (refund_total >= 0 AND refund_total <= total),
  method_id text NOT NULL REFERENCES payment_methods(id),
  payment_name text NOT NULL,
  destination text NOT NULL,
  recipient_name text NOT NULL DEFAULT '',
  network text,
  confirmation_threshold integer,
  payment_instructions text NOT NULL,
  crypto_amount text,
  quoted_at timestamptz,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  coupon_code text,
  shipping_address jsonb,
  issuer jsonb,
  reservation_released boolean NOT NULL DEFAULT false,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  idempotency_scope text NOT NULL,
  UNIQUE (idempotency_scope, idempotency_key)
);
CREATE INDEX orders_customer_idx ON orders(user_id, created_at DESC);
CREATE INDEX orders_guest_idx ON orders(cart_id, created_at DESC);
CREATE INDEX orders_email_idx ON orders(email, created_at DESC);
CREATE INDEX orders_queue_idx ON orders(status, expires_at);
CREATE INDEX orders_coupon_idx ON orders(coupon_code, email) WHERE coupon_code IS NOT NULL;

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES variants(id) ON DELETE SET NULL,
  name text NOT NULL,
  variant_name text,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  unit_price integer NOT NULL CHECK (unit_price >= 0),
  cost integer,
  kind text NOT NULL CHECK (kind IN ('download','license','service','physical')),
  reserved_product boolean NOT NULL DEFAULT false,
  reserved_variant boolean NOT NULL DEFAULT false
);
CREATE INDEX order_items_order_idx ON order_items(order_id);
CREATE INDEX order_items_product_idx ON order_items(product_id);

ALTER TABLE license_keys ADD FOREIGN KEY (assigned_order_item) REFERENCES order_items(id);
CREATE INDEX license_keys_available_idx ON license_keys(product_id) WHERE assigned_order_item IS NULL;

CREATE TABLE order_assets (
  order_item_id uuid NOT NULL REFERENCES order_items(id),
  asset_id uuid NOT NULL REFERENCES digital_assets(id),
  PRIMARY KEY (order_item_id, asset_id)
);

CREATE TABLE downloads (
  order_item_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  last_download_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_item_id, asset_id),
  FOREIGN KEY (order_item_id, asset_id) REFERENCES order_assets(order_item_id, asset_id)
);

CREATE TABLE payments (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  provider_order_id text UNIQUE,
  transaction_id text,
  status text NOT NULL DEFAULT 'pending',
  approval_url text,
  verified_at timestamptz
);

CREATE TABLE payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  reference text NOT NULL,
  note text NOT NULL DEFAULT '',
  receipt_filename text,
  receipt_type text,
  receipt bytea,
  status text NOT NULL DEFAULT 'submitted',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX payment_submissions_order_idx ON payment_submissions(order_id, created_at DESC);

CREATE TABLE transaction_references (
  method_id text NOT NULL REFERENCES payment_methods(id),
  reference text NOT NULL,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  received_amount text NOT NULL,
  confirmations integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (method_id, reference)
);

CREATE TABLE invoices (
  id text PRIMARY KEY REFERENCES orders(invoice_id),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider_id text UNIQUE,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key)
);

CREATE TABLE provider_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE order_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
