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
        case let .success(_, _, storedOffline, _, receiptKind):
            if storedOffline {
                return "Payment Saved Offline"
            }
            if receiptKind == .cashOrder {
                return "Cash Sale Recorded"
            }
            return "Card Payment Approved"
        case .failure:
            return "Payment Not Completed"
        }
    }

    var message: String {
        switch self {
        case let .success(_, amountText, storedOffline, _, receiptKind):
            if storedOffline {
                return "Card payment for \(amountText) was saved on this iPad. Reconnect to the internet so Stripe can forward it."
            }
            if receiptKind == .cashOrder {
                return "Cash sale for \(amountText) is recorded. Inventory and admin order history are updated."
            }
            return "Card payment for \(amountText) was approved."
        case let .failure(message):
            return message
        }
    }

    var referenceCaption: String? {
        switch self {
        case let .success(reference, _, storedOffline, _, receiptKind):
            if storedOffline {
                return "Offline Ref: \(reference)"
            }
            if receiptKind == .cashOrder {
                return "Order Ref: \(reference)"
            }
            return "Stripe Ref: \(reference)"
        case .failure:
            return nil
        }
    }
}
