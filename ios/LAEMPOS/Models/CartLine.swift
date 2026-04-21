import Foundation

struct CartLine: Identifiable, Hashable {
    let product: Product
    var quantity: Int

    var id: String { product.id }

    var subtotalCents: Int {
        product.priceCents * quantity
    }

    var formattedSubtotal: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = product.currency.uppercased()
        return formatter.string(from: NSNumber(value: Double(subtotalCents) / 100.0)) ?? "$0.00"
    }
}
