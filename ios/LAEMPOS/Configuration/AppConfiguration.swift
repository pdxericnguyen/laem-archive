import Foundation

enum PaymentCaptureMethod: String, Codable {
    case automatic
    case manual
}

enum TerminalReaderFamily: String, Codable, CaseIterable, Identifiable {
    case bluetoothMobile = "bluetooth_mobile"
    case internetSmart = "internet_smart"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .bluetoothMobile:
            return "Bluetooth Mobile"
        case .internetSmart:
            return "Smart Reader"
        }
    }

    var detailLabel: String {
        switch self {
        case .bluetoothMobile:
            return "Stripe Reader M2 and other Bluetooth mobile readers"
        case .internetSmart:
            return "Stripe Reader S700/S710 and other internet smart readers"
        }
    }

    var discoveryPrompt: String {
        switch self {
        case .bluetoothMobile:
            return "Turn on the reader and keep it within Bluetooth range."
        case .internetSmart:
            return "Make sure the smart reader is online and registered to your Stripe account."
        }
    }

    var emptyStateText: String {
        switch self {
        case .bluetoothMobile:
            return "No readers are listed yet. Start discovery and keep the Stripe Reader M2 close to this device."
        case .internetSmart:
            return "No smart readers are listed yet. Start discovery after the S700/S710 is online and registered in Stripe."
        }
    }

    var setupNote: String {
        switch self {
        case .bluetoothMobile:
            return "Do not pair the Stripe Reader M2 in iOS Settings. Let Stripe Terminal discover and connect to it from inside the app."
        case .internetSmart:
            return "Smart readers are internet-connected. One active POS session should control a reader at a time."
        }
    }
}

enum AppConfiguration {
    static var apiBaseURL: URL? {
        stringValue(for: "LAEMAPIBaseURL").flatMap(URL.init(string:))
    }

    static var defaultTerminalLocationID: String? {
        stringValue(for: "LAEMTerminalLocationID")
    }

    static var defaultCaptureMethod: PaymentCaptureMethod {
        guard let rawValue = stringValue(for: "LAEMTerminalCaptureMethod") else {
            return .automatic
        }
        return PaymentCaptureMethod(rawValue: rawValue.lowercased()) ?? .automatic
    }

    static var defaultReaderFamily: TerminalReaderFamily {
        if let rawValue = stringValue(for: "LAEMTerminalReaderFamily"),
           let family = TerminalReaderFamily(rawValue: rawValue.lowercased()) {
            return family
        }

        if let fallback = stringValue(for: "LAEMTerminalReaderMode")?.lowercased(),
           fallback.contains("smart") || fallback.contains("s700") || fallback.contains("s710") {
            return .internetSmart
        }

        return .bluetoothMobile
    }

    static var readerModeLabel: String {
        defaultReaderFamily.displayName
    }

    static var discoveryTimeoutSeconds: UInt {
        guard let value = numberValue(for: "LAEMTerminalDiscoveryTimeoutSeconds") else {
            return 0
        }
        return UInt(max(0, value))
    }

    static var useSimulatedReader: Bool {
        boolValue(for: "LAEMTerminalUseSimulatedReader") ?? false
    }

    static var internetReaderFailIfInUse: Bool {
        boolValue(for: "LAEMTerminalInternetFailIfInUse") ?? true
    }

    static var offlineStoredAmountLimitCents: Int? {
        guard let value = numberValue(for: "LAEMTerminalOfflineStoredAmountLimitCents"),
              value > 0 else {
            return nil
        }
        return value
    }

    static var appDisplayName: String {
        stringValue(for: "CFBundleDisplayName") ?? "LAEM POS"
    }

    private static func stringValue(for key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func numberValue(for key: String) -> Int? {
        if let value = Bundle.main.object(forInfoDictionaryKey: key) as? NSNumber {
            return value.intValue
        }

        guard let stringValue = stringValue(for: key) else {
            return nil
        }
        return Int(stringValue)
    }

    private static func boolValue(for key: String) -> Bool? {
        if let value = Bundle.main.object(forInfoDictionaryKey: key) as? Bool {
            return value
        }
        guard let stringValue = stringValue(for: key) else {
            return nil
        }
        switch stringValue.lowercased() {
        case "1", "true", "yes":
            return true
        case "0", "false", "no":
            return false
        default:
            return nil
        }
    }
}
