# LAEM POS iOS Scaffold

The provided `stripe-connect-rocketrides-master.zip` is the older Rocket Rides Connect sample, not the Terminal sample that used `RRTerminalDelegate.swift`. That means LAEM should treat it as a structural warning, not as code to copy directly.

## What to keep conceptually

- One Terminal-facing manager as the single bridge between Stripe Terminal state and the UI.
- Reader discovery, reconnect, disconnect handling, and duplicate-operation guards in that manager.
- A server-driven catalog and checkout flow where product price, stock, and final order state come from the backend.

## What to delete from any Rocket Rides-derived shell

- Map and location search screens
- Ride/trip models
- Distance-based pricing
- Transportation copy and any ride-completion metaphor
- Location permissions unless you later add a real POS requirement for them

## LAEM app shape

```
LAEM POS
├── Catalog screen
├── Cart / checkout screen
├── Reader sheet
├── Payment flow
└── Order result screen
```

Suggested file layout:

- `LAEMTerminalManager.swift`
- `Models/Product.swift`
- `Screens/CatalogViewController.swift` or `Screens/CatalogView.swift`
- `Screens/CheckoutViewController.swift`
- `Screens/OrderResultViewController.swift`
- `Networking/APIClient.swift`

## Backend contract already implemented in this repo

- `GET /api/pos/products`
- `POST /api/terminal/connection-token`
- `POST /api/terminal/create-payment-intent`
- `POST /api/terminal/cancel-payment-intent`
- `POST /api/stripe/webhook`

## Recommended client flow

1. Load products from `/api/pos/products`.
2. Let staff choose product + quantity.
3. Create a Terminal PaymentIntent via `/api/terminal/create-payment-intent`.
4. Retrieve that PaymentIntent in the iOS Stripe Terminal SDK using the returned client secret.
5. Collect and confirm on-reader.
6. If collection fails before payment completion, cancel via `/api/terminal/cancel-payment-intent`.
7. Let the webhook be the source of truth for paid order creation and stock decrement.
8. Show success or failure in the result screen.

## Important guardrails

- Do not trust client-supplied amounts. LAEM’s backend now computes totals from product data.
- Do not make the iOS app the source of truth for inventory. Reserve before collection and finalize in the webhook.
- Keep reader state and payment state separate from catalog/cart state so reconnect flows do not reset the sale in progress.
