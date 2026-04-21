import Foundation

enum ReaderConnectionStatus: String {
    case sdkMissing
    case idle
    case discovering
    case readyToConnect
    case connecting
    case disconnecting
    case reconnecting
    case connected
    case disconnected
    case error

    var label: String {
        switch self {
        case .sdkMissing:
            return "SDK Missing"
        case .idle:
            return "Idle"
        case .discovering:
            return "Discovering"
        case .readyToConnect:
            return "Reader Found"
        case .connecting:
            return "Connecting"
        case .disconnecting:
            return "Disconnecting"
        case .reconnecting:
            return "Reconnecting"
        case .connected:
            return "Connected"
        case .disconnected:
            return "Disconnected"
        case .error:
            return "Error"
        }
    }
}

struct ReaderListItem: Identifiable, Hashable {
    let id: String
    let label: String
    let detail: String
}

struct TerminalProcessResult: Equatable {
    let reference: String
    let stripePaymentIntentId: String?
    let requiresCapture: Bool
    let storedOffline: Bool
}
