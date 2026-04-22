# LAEM POS iOS App

This folder contains a minimal staff-only iOS POS scaffold for LAEM.

## What works now

- SwiftUI catalog and checkout shell
- Backend-backed product loading through `/api/pos/products`
- Reader setup sheet backed by Stripe Terminal SDK
- Switchable reader-family setup for Bluetooth mobile readers and smart internet readers
- Bluetooth discovery and connect flow for Stripe Reader M2
- Internet discovery and connect flow scaffolding for Stripe Reader S700/S710 style readers
- Last-reader preference and automatic reconnect attempt during discovery
- Backend-created Terminal PaymentIntents so price, stock reservation, and order metadata come from LAEM
- Basic disconnect, reconnect, low-battery, and duplicate-operation handling
- Offline queue status surfaced in the app; payment creation still requires backend reachability before collection

The project now pulls `StripeTerminal` through Swift Package Manager, so there is no vendored SDK copy to keep in the repo.

## What still needs to be configured

- Point `LAEMAPIBaseURL` at the running LAEM backend
- Sign in with the LAEM POS staff passcode that matches `POS_APP_TOKEN` on the backend, or `ADMIN_TOKEN` if you are using the fallback
- Set `STRIPE_TERMINAL_LOCATION_ID` on the backend for first-time Bluetooth reader connections
- Enable Stripe Terminal offline mode on the Stripe Terminal Configuration only if you intentionally support stored offline payments later
- Decide whether to keep `LAEMTerminalUseSimulatedReader` on for local testing
- Test with a simulated reader first, then with the physical reader you plan to deploy in test mode
- Keep the event-day fallback notes handy in `docs/laem-pos-emergency-sales-sop.md`

## Configuration

Edit `Resources/Info.plist`:

- `LAEMAPIBaseURL`
- `LAEMTerminalCaptureMethod`
- `LAEMTerminalDiscoveryTimeoutSeconds`
- `LAEMTerminalInternetFailIfInUse`
- `LAEMTerminalOfflineStoredAmountLimitCents`
- `LAEMTerminalLocationID`
- `LAEMTerminalReaderFamily`
- `LAEMTerminalUseSimulatedReader`

## Open the app

Open `LAEMPOS.xcodeproj` in Xcode.
