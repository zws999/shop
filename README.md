# 303 Services/Shop

303 is a storefront and owner control center for digital downloads, license keys, manual services, and physical goods. The site uses a Node.js and Express server, a browser client without a bundler, and versioned PostgreSQL migrations. Prices and fulfillment decisions come from server-side records. The initial catalog and reports are empty until the owner adds products or receives orders.

## Run locally

Install Node.js 24 with npm. From this directory, run:

```sh
npm ci
npm start
```

Open [the local store](http://127.0.0.1:3030). In development, the app uses a persistent embedded PostgreSQL engine in `.data/postgres`. The server applies outstanding migrations on startup. Use one process with this embedded database. Stop the server before running the owner CLI against the same local data directory.

To use a separate PostgreSQL instance, run `docker compose up -d postgres` with a development `POSTGRES_PASSWORD` set and configure `DATABASE_URL` in `.env`. The included Compose file starts the database only. Copy `.env.example` to `.env` to customize the port or configure providers. Keep `APP_URL` equal to the exact browser origin.

## Initialize the owner

1. Set `OWNER_EMAIL` and inject a unique `OWNER_PASSWORD` of at least 14 characters in a private terminal or one-off deployment job. The default username is `zews1009485`.
2. Run `npm run owner -- init`. Save the displayed TOTP setup key in an authenticator as a time-based, six-digit code with a 30-second period. Save the one-time recovery codes securely.
3. Remove the initialization password from the environment, start the server, and visit [303 Control Center](http://127.0.0.1:3030/admin).
4. Add categories, publish products, and upload the files or keys for digital products. Set your policies and business information before launching production checkout.

The owner can generate fresh recovery codes in Security after reauthentication. To replace the owner password and TOTP secret, use `npm run owner -- rotate` through a protected maintenance job. It revokes existing owner sessions. For sensitive settings and payment operations, reauthenticate with the next unused authenticator code.

## Payments and fulfillment

| Method | Configuration |
| --- | --- |
| Revolut | Preset to `@zewss`. Independently confirm the recipient account before launch. Customers submit a reference and may attach a receipt. |
| Bitcoin, Ethereum, Litecoin, Solana | Preset public addresses and mainnet labels. Configure `COINGECKO_API_KEY`, set `COINGECKO_PLAN=pro` for a Pro key, and enable each desired network in Payment Methods. Quotes come from CoinGecko and expire with the invoice. |
| PayPal | Configure `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_WEBHOOK_ID` and `PAYPAL_MODE`. Use REST credentials from the intended business merchant. Production requires live mode. Sandbox orders belong in a separate staging database with development runtime settings. The supplied email and handle appear in owner configuration. The API credentials determine the actual PayPal recipient. |

Optional read-only blockchain evidence uses BlockCypher for Bitcoin and Litecoin (CHAIN_LOOKUP_BLOCKCYPHER or BLOCKCYPHER_TOKEN) and trusted HTTPS mainnet RPCs for Ethereum and Solana (ETHEREUM_RPC_URL and SOLANA_RPC_URL). These lookups provide evidence for the owner review screen. They leave payment approval to the owner.

For Revolut and crypto, review the received amount and reference in the recipient account or on the specified chain before approving. A receipt or transaction hash alone provides no proof of attribution. Verify the receiving address, currency or network, amount, confirmations, and attribution to the invoice. The approval form records the amount and prevents a credited reference from being reused. Underpayments remain unresolved until reconciled. Overpayments require a recorded disposition. Late payments require stock to be available again before fulfillment.

PayPal uses a server-side Orders v2 capture and reconciliation flow. Point the configured REST app’s webhook at `https://YOUR-STORE/api/webhooks/paypal`. Subscribe to PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.PENDING, PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REFUNDED, PAYMENT.REFUND.PENDING, PAYMENT.REFUND.FAILED, and PAYMENT.CAPTURE.REVERSED after selecting the matching environment. Test with sandbox credentials in an isolated database and URL before enabling live mode. The provider webhook endpoint requires a public HTTPS address.

Digital file and key access is checked against the order and its payment state. Give each product its own delivery assets and upload inventory for license products before publishing. Check fulfillment for each product kind in staging. Physical products use the store’s configured countries and flat shipping rate. Use Control Center to fulfill manual services and shipments.

## Email

Set `RESEND_API_KEY`, `MAIL_FROM` with a sender on your verified domain, and `OWNER_EMAIL`. The server processes a database outbox with retry and delivery status. Run `npm run worker` with a regular PostgreSQL database and set `JOBS_IN_SERVER=false` on the web service if you prefer a separate worker. Development without email credentials queues messages without contacting a provider.

## Deploy

1. Create an isolated PostgreSQL database, a private migration account, and a runtime account with access to the application tables. Use a managed TLS connection and restrictive network rules. Provision an encrypted backup schedule.
2. Generate a 32-byte random key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` in a private terminal. Put the result in the host secret manager as `APP_SECRET`. Set `DATABASE_URL` and an HTTPS `APP_URL`. Set `TRUST_PROXY_HOPS` only to match the trusted proxy topology, and restrict the service so direct callers cannot spoof proxy headers.
3. Build with `docker build -t shop303 .`. With the same image and environment, run `node scripts/migrate.js` as a release job with migration credentials. Start the image with the runtime credentials, place it behind your HTTPS reverse proxy, and use `GET /healthz` for readiness. Use a protected one-off job for owner initialization. Apply deploy/runtime-grants.sql to your dedicated runtime role after migrations.
4. Set tax and shipping values in Store Settings, confirm your product classifications, and publish business identity and policies reviewed for your jurisdiction. Production checkout checks that the core policies and business identity are populated. The provided tax calculation is a configured flat rate. Confirm registration, invoice, tax, privacy, and fulfillment requirements for your actual store before accepting payments.
5. Enable only the verified payment methods you intend to accept. Validate order and email delivery on your host. Configure the proxy to accept uploads up to 16 MiB, apply connection and request limits, and prevent caching of account, admin, invoice, or API responses.

Use structured application output and the database audit log to monitor error rates and sensitive events. Alert on provider failures, repeated verification errors, overdue payment reviews, low stock, and outbox failures. Reconcile received funds, fees, refunds, and tax with the receiving accounts. Keep an off-site encrypted `pg_dump --format=custom` backup and protect a recoverable copy of `APP_SECRET` in a separate secret vault. Regularly restore into an isolated database with `pg_restore` and verify access to a test download and encrypted keys. To rotate the encryption key during maintenance, stop writers, set the new `APP_SECRET` and old `APP_SECRET_PREVIOUS`, and run `node scripts/rotate-key.js`. Remove the old secret from runtime after a successful reseal. Rotation revokes sessions and invalidates anonymous cart cookies.

## Verify

```sh
npm run check
npm test
npm audit --omit=dev
```

Tests use isolated fixtures. The default test database is embedded PostgreSQL. To run the HTTP platform tests on PostgreSQL server, set TEST_DATABASE_URL to a dedicated empty database. The test refuses an already populated schema and leaves its fixtures for inspection. Use a separate site, database, merchant sandbox, and buyer sandbox account for provider smoke tests. A production order should only be fulfilled after payment verification. Check checkout, refunds, webhook redelivery, and protected download access against staging before launch.

See [the implementation checklist](CHECKLIST.md) for scope and launch requirements.

## Provider references

- [PayPal standard payments](https://developer.paypal.com/checkout)
- [PayPal webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/)
- [PayPal refunds](https://developer.paypal.com/checkout/refund-payment)
- [CoinGecko price endpoint](https://docs.coingecko.com/reference/simple-price)
- [Resend send email API](https://resend.com/docs/api-reference/emails/send-email)
- [PostgreSQL backup and restore](https://www.postgresql.org/docs/current/app-pgdump.html)

Provider and Discord icon paths are from [Simple Icons](https://github.com/simple-icons/simple-icons). The 303 wordmark and orbital artwork are original to this project.
