# LAEM POS iPad Test Runbook

Use this on first install day and before every event-day launch window.

## 1) Preflight (10 minutes)

- Confirm iPad has internet and battery above 50%.
- Confirm Stripe reader has battery above 50%.
- Confirm backend env is live and loaded:
  - `STRIPE_SECRET_KEY` (live or test key based on your test plan)
  - `STRIPE_WEBHOOK_SECRET`
  - `POS_APP_TOKEN`
  - `POS_SESSION_SECRET`
  - `STRIPE_TERMINAL_LOCATION_ID`
- Confirm LAEM POS icon appears as expected on install.

## 2) Install path

Choose one:

1. Xcode direct install:
   - Open `ios/LAEMPOS.xcodeproj`
   - Select your iPad as target
   - Build and Run
2. TestFlight install:
   - Archive in Xcode
   - Upload to App Store Connect
   - Add tester and install through TestFlight app

## 3) App configuration check

In `ios/LAEMPOS/Resources/Info.plist`, verify:

- `LAEMAPIBaseURL = https://laemarchive.com/`
- `LAEMTerminalCaptureMethod = automatic`
- `LAEMTerminalReaderFamily = bluetooth_mobile` (or `internet_smart` for S700/S710)
- `LAEMTerminalUseSimulatedReader = false` for real reader tests

Use simulated reader only when hardware is unavailable.

## 4) Functional test sequence

Run this exact order:

1. Open app and sign in with POS staff passcode.
2. Confirm catalog loads from backend.
3. Connect reader from Reader setup sheet.
4. Add one low-risk product to cart.
5. Complete one payment.
6. Confirm success screen shows payment reference.
7. Send receipt email from app.
8. Open `/admin/orders` and confirm order exists.
9. Open `/admin/products` and confirm stock decremented.
10. Run one cancel/failure flow and confirm reservation released.

## 5) Reconciliation check (same session)

- Stripe payment exists.
- Admin order exists.
- Product stock reflects sale quantity.
- No duplicate order created for one payment intent.

## 6) Stop/go criteria

Go for event usage only if all are true:

- POS login works
- Reader stays connected
- One full payment succeeds
- Admin order appears correctly
- Stock decrements correctly

If any fail, pause event use and follow `docs/laem-pos-emergency-sales-sop.md`.
