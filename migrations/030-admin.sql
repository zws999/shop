CREATE TABLE product_image_uploads (
  id uuid PRIMARY KEY REFERENCES product_images(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 3145728)
);
CREATE INDEX admin_orders_created ON orders(created_at DESC);
CREATE INDEX admin_orders_paid ON orders(currency,paid_at DESC) WHERE paid_at IS NOT NULL;
