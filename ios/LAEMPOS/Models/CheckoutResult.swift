import Foundation

enum ReceiptReferenceKind: Equatable {
    case stripeTerminal
    case cashOrder
}

enum CheckoutResult: Identifiable, Equatable {
    case success(
        reference: String,
        amountText: String,
        storedOffline: Bool,
        receiptReferenceId: String?,
        receiptKind: ReceiptReferenceKind
    )
    case failure(message: String)

    var id: String {
        switch self {
        case let .success(reference, _, _, _, _):
            return "success-\(reference)"
        case let .failure(message):
            return "failure-\(message)"
        }
    }

    var title: String {
        switch self {
        case .success:
            return "Payment Complete"
        case .failure:
            return "Payment Failed"
        }
    }

    var message: String {
        switch self {
        case let .success(reference, amountText, storedOffline, _, receiptKind):
            if storedOffline {
                return "Stored \(amountText) on this device. Local reference: \(reference). Bring the iPad back online so Stripe can forward the payment."
            }
            if receiptKind == .cashOrder {
                return "Recorded \(amountText) cash sale. Order reference: \(reference)."
            }
            return "Charged \(amountText). Stripe reference: \(reference)."
        case let .failure(message):
            return message
        }
    }
}
