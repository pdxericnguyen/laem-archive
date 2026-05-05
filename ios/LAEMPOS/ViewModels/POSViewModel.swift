import Foundation

@MainActor
final class POSViewModel: ObservableObject {
    enum NoticeStyle {
        case info
        case warning
        case error
    }

    struct Notice: Equatable {
        let style: NoticeStyle
        let message: String
    }

    @Published private(set) var products: [Product] = []
    @Published private(set) var isLoadingProducts = false
    @Published private(set) var isCharging = false
    @Published private(set) var isAuthenticating = false
    @Published private(set) var isAuthenticated: Bool
    @Published var notice: Notice?
    @Published var checkoutResult: CheckoutResult?
    @Published var staffPasscode = ""
    @Published var authErrorMessage: String?
    @Published var showReaderSheet = false

    private let apiClient: APIClient?
    private let terminalManager: LAEMTerminalManager
    private let userDefaults: UserDefaults
    @Published private var quantitiesBySlug: [String: Int] = [:]
    private static let cachedProductsKey = "laem.pos.cached-products"

    init(apiClient: APIClient?, terminalManager: LAEMTerminalManager, userDefaults: UserDefaults = .standard) {
        self.apiClient = apiClient
        self.terminalManager = terminalManager
        self.userDefaults = userDefaults
        self.isAuthenticated = apiClient?.hasStoredAuthorization ?? true
    }

    var cartLines: [CartLine] {
        products.compactMap { product in
            guard let quantity = quantitiesBySlug[product.slug], quantity > 0 else {
                return nil
            }
            return CartLine(product: product, quantity: quantity)
        }
    }

    var totalCents: Int {
        cartLines.reduce(0) { $0 + $1.subtotalCents }
    }

    var formattedTotal: String {
        guard let line = cartLines.first else {
            return "$0.00"
        }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = line.product.currency.uppercased()
        return formatter.string(from: NSNumber(value: Double(totalCents) / 100.0)) ?? "$0.00"
    }

    var hasLiveBackend: Bool {
        apiClient != nil
    }

    var requiresAuthentication: Bool {
        hasLiveBackend && !isAuthenticated
    }

    func quantity(for product: Product) -> Int {
        quantitiesBySlug[product.slug] ?? 0
    }

    func loadProducts() async {
        guard !requiresAuthentication else {
            products = []
            return
        }

        isLoadingProducts = true
        defer { isLoadingProducts = false }

        guard let apiClient else {
            products = loadCachedProducts() ?? Product.demoCatalog
            notice = Notice(
                style: .warning,
                message: "Using cached or demo catalog. Set LAEMAPIBaseURL in Info.plist to load live products."
            )
            return
        }

        do {
            let remoteProducts = try await apiClient.fetchProducts()
            products = remoteProducts
            saveCachedProducts(remoteProducts)
            if remoteProducts.isEmpty {
                notice = Notice(style: .warning, message: "The live catalog is empty.")
            } else {
                notice = Notice(style: .info, message: "Catalog loaded from the LAEM backend.")
            }
            authErrorMessage = nil
        } catch {
            if let apiError = error as? APIClientError, apiError == .unauthorized {
                handleUnauthorizedSession()
                return
            }
            if let cachedProducts = loadCachedProducts(), !cachedProducts.isEmpty {
                products = cachedProducts
                notice = Notice(
                    style: .warning,
                    message: error.localizedDescription + " Using cached catalog so you can keep selling while offline."
                )
            } else {
                products = Product.demoCatalog
                notice = Notice(
                    style: .error,
                    message: error.localizedDescription + " Falling back to demo catalog."
                )
            }
        }
    }

    func signIn() async {
        guard let apiClient else {
            isAuthenticated = true
            authErrorMessage = nil
            await loadProducts()
            return
        }

        let password = staffPasscode.nilIfBlank ?? ""
        guard !password.isEmpty else {
            authErrorMessage = "Enter the staff POS passcode to continue."
            return
        }

        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            _ = try await apiClient.loginPOS(password: password)
            isAuthenticated = true
            staffPasscode = ""
            authErrorMessage = nil
            notice = Notice(style: .info, message: "Staff session unlocked.")
            await loadProducts()
        } catch {
            authErrorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        apiClient?.logoutPOS()
        handleUnauthorizedSession(message: "POS locked. Sign in again to continue.")
    }

    func handleUnauthorizedSession(message: String = "Staff session expired. Sign in again to continue.") {
        apiClient?.logoutPOS()
        isAuthenticated = false
        products = []
        clearCart()
        showReaderSheet = false
        authErrorMessage = message
        notice = Notice(style: .warning, message: message)
        checkoutResult = nil
        Task {
            await terminalManager.disconnectReader()
        }
    }

    func addToCart(_ product: Product) {
        updateQuantity(for: product, quantity: min(product.stock, quantity(for: product) + 1))
    }

    func removeFromCart(_ product: Product) {
        updateQuantity(for: product, quantity: max(0, quantity(for: product) - 1))
    }

    func updateQuantity(for product: Product, quantity: Int) {
        let clamped = max(0, min(product.stock, quantity))
        if clamped == 0 {
            quantitiesBySlug.removeValue(forKey: product.slug)
        } else {
            quantitiesBySlug[product.slug] = clamped
        }
    }

    func clearCart() {
        quantitiesBySlug.removeAll()
    }

    func chargeCart() async {
        guard !requiresAuthentication else {
            authErrorMessage = "Sign in before using the live payment flow."
            return
        }

        guard !cartLines.isEmpty else {
            notice = Notice(style: .warning, message: "Add at least one product before charging.")
            return
        }

        guard apiClient != nil else {
            notice = Notice(
                style: .error,
                message: "Set LAEMAPIBaseURL before using the live payment flow."
            )
            return
        }

        guard terminalManager.canBeginCheckout else {
            showReaderSheet = true
            notice = Notice(
                style: .warning,
                message: "Connect a Stripe reader before charging the cart."
            )
            return
        }

        isCharging = true
        defer { isCharging = false }

        do {
            let amountText = formattedTotal
            let terminalResult = try await terminalManager.collectPayment(
                lines: cartLines,
                email: nil,
                captureMethod: AppConfiguration.defaultCaptureMethod
            )

            if terminalResult.requiresCapture {
                throw APIClientError.server(
                    message: "Payment authorized but not captured. Check Stripe before starting another sale."
                )
            }

            checkoutResult = .success(
                reference: terminalResult.reference,
                amountText: amountText,
                storedOffline: terminalResult.storedOffline,
                paymentIntentId: terminalResult.stripePaymentIntentId
            )
            clearCart()
            let refreshError = await refreshProductsSilently()
            notice = Notice(
                style: terminalResult.storedOffline || refreshError != nil ? .warning : .info,
                message: refreshError.map {
                    "Payment completed, but the catalog could not refresh. \($0)"
                } ?? (
                    terminalResult.storedOffline
                        ? "Payment stored on this device. Reconnect to the internet so Stripe can forward it."
                        : "Payment completed successfully. Catalog refreshed."
                )
            )
        } catch {
            if let apiError = error as? APIClientError, apiError == .unauthorized {
                handleUnauthorizedSession()
                return
            }
            _ = await refreshProductsSilently()
            checkoutResult = .failure(message: error.localizedDescription)
            notice = Notice(style: .error, message: error.localizedDescription)
        }
    }

    func sendReceiptEmail(paymentIntentId: String, email: String) async throws {
        guard !requiresAuthentication else {
            authErrorMessage = "Sign in before sending a receipt."
            throw APIClientError.unauthorized
        }

        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard Self.isValidEmail(normalizedEmail) else {
            throw APIClientError.server(message: "Enter a valid email address.")
        }

        guard let apiClient else {
            throw APIClientError.server(message: "Set LAEMAPIBaseURL before sending receipts.")
        }

        _ = try await apiClient.sendTerminalReceiptEmail(
            paymentIntentId: paymentIntentId,
            email: normalizedEmail
        )
        notice = Notice(
            style: .info,
            message: "Receipt email saved for \(normalizedEmail)."
        )
    }

    private func saveCachedProducts(_ products: [Product]) {
        guard let data = try? JSONEncoder().encode(products) else {
            return
        }
        userDefaults.set(data, forKey: Self.cachedProductsKey)
    }

    private func loadCachedProducts() -> [Product]? {
        guard let data = userDefaults.data(forKey: Self.cachedProductsKey),
              let products = try? JSONDecoder().decode([Product].self, from: data),
              !products.isEmpty else {
            return nil
        }
        return products
    }

    private func refreshProductsSilently() async -> String? {
        guard let apiClient else {
            return nil
        }

        do {
            let remoteProducts = try await apiClient.fetchProducts(treatUnauthorizedAsSessionLoss: false)
            products = remoteProducts
            saveCachedProducts(remoteProducts)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private static func isValidEmail(_ value: String) -> Bool {
        guard value.count <= 320 else {
            return false
        }
        return value.contains("@") && value.contains(".")
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
