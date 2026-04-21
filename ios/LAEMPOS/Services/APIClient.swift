import Foundation
import Security

enum APIClientError: LocalizedError, Equatable {
    case invalidConfiguration
    case invalidResponse
    case unauthorized
    case server(message: String)

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "Set LAEMAPIBaseURL in Info.plist to load your live catalog."
        case .invalidResponse:
            return "The server response was invalid."
        case .unauthorized:
            return "Staff session expired. Sign in again to continue."
        case let .server(message):
            return message
        }
    }
}

struct CreatePaymentIntentPayload: Encodable {
    struct Item: Encodable {
        let slug: String
        let quantity: Int
    }

    let items: [Item]
    let email: String?
    let captureMethod: String
}

struct CreatePaymentIntentResponse: Decodable {
    let ok: Bool
    let paymentIntentId: String
    let clientSecret: String
    let amount: Int
    let currency: String
    let captureMethod: String
    let expiresAt: Int
}

struct CapturePaymentIntentResponse: Decodable {
    let ok: Bool
    let paymentIntentId: String
    let status: String
    let amountReceived: Int?
    let alreadyCaptured: Bool?
}

struct SendTerminalReceiptPayload: Encodable {
    let paymentIntentId: String
    let email: String
}

struct SendTerminalReceiptResponse: Decodable {
    let ok: Bool
    let paymentIntentId: String
    let receiptEmail: String
    let alreadySet: Bool?
    let orderEmailUpdated: Bool?
}

struct TerminalConnectionTokenResponse: Decodable {
    let ok: Bool
    let secret: String
    let location: String?
}

struct POSLoginResponse: Decodable {
    let ok: Bool
    let token: String
    let expiresAt: Int
}

private struct ProductsEnvelope: Decodable {
    let ok: Bool
    let products: [Product]
}

private struct ErrorEnvelope: Decodable {
    let ok: Bool?
    let error: String?
}

private enum POSSessionKeychainStore {
    static let service = "com.laem.pos.staff-session"
    static let account = "primary"

    static func loadToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else {
            return nil
        }

        return token
    }

    static func saveToken(_ token: String) {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }

        var insert = query
        attributes.forEach { insert[$0.key] = $0.value }
        SecItemDelete(query as CFDictionary)
        SecItemAdd(insert as CFDictionary, nil)
    }

    static func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

final class APIClient: @unchecked Sendable {
    let baseURL: URL
    let session: URLSession

    private let stateLock = NSLock()
    private var storedAuthToken: String?
    private var unauthorizedHandler: (@MainActor @Sendable () -> Void)?

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.storedAuthToken = POSSessionKeychainStore.loadToken()
    }

    static func makeDefault() -> APIClient? {
        guard let baseURL = AppConfiguration.apiBaseURL else {
            return nil
        }
        return APIClient(baseURL: baseURL)
    }

    var hasStoredAuthorization: Bool {
        guard let authToken = currentAuthToken() else {
            return false
        }
        return !authToken.isEmpty
    }

    func setUnauthorizedHandler(_ handler: (@MainActor @Sendable () -> Void)?) {
        stateLock.lock()
        unauthorizedHandler = handler
        stateLock.unlock()
    }

    func loginPOS(password: String) async throws -> POSLoginResponse {
        struct LoginPayload: Encodable {
            let password: String
        }

        var request = try makeRequest(path: "api/pos/auth/login", method: "POST", includeAuthorization: false)
        request.httpBody = try JSONEncoder().encode(LoginPayload(password: password))
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let response: POSLoginResponse = try await send(request, treatUnauthorizedAsSessionLoss: false)
        persistAuthToken(response.token)
        return response
    }

    func logoutPOS() {
        clearAuthToken()
    }

    func fetchProducts() async throws -> [Product] {
        let request = try makeRequest(path: "api/pos/products", method: "GET")
        let envelope: ProductsEnvelope = try await send(request)
        return envelope.products
    }

    func createPaymentIntent(
        lines: [CartLine],
        email: String?,
        captureMethod: PaymentCaptureMethod
    ) async throws -> CreatePaymentIntentResponse {
        let payload = CreatePaymentIntentPayload(
            items: lines.map { .init(slug: $0.product.slug, quantity: $0.quantity) },
            email: email,
            captureMethod: captureMethod.rawValue
        )
        var request = try makeRequest(path: "api/terminal/create-payment-intent", method: "POST")
        request.httpBody = try JSONEncoder().encode(payload)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await send(request)
    }

    func capturePaymentIntent(id: String) async throws -> CapturePaymentIntentResponse {
        var request = try makeRequest(path: "api/terminal/capture-payment-intent", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["paymentIntentId": id])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await send(request)
    }

    func sendTerminalReceiptEmail(paymentIntentId: String, email: String) async throws -> SendTerminalReceiptResponse {
        let payload = SendTerminalReceiptPayload(paymentIntentId: paymentIntentId, email: email)
        var request = try makeRequest(path: "api/terminal/send-receipt", method: "POST")
        request.httpBody = try JSONEncoder().encode(payload)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await send(request)
    }

    func fetchConnectionToken() async throws -> TerminalConnectionTokenResponse {
        let request = try makeRequest(path: "api/terminal/connection-token", method: "POST")
        return try await send(request)
    }

    func makeRequest(path: String, method: String, includeAuthorization: Bool = true) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIClientError.invalidConfiguration
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        if includeAuthorization, let authToken = currentAuthToken(), !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    func handleUnauthorizedResponse() {
        clearAuthToken()
        let callback = currentUnauthorizedHandler()
        Task { @MainActor in
            callback?()
        }
    }

    private func send<Response: Decodable>(
        _ request: URLRequest,
        treatUnauthorizedAsSessionLoss: Bool = true
    ) async throws -> Response {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        let decoder = JSONDecoder()
        if (200..<300).contains(httpResponse.statusCode) {
            do {
                return try decoder.decode(Response.self, from: data)
            } catch {
                throw APIClientError.invalidResponse
            }
        }

        if httpResponse.statusCode == 401, treatUnauthorizedAsSessionLoss {
            handleUnauthorizedResponse()
            throw APIClientError.unauthorized
        }

        if let errorEnvelope = try? decoder.decode(ErrorEnvelope.self, from: data),
           let message = errorEnvelope.error,
           !message.isEmpty {
            throw APIClientError.server(message: message)
        }

        throw APIClientError.server(message: "Server error (\(httpResponse.statusCode)).")
    }

    private func persistAuthToken(_ token: String) {
        stateLock.lock()
        storedAuthToken = token
        stateLock.unlock()
        POSSessionKeychainStore.saveToken(token)
    }

    private func clearAuthToken() {
        stateLock.lock()
        storedAuthToken = nil
        stateLock.unlock()
        POSSessionKeychainStore.deleteToken()
    }

    private func currentAuthToken() -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return storedAuthToken
    }

    private func currentUnauthorizedHandler() -> (@MainActor @Sendable () -> Void)? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return unauthorizedHandler
    }
}
