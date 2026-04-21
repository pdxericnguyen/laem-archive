import Foundation

#if canImport(StripeTerminal)
@preconcurrency import StripeTerminal
#endif

enum LAEMTerminalManagerError: LocalizedError {
    case sdkNotInstalled
    case readerNotConnected
    case readerUnavailable
    case invalidConfiguration(String)
    case duplicateOperation(String)
    case confirmationPending

    var errorDescription: String? {
        switch self {
        case .sdkNotInstalled:
            return "Add the StripeTerminal iOS SDK to enable reader discovery and in-person payments."
        case .readerNotConnected:
            return "Connect a reader before charging the cart."
        case .readerUnavailable:
            return "That reader is no longer available. Start discovery again."
        case let .invalidConfiguration(message):
            return message
        case let .duplicateOperation(message):
            return message
        case .confirmationPending:
            return "Payment confirmation timed out. Check the original PaymentIntent in Stripe before starting a new charge."
        }
    }
}

@MainActor
final class LAEMTerminalManager: NSObject, ObservableObject {
    @Published private(set) var status: ReaderConnectionStatus
    @Published private(set) var statusDetail: String
    @Published private(set) var discoveredReaders: [ReaderListItem]
    @Published private(set) var connectedReader: ReaderListItem?
    @Published private(set) var displayMessage: String
    @Published private(set) var isBusy: Bool
    @Published private(set) var selectedReaderFamily: TerminalReaderFamily
    @Published private(set) var offlineQueueCount: Int
    @Published private(set) var offlineNetworkStatusLabel: String
    @Published private(set) var offlineStoredAmountSummary: String

    private let apiClient: APIClient?
    private let userDefaults: UserDefaults
    private var pendingConnectionReaderID: String?
    private var pendingPaymentIntentID: String?
    private var preferredReaderSerialNumber: String?
    private var lastKnownLocationID: String?
    private var shouldAutoConnectPreferredReader = false
    private var discoveryTask: Task<Void, Never>?
    private var discoverySessionID: UUID?

    #if canImport(StripeTerminal)
    private let connectionTokenProvider: LAEMConnectionTokenProvider
    private var discoveredReaderMap: [String: Reader] = [:]
    #endif

    private static let preferredReaderSerialNumberKey = "laem.pos.preferred-reader-serial"
    private static let selectedReaderFamilyKey = "laem.pos.selected-reader-family"

    init(apiClient: APIClient?, userDefaults: UserDefaults = .standard) {
        self.apiClient = apiClient
        self.userDefaults = userDefaults
        self.preferredReaderSerialNumber = userDefaults.string(
            forKey: Self.preferredReaderSerialNumberKey
        )
        if let savedFamilyRawValue = userDefaults.string(forKey: Self.selectedReaderFamilyKey),
           let savedFamily = TerminalReaderFamily(rawValue: savedFamilyRawValue) {
            self.selectedReaderFamily = savedFamily
        } else {
            self.selectedReaderFamily = AppConfiguration.defaultReaderFamily
        }
        self.status = .sdkMissing
        self.statusDetail = "Add StripeTerminal in Xcode to enable Stripe reader support."
        self.discoveredReaders = []
        self.connectedReader = nil
        self.displayMessage = "Ready for reader setup"
        self.isBusy = false
        self.offlineQueueCount = 0
        self.offlineNetworkStatusLabel = "Unknown"
        self.offlineStoredAmountSummary = "$0.00"
        #if canImport(StripeTerminal)
        self.connectionTokenProvider = LAEMConnectionTokenProvider(apiClient: apiClient)
        #endif
        super.init()

        #if canImport(StripeTerminal)
        Terminal.initWithTokenProvider(
            connectionTokenProvider,
            delegate: self,
            offlineDelegate: self,
            logLevel: .none
        )
        status = .idle
        statusDetail = apiClient == nil
            ? "Set LAEMAPIBaseURL before connecting to a Stripe reader."
            : idleStatusDetail(for: selectedReaderFamily)
        displayMessage = AppConfiguration.useSimulatedReader
            ? "Simulated reader mode is enabled."
            : selectedReaderFamily.discoveryPrompt
        refreshOfflineStatus()
        #endif
    }

    deinit {
        discoveryTask?.cancel()
    }

    var isSDKInstalled: Bool {
        #if canImport(StripeTerminal)
        true
        #else
        false
        #endif
    }

    var canBeginCheckout: Bool {
        isSDKInstalled &&
            status == .connected &&
            pendingConnectionReaderID == nil &&
            pendingPaymentIntentID == nil
    }

    func setSelectedReaderFamily(_ family: TerminalReaderFamily) {
        guard family != selectedReaderFamily else {
            return
        }

        guard !isBusy && connectedReader == nil else {
            statusDetail = "Disconnect the current reader and finish any in-progress work before switching reader families."
            return
        }

        cancelDiscoveryStream()
        selectedReaderFamily = family
        userDefaults.set(family.rawValue, forKey: Self.selectedReaderFamilyKey)
        discoveredReaders = []
        #if canImport(StripeTerminal)
        discoveredReaderMap = [:]
        #endif
        status = .idle
        statusDetail = idleStatusDetail(for: family)
        displayMessage = AppConfiguration.useSimulatedReader
            ? "Simulated reader mode is enabled."
            : family.discoveryPrompt
    }

    func beginDiscovery() async {
        guard isSDKInstalled else {
            status = .sdkMissing
            statusDetail = LAEMTerminalManagerError.sdkNotInstalled.localizedDescription
            displayMessage = "Install StripeTerminal to search for nearby readers."
            return
        }

        guard pendingConnectionReaderID == nil else {
            statusDetail = "A reader connection is already in progress."
            return
        }

        guard pendingPaymentIntentID == nil else {
            statusDetail = "Finish the current payment before starting discovery again."
            return
        }

        cancelDiscoveryStream()
        discoveredReaders = []
        #if canImport(StripeTerminal)
        discoveredReaderMap = [:]
        #endif
        shouldAutoConnectPreferredReader = preferredReaderSerialNumber != nil

        let sessionID = UUID()
        discoverySessionID = sessionID
        status = .discovering
        statusDetail = discoveryStatusDetail(for: selectedReaderFamily)
        displayMessage = AppConfiguration.useSimulatedReader
            ? "Simulated reader mode is enabled."
            : selectedReaderFamily.discoveryPrompt

        #if canImport(StripeTerminal)
        do {
            let configuration = try makeDiscoveryConfiguration(for: selectedReaderFamily)

            discoveryTask = Task { [weak self] in
                guard let self else {
                    return
                }

                do {
                    for try await readers in Terminal.shared.discoverReaders(configuration) {
                        if Task.isCancelled {
                            break
                        }
                        await self.handleDiscoveredReaders(readers, sessionID: sessionID)
                    }
                    await self.finishDiscovery(sessionID: sessionID, error: nil)
                } catch {
                    if Task.isCancelled {
                        await self.finishDiscovery(sessionID: sessionID, error: nil)
                    } else {
                        await self.finishDiscovery(sessionID: sessionID, error: error)
                    }
                }
            }
            refreshBusyState()
        } catch {
            discoverySessionID = nil
            status = .error
            statusDetail = error.localizedDescription
            displayMessage = "Unable to start reader discovery."
        }
        #endif
    }

    func stopDiscovery() {
        cancelDiscoveryStream()

        if connectedReader != nil {
            status = .connected
            statusDetail = "Reader still connected."
            displayMessage = "Ready to collect payment"
        } else {
            status = .idle
            statusDetail = "Reader discovery stopped."
            displayMessage = "Ready for reader setup"
        }
    }

    func connect(to reader: ReaderListItem) async throws {
        guard isSDKInstalled else {
            throw LAEMTerminalManagerError.sdkNotInstalled
        }

        guard pendingConnectionReaderID == nil else {
            throw LAEMTerminalManagerError.duplicateOperation(
                "A reader connection is already in progress."
            )
        }

        guard pendingPaymentIntentID == nil else {
            throw LAEMTerminalManagerError.duplicateOperation(
                "A payment is already in progress."
            )
        }

        #if canImport(StripeTerminal)
        guard let selectedReader = discoveredReaderMap[reader.id] else {
            throw LAEMTerminalManagerError.readerUnavailable
        }

        pendingConnectionReaderID = reader.id
        refreshBusyState()
        status = .connecting
        statusDetail = "Connecting to \(reader.label)..."
        displayMessage = connectionInstruction(for: selectedReaderFamily)

        do {
            let connected = try await connectSelectedReader(selectedReader)
            handleConnectedReader(connected)
        } catch {
            pendingConnectionReaderID = nil
            refreshBusyState()
            status = discoveredReaders.isEmpty ? .idle : .readyToConnect
            statusDetail = error.localizedDescription
            displayMessage = "Unable to connect the reader."
            throw error
        }
        #else
        _ = reader
        throw LAEMTerminalManagerError.sdkNotInstalled
        #endif
    }

    func disconnectReader() async {
        cancelDiscoveryStream()

        guard isSDKInstalled else {
            connectedReader = nil
            discoveredReaders = []
            status = .sdkMissing
            statusDetail = LAEMTerminalManagerError.sdkNotInstalled.localizedDescription
            displayMessage = "Ready for reader setup"
            refreshBusyState()
            return
        }

        guard pendingPaymentIntentID == nil else {
            statusDetail = "Wait for the current payment to finish before disconnecting the reader."
            return
        }

        guard connectedReader != nil else {
            status = .idle
            statusDetail = "No reader connected."
            displayMessage = "Ready for reader setup"
            return
        }

        status = .disconnecting
        statusDetail = "Disconnecting reader..."
        displayMessage = "Disconnecting"

        #if canImport(StripeTerminal)
        do {
            try await disconnectConnectedReader()
        } catch {
            status = .error
            statusDetail = error.localizedDescription
            displayMessage = "Unable to disconnect reader cleanly."
            return
        }
        #endif

        connectedReader = nil
        discoveredReaders = []
        status = .idle
        statusDetail = "Reader disconnected."
        displayMessage = "Ready for reader setup"
        refreshBusyState()
    }

    func collectPayment(
        lines: [CartLine],
        email: String?,
        captureMethod: PaymentCaptureMethod
    ) async throws -> TerminalProcessResult {
        guard canBeginCheckout else {
            throw LAEMTerminalManagerError.readerNotConnected
        }

        guard captureMethod == .automatic else {
            throw LAEMTerminalManagerError.invalidConfiguration(
                "LAEM's offline-capable reader flow requires automatic capture."
            )
        }

        guard pendingPaymentIntentID == nil else {
            throw LAEMTerminalManagerError.duplicateOperation(
                "A payment is already being collected on the reader."
            )
        }

        let localReference = makeLocalPaymentReference()
        pendingPaymentIntentID = localReference
        refreshBusyState()
        displayMessage = "Preparing payment"
        statusDetail = "Creating payment intent in Stripe Terminal..."

        #if canImport(StripeTerminal)
        do {
            let amount = lines.reduce(0) { $0 + $1.subtotalCents }
            let currency = lines.first?.product.currency.lowercased() ?? "usd"
            try validateOfflineStorageLimit(newAmount: amount)
            let intent = try await createPaymentIntent(
                amount: amount,
                currency: currency,
                email: email,
                captureMethod: captureMethod,
                metadata: makePaymentMetadata(lines: lines, localReference: localReference)
            )
            displayMessage = "Present card"
            statusDetail = "Collecting payment method on the reader..."

            let collectedIntent = try await Terminal.shared.collectPaymentMethod(intent)
            displayMessage = "Authorizing payment"
            statusDetail = "Confirming payment with Stripe..."

            let confirmedIntent = try await confirmPaymentIntentWithRetry(collectedIntent)
            let resolvedID = confirmedIntent.stripeId
            let storedOffline = confirmedIntent.offlineDetails?.requiresUpload == true || resolvedID == nil
            let requiresCapture = captureMethod == .manual || confirmedIntent.status == .requiresCapture

            pendingPaymentIntentID = nil
            refreshBusyState()
            refreshOfflineStatus()
            displayMessage = storedOffline
                ? "Payment stored offline"
                : (requiresCapture ? "Payment authorized" : "Payment approved")
            statusDetail = "Connected and ready for the next sale."

            return TerminalProcessResult(
                reference: resolvedID ?? localReference,
                stripePaymentIntentId: resolvedID,
                requiresCapture: requiresCapture,
                storedOffline: storedOffline
            )
        } catch {
            pendingPaymentIntentID = nil
            refreshBusyState()
            refreshOfflineStatus()
            displayMessage = "Payment failed"
            if connectedReader != nil {
                status = .connected
                statusDetail = "Reader connected. \(error.localizedDescription)"
            }
            throw error
        }
        #else
        _ = lines
        _ = email
        _ = captureMethod
        pendingPaymentIntentID = nil
        refreshBusyState()
        throw LAEMTerminalManagerError.sdkNotInstalled
        #endif
    }

    private func refreshBusyState() {
        isBusy = discoveryTask != nil || pendingConnectionReaderID != nil || pendingPaymentIntentID != nil
    }

    private func cancelDiscoveryStream() {
        discoverySessionID = nil
        discoveryTask?.cancel()
        discoveryTask = nil
        refreshBusyState()
    }

    private func handleDiscoveryResultCount(_ count: Int) {
        if count == 0 {
            status = .discovering
            statusDetail = discoveryStatusDetail(for: selectedReaderFamily)
            return
        }

        if pendingConnectionReaderID == nil && connectedReader == nil {
            status = .readyToConnect
        }

        let suffix = count == 1 ? "reader" : "readers"
        statusDetail = "\(count) \(suffix) found. Connect when ready."
    }

    #if canImport(StripeTerminal)
    private func handleDiscoveredReaders(_ readers: [Reader], sessionID: UUID) async {
        guard discoverySessionID == sessionID else {
            return
        }

        discoveredReaderMap = Dictionary(
            uniqueKeysWithValues: readers.map { (readerIdentifier(for: $0), $0) }
        )
        discoveredReaders = readers
            .map(makeReaderListItem(from:))
            .sorted { $0.label.localizedCompare($1.label) == .orderedAscending }

        if shouldAutoConnectPreferredReader,
           pendingConnectionReaderID == nil,
           let serialNumber = preferredReaderSerialNumber,
           let preferredReader = readers.first(where: { $0.serialNumber == serialNumber }) {
            shouldAutoConnectPreferredReader = false
            let item = makeReaderListItem(from: preferredReader)
            status = .connecting
            statusDetail = "Saved reader found. Reconnecting to \(item.label)..."
            displayMessage = "Connecting to the last-used reader."

            Task { [weak self] in
                do {
                    try await self?.connect(to: item)
                } catch {
                    self?.handleAutoReconnectFailure(error)
                }
            }
            return
        }

        handleDiscoveryResultCount(discoveredReaders.count)
    }

    private func handleAutoReconnectFailure(_ error: Error) {
        status = discoveredReaders.isEmpty ? .idle : .readyToConnect
        statusDetail = "Saved reader was found, but reconnect failed. \(error.localizedDescription)"
        displayMessage = "Choose a reader to try again."
    }

    private func finishDiscovery(sessionID: UUID, error: Error?) async {
        guard discoverySessionID == sessionID else {
            return
        }

        discoveryTask = nil
        discoverySessionID = nil
        refreshBusyState()

        if pendingConnectionReaderID != nil || connectedReader != nil {
            return
        }

        if let error {
            status = .error
            statusDetail = error.localizedDescription
            displayMessage = "Unable to discover readers."
            return
        }

        if discoveredReaders.isEmpty {
            status = .idle
            statusDetail = AppConfiguration.useSimulatedReader
                ? "No simulated readers were found."
                : noReadersFoundDetail(for: selectedReaderFamily)
            displayMessage = "No readers found"
            return
        }

        status = .readyToConnect
        let suffix = discoveredReaders.count == 1 ? "reader is" : "readers are"
        statusDetail = "\(discoveredReaders.count) \(suffix) available to connect."
        displayMessage = "Choose a reader to connect."
    }

    private func handleConnectedReader(_ reader: Reader) {
        pendingConnectionReaderID = nil
        refreshBusyState()
        cancelDiscoveryStream()

        let item = makeReaderListItem(from: reader)
        connectedReader = item
        discoveredReaders = [item]
        discoveredReaderMap = [readerIdentifier(for: reader): reader]
        status = .connected
        statusDetail = connectedStatusDetail(for: reader)
        displayMessage = "Ready to collect payment"
        lastKnownLocationID = reader.locationId ?? lastKnownLocationID
        preferredReaderSerialNumber = reader.serialNumber
        userDefaults.set(reader.serialNumber, forKey: Self.preferredReaderSerialNumberKey)
    }

    private func resolveLocationID(for reader: Reader) async throws -> String {
        if let locationID = normalized(reader.locationId) {
            lastKnownLocationID = locationID
            return locationID
        }

        if let locationID = normalized(lastKnownLocationID) {
            return locationID
        }

        if let locationID = normalized(AppConfiguration.defaultTerminalLocationID) {
            lastKnownLocationID = locationID
            return locationID
        }

        guard let apiClient else {
            throw LAEMTerminalManagerError.invalidConfiguration(
                "Set LAEMAPIBaseURL and STRIPE_TERMINAL_LOCATION_ID before connecting a first-time Bluetooth reader."
            )
        }

        let token = try await apiClient.fetchConnectionToken()
        if let locationID = normalized(token.location) {
            lastKnownLocationID = locationID
            return locationID
        }

        throw LAEMTerminalManagerError.invalidConfiguration(
            "Set STRIPE_TERMINAL_LOCATION_ID on the backend before connecting a first-time Bluetooth reader."
        )
    }

    private func confirmPaymentIntentWithRetry(_ intent: PaymentIntent) async throws -> PaymentIntent {
        do {
            return try await Terminal.shared.confirmPaymentIntent(intent)
        } catch let error as ConfirmPaymentIntentError {
            guard let updatedIntent = error.paymentIntent else {
                throw LAEMTerminalManagerError.confirmationPending
            }

            if updatedIntent.status == .requiresConfirmation {
                displayMessage = "Retrying payment confirmation"
                statusDetail = "Reader collected the card. Retrying confirmation with the original PaymentIntent..."
                return try await Terminal.shared.confirmPaymentIntent(updatedIntent)
            }

            throw error
        }
    }

    private func makeDiscoveryConfiguration(
        for family: TerminalReaderFamily
    ) throws -> any DiscoveryConfiguration {
        switch family {
        case .bluetoothMobile:
            let builder = BluetoothScanDiscoveryConfigurationBuilder()
                .setSimulated(AppConfiguration.useSimulatedReader)
            if AppConfiguration.discoveryTimeoutSeconds > 0 {
                _ = builder.setTimeout(AppConfiguration.discoveryTimeoutSeconds)
            }
            return try builder.build()

        case .internetSmart:
            let builder = InternetDiscoveryConfigurationBuilder()
                .setSimulated(AppConfiguration.useSimulatedReader)
            if let locationID = normalized(AppConfiguration.defaultTerminalLocationID) {
                _ = builder.setLocationId(locationID)
            }
            if AppConfiguration.discoveryTimeoutSeconds > 0 {
                _ = builder.setTimeout(AppConfiguration.discoveryTimeoutSeconds)
            }
            return try builder.build()
        }
    }

    private func connectSelectedReader(_ reader: Reader) async throws -> Reader {
        switch selectedReaderFamily {
        case .bluetoothMobile:
            let locationID = try await resolveLocationID(for: reader)
            let configuration = try BluetoothConnectionConfigurationBuilder(
                delegate: self,
                locationId: locationID
            )
            .setAutoReconnectOnUnexpectedDisconnect(true)
            .build()
            return try await connectBluetoothReader(reader, configuration: configuration)

        case .internetSmart:
            let configuration = try InternetConnectionConfigurationBuilder(delegate: self)
                .setFailIfInUse(AppConfiguration.internetReaderFailIfInUse)
                .build()
            return try await connectInternetReader(reader, configuration: configuration)
        }
    }

    private func connectBluetoothReader(
        _ reader: Reader,
        configuration: BluetoothConnectionConfiguration
    ) async throws -> Reader {
        try await withCheckedThrowingContinuation { continuation in
            Terminal.shared.connectReader(reader, connectionConfig: configuration) { reader, error in
                if let reader {
                    continuation.resume(returning: reader)
                } else {
                    continuation.resume(
                        throwing: error ?? LAEMTerminalManagerError.readerUnavailable
                    )
                }
            }
        }
    }

    private func connectInternetReader(
        _ reader: Reader,
        configuration: InternetConnectionConfiguration
    ) async throws -> Reader {
        try await withCheckedThrowingContinuation { continuation in
            Terminal.shared.connectReader(reader, connectionConfig: configuration) { reader, error in
                if let reader {
                    continuation.resume(returning: reader)
                } else {
                    continuation.resume(
                        throwing: error ?? LAEMTerminalManagerError.readerUnavailable
                    )
                }
            }
        }
    }

    private func disconnectConnectedReader() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            Terminal.shared.disconnectReader { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    private func createPaymentIntent(
        amount: Int,
        currency: String,
        email: String?,
        captureMethod: PaymentCaptureMethod,
        metadata: [String: String]
    ) async throws -> PaymentIntent {
        let parameters = try makePaymentIntentParameters(
            amount: amount,
            currency: currency,
            email: email,
            captureMethod: captureMethod,
            metadata: metadata
        )
        let createConfig = try makeCreateConfiguration()

        return try await withCheckedThrowingContinuation { continuation in
            Terminal.shared.createPaymentIntent(parameters, createConfig: createConfig) { intent, error in
                if let intent {
                    continuation.resume(returning: intent)
                } else {
                    continuation.resume(
                        throwing: error ?? APIClientError.invalidResponse
                    )
                }
            }
        }
    }

    private func makePaymentIntentParameters(
        amount: Int,
        currency: String,
        email: String?,
        captureMethod: PaymentCaptureMethod,
        metadata: [String: String]
    ) throws -> PaymentIntentParameters {
        let builder = PaymentIntentParametersBuilder(amount: UInt(amount), currency: currency)
            .setCaptureMethod(captureMethod == .manual ? .manual : .automatic)
            .setMetadata(metadata)

        if let email = normalized(email) {
            _ = builder.setReceiptEmail(email)
        }

        return try builder.build()
    }

    private func makeCreateConfiguration() throws -> CreateConfiguration? {
        guard AppConfiguration.allowOfflinePayments else {
            return nil
        }

        let builder = CreateConfigurationBuilder()
            .setOfflineBehavior(.preferOnline)
        return try builder.build()
    }

    private func validateOfflineStorageLimit(newAmount: Int) throws {
        guard let limit = AppConfiguration.offlineStoredAmountLimitCents else {
            return
        }

        let current = Terminal.shared.offlineStatus.sdk.paymentAmountsByCurrency.values.reduce(0) { partial, value in
            partial + value.intValue
        }

        if current + newAmount > limit {
            throw LAEMTerminalManagerError.invalidConfiguration(
                "Offline payment queue limit reached. Bring the device online before storing more payments."
            )
        }
    }

    private func makePaymentMetadata(lines: [CartLine], localReference: String) -> [String: String] {
        let singleSlug = lines.count == 1 ? lines[0].product.slug : nil
        let quantityTotal = lines.reduce(0) { $0 + $1.quantity }

        var metadata: [String: String] = [
            "source": "laem_pos_terminal",
            "cart": serializeCartLines(lines),
            "quantity_total": String(quantityTotal),
            "laem_local_payment_id": localReference,
            "laem_created_at": String(Int(Date().timeIntervalSince1970))
        ]

        if let singleSlug {
            metadata["slug"] = singleSlug
        }

        return metadata
    }

    private func serializeCartLines(_ lines: [CartLine]) -> String {
        let grouped = Dictionary(grouping: lines, by: { $0.product.slug })
            .map { slug, rows in
                (slug, rows.reduce(0) { $0 + $1.quantity })
            }
            .sorted { $0.0 < $1.0 }

        return grouped
            .map { "\($0.0):\($0.1)" }
            .joined(separator: ",")
    }

    private func makeLocalPaymentReference() -> String {
        let timestamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "")
        let suffix = UUID().uuidString.prefix(8).lowercased()
        return "laem-offline-\(timestamp)-\(suffix)"
    }

    private func refreshOfflineStatus(_ status: OfflineStatus? = nil) {
        let currentStatus = status ?? Terminal.shared.offlineStatus
        let sdkStatus = currentStatus.sdk
        offlineQueueCount = sdkStatus.paymentsCount?.intValue ?? 0
        offlineNetworkStatusLabel = label(for: sdkStatus.networkStatus)
        offlineStoredAmountSummary = formatOfflineAmountSummary(sdkStatus.paymentAmountsByCurrency)
    }

    private func label(for networkStatus: NetworkStatus) -> String {
        switch networkStatus {
        case .online:
            return "Online"
        case .offline:
            return "Offline"
        case .unknown:
            return "Unknown"
        @unknown default:
            return "Unknown"
        }
    }

    private func formatOfflineAmountSummary(_ amounts: [String: NSNumber]) -> String {
        guard !amounts.isEmpty else {
            return "$0.00"
        }

        let formatter = NumberFormatter()
        formatter.numberStyle = .currency

        let formatted = amounts.keys.sorted().compactMap { currency -> String? in
            guard let value = amounts[currency] else {
                return nil
            }

            formatter.currencyCode = currency.uppercased()
            return formatter.string(from: NSNumber(value: Double(truncating: value) / 100.0))
        }

        return formatted.isEmpty ? "$0.00" : formatted.joined(separator: ", ")
    }

    private func readerIdentifier(for reader: Reader) -> String {
        if let stripeID = normalized(reader.stripeId) {
            return stripeID
        }
        return reader.serialNumber
    }

    private func makeReaderListItem(from reader: Reader) -> ReaderListItem {
        let label = reader.simulated
            ? "Simulated Stripe Reader"
            : "\(Terminal.stringFromDeviceType(reader.deviceType)) (\(reader.serialNumber))"

        var detailParts = [String]()
        detailParts.append(readerFamilyDetail(for: reader))
        if reader.simulated {
            detailParts.append("Test mode")
        }
        if let locationID = normalized(reader.locationId) {
            detailParts.append("Location \(locationID)")
        }
        if let networkStatus = networkStatusDetail(for: reader) {
            detailParts.append(networkStatus)
        }
        if let batteryLevel = reader.batteryLevel?.doubleValue {
            detailParts.append("Battery \(Int((batteryLevel * 100).rounded()))%")
        }

        let detail = detailParts.isEmpty ? "Ready to connect" : detailParts.joined(separator: " | ")

        return ReaderListItem(
            id: readerIdentifier(for: reader),
            label: label,
            detail: detail
        )
    }

    private func normalized(_ value: String?) -> String? {
        guard let value else {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func idleStatusDetail(for family: TerminalReaderFamily) -> String {
        switch family {
        case .bluetoothMobile:
            return "Ready to discover nearby Stripe Reader M2 devices."
        case .internetSmart:
            return "Ready to discover registered smart readers like the Stripe Reader S700/S710."
        }
    }

    private func discoveryStatusDetail(for family: TerminalReaderFamily) -> String {
        switch family {
        case .bluetoothMobile:
            return "Scanning for nearby Bluetooth mobile readers..."
        case .internetSmart:
            return "Loading smart readers registered to your Stripe account..."
        }
    }

    private func connectionInstruction(for family: TerminalReaderFamily) -> String {
        switch family {
        case .bluetoothMobile:
            return "Keep the reader nearby while the Bluetooth connection finishes."
        case .internetSmart:
            return "Waiting for the smart reader session to attach."
        }
    }

    private func noReadersFoundDetail(for family: TerminalReaderFamily) -> String {
        switch family {
        case .bluetoothMobile:
            return "No Bluetooth readers found. Make sure the Stripe Reader M2 is powered on and nearby."
        case .internetSmart:
            return "No smart readers found. Check that the S700/S710 is online and registered in Stripe."
        }
    }

    private func connectedStatusDetail(for reader: Reader) -> String {
        if reader.simulated {
            return "Connected to the simulated Stripe reader."
        }

        switch selectedReaderFamily {
        case .bluetoothMobile:
            return "Connected to \(reader.serialNumber)."
        case .internetSmart:
            return "Connected to smart reader \(reader.serialNumber)."
        }
    }

    private func readerFamilyDetail(for reader: Reader) -> String {
        if reader.status == .online || reader.status == .unknown {
            return TerminalReaderFamily.internetSmart.displayName
        }
        return selectedReaderFamily.displayName
    }

    private func networkStatusDetail(for reader: Reader) -> String? {
        switch reader.status {
        case .online:
            return "Online"
        case .offline:
            return selectedReaderFamily == .internetSmart ? "Offline" : nil
        case .unknown:
            return "Network unknown"
        @unknown default:
            return nil
        }
    }
    #endif
}

#if canImport(StripeTerminal)
private final class LAEMConnectionTokenProvider: NSObject, ConnectionTokenProvider {
    private final class CompletionRelay: @unchecked Sendable {
        private let completion: ConnectionTokenCompletionBlock

        init(_ completion: @escaping ConnectionTokenCompletionBlock) {
            self.completion = completion
        }

        func succeed(with token: String) {
            completion(token, nil)
        }

        func fail(with error: NSError) {
            completion(nil, error)
        }
    }

    private let apiClient: APIClient?

    init(apiClient: APIClient?) {
        self.apiClient = apiClient
        super.init()
    }

    func fetchConnectionToken(_ completion: @escaping ConnectionTokenCompletionBlock) {
        let relay = CompletionRelay(completion)

        guard let apiClient else {
            relay.fail(
                with:
                LAEMTerminalManagerError.invalidConfiguration(
                    "Set LAEMAPIBaseURL before connecting a Stripe reader."
                ) as NSError
            )
            return
        }

        let request: URLRequest
        do {
            request = try apiClient.makeRequest(path: "api/terminal/connection-token", method: "POST")
        } catch {
            relay.fail(with: error as NSError)
            return
        }

        apiClient.session.dataTask(with: request) { data, response, error in
            if let error {
                relay.fail(with: error as NSError)
                return
            }

            guard let data, let httpResponse = response as? HTTPURLResponse else {
                relay.fail(with: APIClientError.invalidResponse as NSError)
                return
            }

            if httpResponse.statusCode == 401 {
                apiClient.handleUnauthorizedResponse()
                relay.fail(with: APIClientError.unauthorized as NSError)
                return
            }

            let decoder = JSONDecoder()
            if (200..<300).contains(httpResponse.statusCode),
               let token = try? decoder.decode(TerminalConnectionTokenResponse.self, from: data) {
                relay.succeed(with: token.secret)
                return
            }

            if let envelope = try? decoder.decode([String: String].self, from: data),
               let message = envelope["error"],
               !message.isEmpty {
                relay.fail(with: APIClientError.server(message: message) as NSError)
                return
            }

            relay.fail(
                with:
                APIClientError.server(message: "Unable to fetch a Terminal connection token.") as NSError
            )
        }.resume()
    }
}

extension LAEMTerminalManager: TerminalDelegate {
    nonisolated func terminal(
        _ terminal: Terminal,
        didChangeConnectionStatus status: ConnectionStatus
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            switch status {
            case .notConnected:
                if self.connectedReader == nil && self.pendingConnectionReaderID == nil {
                    self.status = .idle
                }
            case .discovering:
                self.status = .discovering
            case .connecting:
                self.status = .connecting
            case .connected:
                self.status = .connected
            case .reconnecting:
                self.status = .reconnecting
            @unknown default:
                self.status = .error
            }
        }
    }

    nonisolated func terminal(
        _ terminal: Terminal,
        didChangePaymentStatus status: PaymentStatus
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            switch status {
            case .notReady:
                if self.pendingPaymentIntentID == nil && self.connectedReader != nil {
                    self.displayMessage = "Ready to collect payment"
                }
            case .ready:
                self.displayMessage = "Ready to collect payment"
            case .waitingForInput:
                self.displayMessage = "Waiting for card"
            case .processing:
                self.displayMessage = "Processing payment"
            @unknown default:
                self.displayMessage = "Payment status updated"
            }
        }
    }
}

extension LAEMTerminalManager: MobileReaderDelegate {
    nonisolated func reader(_ reader: Reader, didReportAvailableUpdate update: ReaderSoftwareUpdate) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            self.statusDetail = "A reader software update is available and can be installed after checkout."
            self.displayMessage = "Reader update available"
        }
    }

    nonisolated func reader(
        _ reader: Reader,
        didStartInstallingUpdate update: ReaderSoftwareUpdate,
        cancelable: Cancelable?
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            self.status = .connecting
            self.statusDetail = "Installing required reader update..."
            self.displayMessage = "Keep the reader powered on and nearby."
        }
    }

    nonisolated func reader(
        _ reader: Reader,
        didReportReaderSoftwareUpdateProgress progress: Float
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            let percent = Int((progress * 100).rounded())
            self.statusDetail = "Installing reader update (\(percent)% complete)..."
        }
    }

    nonisolated func reader(
        _ reader: Reader,
        didFinishInstallingUpdate update: ReaderSoftwareUpdate?,
        error: Error?
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            if let error {
                self.status = .error
                self.statusDetail = error.localizedDescription
                self.displayMessage = "Reader update failed"
            } else {
                self.status = .connected
                self.statusDetail = "Reader software is up to date."
                self.displayMessage = "Ready to collect payment"
            }
        }
    }

    nonisolated func reader(_ reader: Reader, didRequestReaderInput inputOptions: ReaderInputOptions) {
        Task { @MainActor [weak self] in
            self?.displayMessage = Terminal.stringFromReaderInputOptions(inputOptions)
        }
    }

    nonisolated func reader(
        _ reader: Reader,
        didRequestReaderDisplayMessage displayMessage: ReaderDisplayMessage
    ) {
        Task { @MainActor [weak self] in
            self?.displayMessage = Terminal.stringFromReaderDisplayMessage(displayMessage)
        }
    }

    nonisolated func reader(_ reader: Reader, didReportReaderEvent event: ReaderEvent, info: [AnyHashable: Any]?) {
        Task { @MainActor [weak self] in
            self?.displayMessage = Terminal.stringFromReaderEvent(event)
        }
    }

    nonisolated func reader(
        _ reader: Reader,
        didReportBatteryLevel batteryLevel: Float,
        status: BatteryStatus,
        isCharging: Bool
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            if self.connectedReader?.id == self.readerIdentifier(for: reader) {
                self.connectedReader = self.makeReaderListItem(from: reader)
            }
        }
    }

    nonisolated func readerDidReportLowBatteryWarning(_ reader: Reader) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            self.statusDetail = "Reader battery is low. Charge the reader soon."
            self.displayMessage = "Low reader battery"
        }
    }
}

extension LAEMTerminalManager: InternetReaderDelegate {}

extension LAEMTerminalManager: ReaderDelegate {
    nonisolated func reader(_ reader: Reader, didDisconnect reason: DisconnectReason) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            self.connectedReader = nil
            self.status = .disconnected
            self.statusDetail = "Reader disconnected unexpectedly. Start discovery to reconnect."
            self.displayMessage = "Reader disconnected"
            self.refreshBusyState()
        }
    }

    nonisolated func reader(
        _ reader: Reader,
        didStartReconnect cancelable: Cancelable,
        disconnectReason: DisconnectReason
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            self.status = .reconnecting
            self.statusDetail = "Reader connection dropped. Trying to reconnect automatically..."
            self.displayMessage = "Reconnecting reader"
        }
    }

    nonisolated func readerDidSucceedReconnect(_ reader: Reader) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            self.handleConnectedReader(reader)
            self.statusDetail = "Reader reconnected successfully."
        }
    }

    nonisolated func readerDidFailReconnect(_ reader: Reader) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }
            self.connectedReader = nil
            self.status = .disconnected
            self.statusDetail = "Reader could not reconnect. Start discovery to connect again."
            self.displayMessage = "Reader disconnected"
        }
    }
}

extension LAEMTerminalManager: OfflineDelegate {
    nonisolated func terminal(
        _ terminal: Terminal,
        didChange offlineStatus: OfflineStatus
    ) {
        Task { @MainActor [weak self] in
            self?.refreshOfflineStatus(offlineStatus)
        }
    }

    nonisolated func terminal(
        _ terminal: Terminal,
        didForwardPaymentIntent intent: PaymentIntent,
        error: Error?
    ) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            self.refreshOfflineStatus()
            if let error {
                self.statusDetail = "An offline payment is still waiting to sync. \(error.localizedDescription)"
                self.displayMessage = "Offline sync needs attention"
            } else {
                let reference =
                    intent.stripeId ??
                    intent.metadata?["laem_local_payment_id"] ??
                    "offline-payment"
                self.statusDetail = "Offline payment forwarded successfully."
                self.displayMessage = "Synced \(reference)"
            }
        }
    }

    nonisolated func terminal(_ terminal: Terminal, didReportForwardingError error: Error) {
        Task { @MainActor [weak self] in
            guard let self else {
                return
            }

            self.refreshOfflineStatus()
            self.statusDetail = "Offline payments are still queued. \(error.localizedDescription)"
            self.displayMessage = "Unable to forward stored payments yet"
        }
    }
}
#endif
