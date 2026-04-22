LAEM ARCHIVE DEVELOPER SYSTEM MAP
=================================

Purpose
-------
This file is a developer-facing map of the system: routes, storage, integrations,
major workflows, and the main files that control each area.


1. High-Level Architecture
--------------------------
- Framework: Next.js App Router
- Frontend: React + Tailwind
- Primary datastore: Upstash Redis / Vercel KV-compatible REST API
- Payments: Stripe Checkout for web, Stripe Terminal for in-person POS
- File storage: Vercel Blob for product images
- Email: Resend
- Native POS client: iOS SwiftUI app in ios/LAEMPOS

The backend is mostly implemented as Next.js route handlers under app/api.
Redis acts as the main app database for products, orders, stock, reservations,
publish/archive flags, and indexes.


2. Main Customer-Facing Routes
------------------------------
/                         Homepage
  file: app/page.tsx

/shop                     Published storefront listings
  file: app/shop/page.tsx
  data source: lib/store.ts

/archive                  Published archived listings
  file: app/archive/page.tsx
  data source: lib/store.ts

/products/[slug]          Product detail page
  files:
  - app/products/[slug]/page.tsx
  - app/products/[slug]/gallery.tsx
  - app/products/[slug]/actions.tsx

/cart                     Client-side cart and checkout handoff
  files:
  - app/cart/page.tsx
  - app/cart/ui.tsx

/checkout/success         Post-payment confirmation page
  files:
  - app/checkout/success/page.tsx
  - app/checkout/success/ui.tsx

/about                    Static content
  file: app/about/page.tsx

/contact                  Static content
  file: app/contact/page.tsx


3. Admin Routes
---------------
/admin/login              Admin sign-in
  file: app/admin/login/page.tsx

/admin                    Admin landing page
  file: app/admin/page.tsx

/admin/products           Product management
  files:
  - app/admin/products/page.tsx
  - app/admin/products/stock-bulk.tsx
  - app/admin/products/image-upload-field.tsx

/admin/orders             Order fulfillment dashboard
  files:
  - app/admin/orders/page.tsx
  - app/admin/orders/ui.tsx

Admin access is protected by middleware.ts and lib/require-admin.ts.


4. Storefront / Commerce APIs
-----------------------------
/api/checkout
  file: app/api/checkout/route.ts
  purpose:
  - validates cart items
  - checks available stock
  - creates Stripe Checkout Session
  - reserves inventory before payment completes
  - now requests billing address and shipping address collection

/api/cart/refresh
  file: app/api/cart/refresh/route.ts
  purpose:
  - refreshes cart pricing and availability
  - warns if stock changed or item is unavailable

/api/stripe/webhook
  file: app/api/stripe/webhook/route.ts
  purpose:
  - processes Stripe events
  - finalizes successful orders
  - decrements stock
  - writes order records
  - releases expired reservations
  - stores shipping address from Stripe Checkout on the order record


5. Admin APIs
-------------
/api/admin/auth/login
  file: app/api/admin/auth/login/route.ts
  purpose: creates signed admin session cookie

/api/admin/auth/logout
  file: app/api/admin/auth/logout/route.ts
  purpose: clears admin session cookie

/api/admin/blob/upload
  file: app/api/admin/blob/upload/route.ts
  purpose: upload flow for product images

/api/admin/products/save
  file: app/api/admin/products/save/route.ts
  purpose: create/update product records

/api/admin/products/delete
  file: app/api/admin/products/delete/route.ts
  purpose:
  - blocks deletion for live products
  - reconciles reservation holds
  - only deletes hidden/archived products with no active hold

/api/admin/products/stock-bulk
  file: app/api/admin/products/stock-bulk/route.ts
  purpose: batch inventory updates

/api/admin/orders
  file: app/api/admin/orders/route.ts
  purpose: paginated order listing for admin UI

/api/admin/orders/ship
  file: app/api/admin/orders/ship/route.ts
  purpose:
  - marks order shipped
  - stores tracking info
  - sends shipped email

/api/admin/orders/resolve
  file: app/api/admin/orders/resolve/route.ts
  purpose: marks stock-conflict orders as resolved


6. POS / Terminal APIs
----------------------
/api/pos/auth/login
  file: app/api/pos/auth/login/route.ts
  purpose: creates POS staff session

/api/pos/products
  file: app/api/pos/products/route.ts
  purpose: returns POS catalog

/api/terminal/connection-token
  file: app/api/terminal/connection-token/route.ts
  purpose: creates Stripe Terminal connection token

/api/terminal/create-payment-intent
  file: app/api/terminal/create-payment-intent/route.ts
  purpose:
  - calculates total from backend product data
  - creates Terminal PaymentIntent
  - reserves inventory for in-person sale

/api/terminal/cancel-payment-intent
  file: app/api/terminal/cancel-payment-intent/route.ts
  purpose: cancels abandoned Terminal PaymentIntents and releases reservation holds


7. Data Storage in Redis / KV
-----------------------------
Defined in lib/kv.ts.

Product keys
- products
- product:{slug}
- products:index

Inventory keys
- stock:{slug}
- reserved:{slug}
- archived:{slug}
- published:{slug}

Order keys
- order:{id}
- orders:index

Reservation keys
- reservation:{sessionId}
- reservations:expiring

Meaning
- products: array snapshot of catalog
- product:{slug}: direct lookup record for one product
- stock:{slug}: live remaining stock
- reserved:{slug}: inventory held by active checkout/terminal reservations
- order:{id}: normalized order record
- reservation:{sessionId}: active/completed/released reservation hash
- reservations:expiring: sorted index of reservation expirations


8. Order Record Shape
---------------------
Defined in lib/orders.ts.

Important fields:
- id
- slug
- items[]
- email
- created
- quantity
- amount_total
- currency
- status
- channel
- stripeObjectType
- shippingAddress
- shipping
- conflictResolution

shippingAddress
- customer shipping address collected from Stripe Checkout
- includes name, phone, line1, line2, city, state, postalCode, country

shipping
- admin-entered shipment/tracking data
- carrier, trackingNumber, trackingUrl, shippedAt

status values
- paid
- shipped
- stock_conflict
- conflict_resolved


9. Product Record Shape
-----------------------
Defined in lib/store.ts.

Important fields:
- slug
- title
- subtitle
- description
- priceCents
- stock
- archived
- published
- autoArchiveOnZero
- images[]
- materials
- dimensions
- care
- shippingReturns


10. Inventory and Reservation Logic
-----------------------------------
Main file: lib/inventory.ts

Responsibilities
- available stock calculation
- stock decrement / atomic decrement
- reservation creation for checkout or terminal flows
- reservation release on expiry/cancel/failure
- reservation consumption when payment succeeds
- reconciliation of reserved stock
- hold summaries used by admin delete flow

Important concept
- Web checkout and Terminal checkout reserve stock before payment completes.
- The reservation is later consumed on success or released on failure/expiry.
- Product deletion is blocked while a real hold still exists.


11. Authentication and Sessions
-------------------------------
Admin auth
- middleware.ts guards /admin/* and /api/admin/*
- lib/admin-session.ts creates and verifies HMAC-signed cookie tokens
- cookie name: laem_admin_session

POS auth
- lib/pos-session.ts manages staff POS session tokens
- used by /api/pos/* and /api/terminal/*


12. Image Storage
-----------------
Blob integration
- lib/blob.ts
- app/api/admin/blob/upload/route.ts

Pattern
- admin uploads image
- app stores returned Blob public URL in product.images[]
- storefront/gallery renders image URLs directly


13. Email Flow
--------------
Files
- lib/email.ts
- lib/emailTemplates.ts

Current messages
- order received
- shipped notification
- inventory alerts

Provider
- Resend


14. iOS POS App
---------------
Folder: ios/LAEMPOS

Key files
- ios/LAEMPOS/App/LAEMPOSApp.swift
- ios/LAEMPOS/Configuration/AppConfiguration.swift
- ios/LAEMPOS/Services/APIClient.swift
- ios/LAEMPOS/Services/LAEMTerminalManager.swift
- ios/LAEMPOS/ViewModels/POSViewModel.swift
- ios/LAEMPOS/Views/POSRootView.swift
- ios/LAEMPOS/Views/ReaderSheetView.swift
- ios/LAEMPOS/Views/OrderResultView.swift

Purpose
- staff-only iPad POS shell
- catalog loading from backend
- Stripe Terminal reader management
- PaymentIntent creation/capture via backend
- final order creation still happens through Stripe webhook


15. Checkout and Order Lifecycle
--------------------------------
Web order flow
1. Customer adds item(s) to cart.
2. Frontend posts to /api/checkout.
3. Backend validates stock and creates Stripe Checkout Session.
4. Backend reserves inventory.
5. Customer pays in Stripe Checkout.
6. Stripe sends checkout.session.completed webhook.
7. Webhook consumes reservation, decrements stock, writes order record.
8. Order shows in /admin/orders as paid.
9. Admin marks shipped later and tracking is stored.

POS order flow
1. Staff signs into POS app.
2. POS app loads products from /api/pos/products.
3. POS app creates Terminal PaymentIntent via backend.
4. Backend reserves stock.
5. Reader collects payment.
6. Capture completes if manual capture is enabled.
7. Stripe webhook finalizes the order in the same order/inventory pipeline.


16. Current Integration Gaps / Important Caveats
------------------------------------------------
- Shipping address is now stored for web Stripe Checkout orders, not Terminal POS orders.
- Shipping label purchase / printing API is not implemented yet.
- Orders currently store shipment tracking after admin action, not automatic fulfillment output.
- There are multiple in-progress local changes in this repo unrelated to this map, so review git status before broad commits.


17. Environment Variables To Know First
---------------------------------------
Core commerce
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- SITE_URL
- STRIPE_SHIPPING_ALLOWED_COUNTRIES

Redis / KV
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN
- KV_REST_API_URL
- KV_REST_API_TOKEN

Admin
- ADMIN_TOKEN
- ADMIN_SESSION_SECRET

Blob
- BLOB_READ_WRITE_TOKEN

Email
- RESEND_API_KEY
- EMAIL_FROM
- RESEND_FROM
- INVENTORY_ALERT_EMAIL
- ADMIN_ALERT_EMAIL

POS / Terminal
- POS_APP_TOKEN
- POS_SESSION_SECRET
- POS_SESSION_TTL_SECONDS
- STRIPE_TERMINAL_LOCATION_ID
- POS_CURRENCY


18. First Files To Read If You Are New
--------------------------------------
Start here in order:
1. README.md
2. lib/kv.ts
3. lib/store.ts
4. lib/inventory.ts
5. lib/orders.ts
6. app/api/checkout/route.ts
7. app/api/stripe/webhook/route.ts
8. app/admin/products/page.tsx
9. app/admin/orders/ui.tsx
10. ios/LAEMPOS/README.md


19. Recommended Next Step For A Developer
-----------------------------------------
If the goal is fulfillment automation through a printing or label API:
1. read lib/orders.ts and confirm shippingAddress requirements
2. inspect app/admin/orders/ui.tsx to understand current manual fulfillment
3. add a fulfillment provider abstraction in lib/
4. create an admin or webhook-triggered fulfillment route
5. persist provider job IDs / label URLs onto the order record
6. decide whether fulfillment should auto-run on paid, or require admin approval
