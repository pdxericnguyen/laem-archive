import Foundation

struct Product: Codable, Identifiable, Hashable {
    let id: String
    let slug: String
    let title: String
    let priceCents: Int
    let currency: String
    let imageURL: URL?
    let stock: Int
    let archived: Bool
    let published: Bool

    var isAvailableForSale: Bool {
        published && !archived && stock > 0
    }

    var formattedPrice: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency.uppercased()
        return formatter.string(from: NSNumber(value: Double(priceCents) / 100.0)) ?? "$0.00"
    }

    static let demoCatalog: [Product] = [
        Product(
            id: "silver-band-01",
            slug: "silver-band-01",
            title: "Silver Band 01",
            priceCents: 4800,
            currency: "usd",
            imageURL: nil,
            stock: 3,
            archived: false,
            published: true
        ),
        Product(
            id: "brass-plate-02",
            slug: "brass-plate-02",
            title: "Brass Plate 02",
            priceCents: 7200,
            currency: "usd",
            imageURL: nil,
            stock: 2,
            archived: false,
            published: true
        ),
        Product(
            id: "archive-set-03",
            slug: "archive-set-03",
            title: "Archive Set 03",
            priceCents: 12500,
            currency: "usd",
            imageURL: nil,
            stock: 1,
            archived: false,
            published: true
        )
    ]
}
