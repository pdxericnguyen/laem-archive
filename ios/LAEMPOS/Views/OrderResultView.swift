import SwiftUI

struct OrderResultView: View {
    let result: CheckoutResult
    let onSendReceipt: @MainActor (String, String) async throws -> Void

    @State private var receiptEmail = ""
    @State private var isSendingReceipt = false
    @State private var receiptStatusMessage: String?
    @State private var receiptErrorMessage: String?
    @Environment(\.dismiss) private var dismiss

    var iconName: String {
        switch result {
        case .success:
            return "checkmark.circle.fill"
        case .failure:
            return "xmark.octagon.fill"
        }
    }

    var iconColor: Color {
        switch result {
        case .success:
            return POSBrand.success
        case .failure:
            return POSBrand.danger
        }
    }

    private var shouldShowReceiptInput: Bool {
        switch result {
        case let .success(_, _, storedOffline, paymentIntentId):
            return !storedOffline && paymentIntentId != nil
        case .failure:
            return false
        }
    }

    private var receiptPaymentIntentId: String? {
        switch result {
        case let .success(_, _, _, paymentIntentId):
            return paymentIntentId
        case .failure:
            return nil
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                Text("ORDER STATUS")
                    .font(.caption.weight(.semibold))
                    .tracking(1.4)
                    .foregroundStyle(POSBrand.textSecondary)

                Image(systemName: iconName)
                    .font(.system(size: 52))
                    .foregroundStyle(iconColor)

                Text(result.title)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(POSBrand.textPrimary)

                Text(result.message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(POSBrand.textSecondary)

                if shouldShowReceiptInput {
                    receiptForm
                }

                Button("Done") {
                    dismiss()
                }
                .buttonStyle(POSPrimaryActionStyle())
            }
            .padding(28)
            .background(POSBrand.pageBackground.ignoresSafeArea())
            .navigationTitle("Order Result")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    @ViewBuilder
    private var receiptForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Send receipt")
                .font(.headline)
                .foregroundStyle(POSBrand.textPrimary)

            TextField("Customer email", text: $receiptEmail)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .autocorrectionDisabled()
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(POSBrand.cardBackground)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(POSBrand.cardBorder, lineWidth: 1)
                )
                .onSubmit {
                    submitReceiptEmail()
                }

            Button {
                submitReceiptEmail()
            } label: {
                if isSendingReceipt {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Send Receipt")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(POSSecondaryActionStyle())
            .disabled(isSendingReceipt)

            if let receiptStatusMessage {
                Label(receiptStatusMessage, systemImage: "checkmark.circle")
                    .font(.footnote)
                    .foregroundStyle(POSBrand.success)
            }

            if let receiptErrorMessage {
                Label(receiptErrorMessage, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(POSBrand.danger)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(POSBrand.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(POSBrand.cardBorder, lineWidth: 1)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func submitReceiptEmail() {
        guard !isSendingReceipt else {
            return
        }

        guard let paymentIntentId = receiptPaymentIntentId else {
            receiptErrorMessage = "Missing Stripe payment intent reference."
            receiptStatusMessage = nil
            return
        }

        let normalizedEmail = receiptEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard isValidEmail(normalizedEmail) else {
            receiptErrorMessage = "Enter a valid email address."
            receiptStatusMessage = nil
            return
        }

        isSendingReceipt = true
        receiptErrorMessage = nil
        receiptStatusMessage = nil

        Task {
            do {
                try await onSendReceipt(paymentIntentId, normalizedEmail)
                await MainActor.run {
                    isSendingReceipt = false
                    receiptEmail = normalizedEmail
                    receiptStatusMessage = "Receipt email saved."
                }
            } catch {
                await MainActor.run {
                    isSendingReceipt = false
                    receiptErrorMessage = error.localizedDescription
                }
            }
        }
    }

    private func isValidEmail(_ value: String) -> Bool {
        guard value.count <= 320 else {
            return false
        }
        return value.contains("@") && value.contains(".")
    }
}
