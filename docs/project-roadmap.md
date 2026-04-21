LAEM ARCHIVE PROJECT ROADMAP
===========================

Purpose
-------
This note preserves the useful project planning and developer workflow guidance
from earlier internal docs, without any tool-specific branding.


1. Product Goal
---------------
Evolve the repo into a low-inventory, drop-based storefront with:
- Next.js App Router on Vercel
- Redis / KV-backed products, stock, reservations, and orders
- Vercel Blob for image storage
- Stripe Checkout for web purchases
- Stripe Terminal for in-person POS
- Resend for customer and operational emails


2. Guiding Constraints
----------------------
- Keep the "archive / museum" presentation even for buyable items.
- Maintain a minimal UI with high whitespace and factual language.
- Archive pages should still render even if Stripe is unavailable.
- Stripe handles payment receipts; app email should stay calm and operational.
- Inventory should always be server-truth, not client-truth.


3. Local Developer Workflow
---------------------------
Recommended starting steps:
1. npm install
2. npm run dev
3. verify major routes:
   - /
   - /shop
   - /archive
   - /products/[slug]
   - /cart
   - /admin/login
4. run npm run build before finishing any meaningful change

General development habits:
- Prefer small, incremental changes
- Review diffs before commit
- Re-test the exact flow that was touched
- For checkout/order changes, always test the webhook path too


4. High-Level Build Phases
--------------------------
Phase 1: Catalog and storage
- products stored in Redis / KV
- direct slug lookups
- publish/archive states
- stock and reserved counts

Phase 2: Checkout and orders
- server-created Stripe Checkout Session
- reservation-first inventory flow
- webhook-based order finalization
- idempotent order writes

Phase 3: Admin operations
- product create/edit/publish/archive
- stock management
- order review and shipped updates
- conflict resolution for oversells

Phase 4: POS
- staff login
- POS catalog feed
- Stripe Terminal reader flow
- PaymentIntent creation and capture
- webhook finalization shared with web

Phase 5: Hardening
- idempotency and replay safety
- oversell protection
- rate limiting
- clearer internal docs
- fulfillment automation


5. Important Data Model Expectations
------------------------------------
Products should cover:
- slug
- title
- subtitle
- description
- priceCents
- stock
- archived
- published
- autoArchiveOnZero
- images
- materials
- dimensions
- care
- shippingReturns

Orders should cover:
- id
- email
- items
- status
- amount_total
- currency
- channel
- stripeObjectType
- shippingAddress
- shipping
- conflictResolution


6. Fulfillment Direction
------------------------
Current state:
- shipping address is stored for web Stripe Checkout orders
- shipment tracking is stored when admin marks an order shipped
- label purchase / printing API is not yet implemented

Recommended next fulfillment milestone:
1. add provider abstraction in lib/
2. choose whether fulfillment runs automatically on paid orders or only after admin approval
3. persist provider job ids, label urls, and fulfillment status onto the order record
4. add retry-safe behavior for provider webhooks or admin retries


7. Critical Files To Read First
-------------------------------
- README.md
- lib/kv.ts
- lib/store.ts
- lib/inventory.ts
- lib/orders.ts
- app/api/checkout/route.ts
- app/api/stripe/webhook/route.ts
- app/admin/products/page.tsx
- app/admin/orders/ui.tsx
- ios/LAEMPOS/README.md


8. Practical Sanity Checks Before Shipping Changes
--------------------------------------------------
For storefront changes:
- /shop renders
- /products/[slug] renders
- cart still updates correctly

For inventory changes:
- checkout still creates reservation
- webhook still consumes or releases reservation correctly
- admin product deletion only blocks on real active holds

For admin order changes:
- order list loads
- ship action still writes tracking
- shipped email still fires when expected

For POS changes:
- staff login works
- product feed loads
- connection token route works
- PaymentIntent creation still reserves stock
