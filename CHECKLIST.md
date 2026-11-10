# Implementation checklist

- [x] Original 303 storefront and owner interface with responsive layouts and reduced-motion styles.
- [x] Versioned PostgreSQL schema, catalog and variant administration, stock history, file and license inventory.
- [x] Persistent customer and guest carts, server-side totals, coupons, inventory reservation, and unique invoice references.
- [x] Revolut and crypto payment submission with owner review, verified amount recording, and reference deduplication.
- [x] PayPal Orders v2 merchant integration, signed webhooks, capture reconciliation, and provider refunds.
- [x] Paid-order authorization for protected downloads and unique license keys.
- [x] Account verification and recovery, owner TOTP and recovery codes, sensitive-operation reauthentication, and append-only audit events.
- [x] Verified-purchase review moderation, Discord link, support records, newsletter subscriber capture, and transactional outbox.
- [x] Admin reporting from recorded financial data, exports, configurable payment methods, appearance, and legal policies.
- [x] Node.js and container deployment, migration and owner initialization, automated tests, and operational documentation.
- [ ] Configure a hosted PostgreSQL instance, TLS, deployment secrets, backups, monitoring, and owner credentials.
- [ ] Provide the live catalog and business identity, review the actual store policies and tax settings, and confirm every destination.
- [ ] Activate email and eligible payment methods with the real provider accounts, then verify PayPal sandbox webhooks and capture in isolated staging.

## Scope limits

The delivered project implements the checkout and fulfillment core. The brief also calls for staff permission administration, passkeys, automatic blockchain attribution, a visual rich-text editing suite, review image attachments and reports, and conversion tracking. These are not part of this release. Crypto shared-address payments require the owner to independently attribute each transfer. The admin payment settings control readiness and public configuration, while API secrets live in the hosting environment.

File storage uses database-backed byte arrays with explicit size limits. Production hosting, managed backups, alert delivery, transaction-provider activation, and legal review depend on the deployment environment and store owner. Live charges, live refunds, provider webhook delivery, and jurisdiction-specific compliance were outside the local verification run.
