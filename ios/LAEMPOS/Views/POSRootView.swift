import SwiftUI

enum POSBrand {
    static let pageBackground = Color(red: 0.966, green: 0.964, blue: 0.955)
    static let cardBackground = Color.white
    static let cardBorder = Color.black.opacity(0.08)
    static let textPrimary = Color.black.opacity(0.92)
    static let textSecondary = Color.black.opacity(0.62)
    static let accent = Color.black.opacity(0.92)
    static let info = Color(red: 0.2, green: 0.39, blue: 0.73)
    static let warning = Color(red: 0.73, green: 0.46, blue: 0.17)
    static let danger = Color(red: 0.7, green: 0.2, blue: 0.2)
    static let success = Color(red: 0.2, green: 0.53, blue: 0.27)
}

struct POSPrimaryActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.subheadline, design: .default).weight(.semibold))
            .padding(.vertical, 12)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .foregroundStyle(Color.white)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(backgroundColor(isPressed: configuration.isPressed))
            )
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
    }

    private func backgroundColor(isPressed: Bool) -> Color {
        guard isEnabled else {
            return POSBrand.accent.opacity(0.35)
        }
        return POSBrand.accent.opacity(isPressed ? 0.84 : 1)
    }
}

struct POSSecondaryActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.subheadline, design: .default).weight(.semibold))
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .foregroundStyle(isEnabled ? POSBrand.textPrimary : POSBrand.textSecondary)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isEnabled && configuration.isPressed ? POSBrand.cardBorder.opacity(0.3) : POSBrand.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(POSBrand.cardBorder, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
    }
}

struct POSQuietActionStyle: ButtonStyle {
    let tint: Color
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.subheadline, design: .default).weight(.semibold))
            .foregroundStyle(isEnabled ? tint : POSBrand.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

struct POSPanelGroupBoxStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            configuration.label
                .font(.system(.caption, design: .default).weight(.semibold))
                .tracking(1.2)
                .foregroundStyle(POSBrand.textSecondary)
                .textCase(.uppercase)

            configuration.content
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(POSBrand.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(POSBrand.cardBorder, lineWidth: 1)
        )
    }
}

struct POSStepperButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .frame(width: 30, height: 30)
            .foregroundStyle(isEnabled ? POSBrand.textPrimary : POSBrand.textSecondary.opacity(0.65))
            .background(
                Circle()
                    .fill(POSBrand.cardBackground)
            )
            .overlay(
                Circle()
                    .stroke(POSBrand.cardBorder, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.72 : 1)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

private enum POSDetailMode: String, CaseIterable {
    case checkout
    case transactions

    var label: String {
        switch self {
        case .checkout:
            return "Checkout"
        case .transactions:
            return "Transactions"
        }
    }
}

private enum POSPaymentConfirmation: String, Identifiable {
    case card
    case cash

    var id: String {
        rawValue
    }

    var title: String {
        switch self {
        case .card:
            return "Card Payment"
        case .cash:
            return "Cash Sale"
        }
    }

    var systemImage: String {
        switch self {
        case .card:
            return "creditcard"
        case .cash:
            return "banknote"
        }
    }

    func actionTitle(total: String) -> String {
        switch self {
        case .card:
            return "Charge Card \(total)"
        case .cash:
            return "Record Cash \(total)"
        }
    }
}

struct POSRootView: View {
    @ObservedObject var viewModel: POSViewModel
    @ObservedObject var terminalManager: LAEMTerminalManager
    @State private var detailMode: POSDetailMode = .checkout
    @State private var paymentConfirmation: POSPaymentConfirmation?

    var body: some View {
        Group {
            if viewModel.requiresAuthentication {
                loginGate
            } else {
                NavigationSplitView {
                    catalogPane
                } detail: {
                    checkoutPane
                }
                .navigationSplitViewStyle(.balanced)
            }
        }
        .task(id: viewModel.requiresAuthentication) {
            guard !viewModel.requiresAuthentication else {
                return
            }
            await viewModel.loadProducts()
        }
        .sheet(isPresented: $viewModel.showReaderSheet) {
            ReaderSheetView(terminalManager: terminalManager)
        }
        .sheet(item: $viewModel.checkoutResult) { result in
            OrderResultView(result: result) { referenceId, referenceKind, email in
                try await viewModel.sendReceiptEmail(
                    referenceId: referenceId,
                    referenceKind: referenceKind,
                    email: email
                )
            }
        }
        .sheet(item: $paymentConfirmation) { confirmation in
            POSPaymentConfirmationView(
                confirmation: confirmation,
                lines: viewModel.cartLines,
                total: viewModel.formattedTotal,
                isProcessing: viewModel.isCharging || viewModel.isRecordingCashSale,
                onCancel: {
                    paymentConfirmation = nil
                },
                onConfirm: {
                    confirmPayment(confirmation)
                }
            )
        }
        .background(POSBrand.pageBackground.ignoresSafeArea())
        .tint(POSBrand.accent)
    }

    private var loginGate: some View {
        NavigationStack {
            VStack(spacing: 28) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("STAFF POS")
                        .font(.caption.weight(.semibold))
                        .tracking(1.5)
                        .foregroundStyle(POSBrand.textSecondary)
                    Text(AppConfiguration.appDisplayName)
                        .font(.system(size: 34, weight: .semibold, design: .serif))
                        .foregroundStyle(POSBrand.textPrimary)
                    Text("Enter the LAEM POS staff passcode to unlock catalog, reader setup, and checkout.")
                        .font(.body)
                        .foregroundStyle(POSBrand.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 12) {
                    SecureField("Staff passcode", text: $viewModel.staffPasscode)
                        .textContentType(.password)
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
                            Task {
                                await viewModel.signIn()
                            }
                        }

                    if let message = viewModel.authErrorMessage {
                        Label(message, systemImage: "lock.slash")
                            .font(.subheadline)
                            .foregroundStyle(POSBrand.danger)
                    }

                    Button {
                        Task {
                            await viewModel.signIn()
                        }
                    } label: {
                        if viewModel.isAuthenticating {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Label("Unlock POS", systemImage: "lock.open")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(POSPrimaryActionStyle())
                    .disabled(viewModel.isAuthenticating)
                }
                .padding(18)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(POSBrand.cardBackground)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(POSBrand.cardBorder, lineWidth: 1)
                )

                Spacer()
            }
            .padding(24)
            .background(POSBrand.pageBackground.ignoresSafeArea())
            .navigationTitle("Staff Sign In")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var catalogPane: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(AppConfiguration.appDisplayName)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(POSBrand.textPrimary)
                    Text("Staff-only point of sale for in-person transactions")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)
                }
                .padding(.vertical, 4)
            }
            .listRowBackground(POSBrand.cardBackground)

            if let notice = viewModel.notice {
                Section {
                    NoticeRow(notice: notice)
                }
                .listRowBackground(POSBrand.cardBackground)
            }

            Section {
                if viewModel.isLoadingProducts {
                    ProgressView("Loading products...")
                } else if viewModel.products.isEmpty {
                    Text("No live products are available in the POS catalog. Refresh after publishing stock in admin.")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)
                } else {
                    ForEach(viewModel.products) { product in
                        ProductRow(
                            product: product,
                            quantity: viewModel.quantity(for: product),
                            onAdd: { viewModel.addToCart(product) },
                            onRemove: { viewModel.removeFromCart(product) }
                        )
                    }
                }
            } header: {
                Text("Catalog")
                    .font(.caption.weight(.semibold))
                    .tracking(1.2)
                    .foregroundStyle(POSBrand.textSecondary)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(POSBrand.pageBackground)
        .navigationTitle("Catalog")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Lock POS") {
                    Task {
                        await viewModel.signOut()
                    }
                }
            }

            ToolbarItem(placement: .primaryAction) {
                Button("Refresh") {
                    Task {
                        await viewModel.loadProducts()
                    }
                }
            }
        }
    }

    private var checkoutPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("POS view", selection: $detailMode) {
                    ForEach(POSDetailMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                if detailMode == .checkout {
                    checkoutContent
                } else {
                    POSTransactionsPanel(viewModel: viewModel)
                }
            }
            .padding(20)
        }
        .task(id: detailMode) {
            guard detailMode == .transactions else {
                return
            }
            await viewModel.loadTransactions()
        }
        .background(POSBrand.pageBackground)
        .navigationTitle(detailMode.label)
    }

    private var checkoutContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            ReaderStatusCard(terminalManager: terminalManager) {
                viewModel.showReaderSheet = true
            }

            GroupBox("Cart") {
                VStack(alignment: .leading, spacing: 12) {
                    if viewModel.cartLines.isEmpty {
                        Text("No items selected yet.")
                            .foregroundStyle(POSBrand.textSecondary)
                    } else {
                        ForEach(viewModel.cartLines) { line in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(line.product.title)
                                        .font(.headline)
                                        .foregroundStyle(POSBrand.textPrimary)
                                    Text("\(line.quantity) x \(line.product.formattedPrice)")
                                        .font(.subheadline)
                                        .foregroundStyle(POSBrand.textSecondary)
                                }
                                Spacer()
                                Text(line.formattedSubtotal)
                                    .font(.headline)
                                    .foregroundStyle(POSBrand.textPrimary)
                            }
                        }
                    }

                    Divider()

                    HStack {
                        Text("Total")
                            .font(.headline)
                        Spacer()
                        Text(viewModel.formattedTotal)
                            .font(.title3.weight(.semibold))
                    }
                }
            }
            .groupBoxStyle(POSPanelGroupBoxStyle())

            GroupBox("Payment") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Choose card or cash for this sale.")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)

                    Text("Reader family: \(terminalManager.selectedReaderFamily.displayName)")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)

                    if let authMessage = viewModel.authErrorMessage {
                        Label(authMessage, systemImage: "person.badge.key")
                            .font(.subheadline)
                            .foregroundStyle(POSBrand.warning)
                    }

                    Button {
                        viewModel.showReaderSheet = true
                    } label: {
                        Label("Reader & Terminal", systemImage: "dot.radiowaves.left.and.right")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(POSSecondaryActionStyle())

                    Button {
                        if terminalManager.canBeginCheckout {
                            paymentConfirmation = .card
                        } else {
                            viewModel.showReaderSheet = true
                        }
                    } label: {
                        if viewModel.isCharging {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else if viewModel.cartLines.isEmpty {
                            Label("Add Items to Charge Card", systemImage: "cart")
                                .frame(maxWidth: .infinity)
                        } else if !terminalManager.canBeginCheckout {
                            Label("Connect Reader to Charge Card", systemImage: "dot.radiowaves.left.and.right")
                                .frame(maxWidth: .infinity)
                        } else {
                            Label("Charge Card \(viewModel.formattedTotal)", systemImage: "creditcard")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(POSPrimaryActionStyle())
                    .disabled(viewModel.isCharging || viewModel.isRecordingCashSale || viewModel.cartLines.isEmpty)

                    Button {
                        paymentConfirmation = .cash
                    } label: {
                        if viewModel.isRecordingCashSale {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else if viewModel.cartLines.isEmpty {
                            Label("Add Items for Cash Sale", systemImage: "banknote")
                                .frame(maxWidth: .infinity)
                        } else {
                            Label("Record Cash Sale \(viewModel.formattedTotal)", systemImage: "banknote")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(POSSecondaryActionStyle())
                    .disabled(viewModel.isCharging || viewModel.isRecordingCashSale || viewModel.cartLines.isEmpty)

                    Button("Clear Cart", role: .destructive) {
                        viewModel.clearCart()
                    }
                    .buttonStyle(POSQuietActionStyle(tint: POSBrand.danger))
                    .disabled(viewModel.cartLines.isEmpty)
                }
            }
            .groupBoxStyle(POSPanelGroupBoxStyle())
        }
    }

    private func confirmPayment(_ confirmation: POSPaymentConfirmation) {
        Task {
            switch confirmation {
            case .card:
                await viewModel.chargeCart()
            case .cash:
                await viewModel.recordCashSale()
            }
            await MainActor.run {
                paymentConfirmation = nil
            }
        }
    }
}

private struct POSPaymentConfirmationView: View {
    let confirmation: POSPaymentConfirmation
    let lines: [CartLine]
    let total: String
    let isProcessing: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Label(confirmation.title, systemImage: confirmation.systemImage)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(POSBrand.textPrimary)
                    Text("Confirm this payment type before completing the sale.")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)
                }

                GroupBox("Sale") {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(lines) { line in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(line.product.title)
                                        .font(.headline)
                                        .foregroundStyle(POSBrand.textPrimary)
                                    Text("\(line.quantity) x \(line.product.formattedPrice)")
                                        .font(.subheadline)
                                        .foregroundStyle(POSBrand.textSecondary)
                                }
                                Spacer()
                                Text(line.formattedSubtotal)
                                    .font(.headline)
                                    .foregroundStyle(POSBrand.textPrimary)
                            }
                        }

                        Divider()

                        HStack {
                            Text("Total")
                                .font(.headline)
                            Spacer()
                            Text(total)
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(POSBrand.textPrimary)
                        }
                    }
                }
                .groupBoxStyle(POSPanelGroupBoxStyle())

                Spacer()

                VStack(spacing: 10) {
                    Button {
                        onConfirm()
                    } label: {
                        if isProcessing {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Label(confirmation.actionTitle(total: total), systemImage: confirmation.systemImage)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(POSPrimaryActionStyle())
                    .disabled(isProcessing || lines.isEmpty)

                    Button("Cancel") {
                        onCancel()
                    }
                    .buttonStyle(POSQuietActionStyle(tint: POSBrand.textSecondary))
                    .disabled(isProcessing)
                }
            }
            .padding(20)
            .background(POSBrand.pageBackground.ignoresSafeArea())
            .navigationTitle("Confirm Sale")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") {
                        onCancel()
                    }
                    .disabled(isProcessing)
                }
            }
        }
    }
}

private struct POSTransactionsPanel: View {
    @ObservedObject var viewModel: POSViewModel
    @State private var period = "today"
    @State private var selectedTransaction: POSTransaction?

    var body: some View {
        GroupBox("Transactions") {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Period", selection: $period) {
                    Text("Today").tag("today")
                    Text("7 Days").tag("week")
                }
                .pickerStyle(.segmented)

                HStack {
                    Text(period == "today" ? "POS sales from today" : "POS sales from the last 7 days")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)
                    Spacer()
                    Button {
                        Task {
                            await viewModel.loadTransactions(period: period)
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(POSStepperButtonStyle())
                }

                if viewModel.isLoadingTransactions {
                    ProgressView("Loading transactions...")
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if let message = viewModel.transactionErrorMessage {
                    Label(message, systemImage: "exclamationmark.triangle")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.danger)
                } else if viewModel.transactions.isEmpty {
                    Text("No POS transactions for this period.")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)
                } else {
                    VStack(spacing: 10) {
                        ForEach(viewModel.transactions) { transaction in
                            Button {
                                selectedTransaction = transaction
                            } label: {
                                POSTransactionRow(transaction: transaction)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .groupBoxStyle(POSPanelGroupBoxStyle())
        .onChange(of: period) { _, nextPeriod in
            Task {
                await viewModel.loadTransactions(period: nextPeriod)
            }
        }
        .sheet(item: $selectedTransaction) { transaction in
            POSTransactionDetailView(
                transaction: transaction,
                period: period,
                viewModel: viewModel
            )
        }
    }
}

private struct POSTransactionRow: View {
    let transaction: POSTransaction

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(transaction.primaryItemTitle)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(POSBrand.textPrimary)
                    Text("\(transaction.paymentLabel) • \(transaction.formattedCreated)")
                        .font(.caption)
                        .foregroundStyle(POSBrand.textSecondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text(transaction.formattedTotal)
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(POSBrand.textPrimary)
                    Text(transaction.statusLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(transaction.status == "refunded" ? POSBrand.danger : POSBrand.success)
                }
            }

            if let email = transaction.email, !email.isEmpty {
                Label(email, systemImage: "envelope")
                    .font(.caption)
                    .foregroundStyle(POSBrand.textSecondary)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(POSBrand.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(POSBrand.cardBorder, lineWidth: 1)
        )
    }
}

private struct POSTransactionDetailView: View {
    let transaction: POSTransaction
    let period: String
    @ObservedObject var viewModel: POSViewModel

    @Environment(\.dismiss) private var dismiss
    @State private var receiptEmail: String
    @State private var receiptStatusMessage: String?
    @State private var receiptErrorMessage: String?
    @State private var isSendingReceipt = false
    @State private var restock = true
    @State private var refundReason = "requested_by_customer"
    @State private var refundNote = ""
    @State private var refundConfirmation = ""
    @State private var refundStatusMessage: String?
    @State private var refundErrorMessage: String?

    init(transaction: POSTransaction, period: String, viewModel: POSViewModel) {
        self.transaction = transaction
        self.period = period
        self.viewModel = viewModel
        _receiptEmail = State(initialValue: transaction.email ?? "")
    }

    private var currentTransaction: POSTransaction {
        viewModel.transactions.first { $0.id == transaction.id } ?? transaction
    }

    private var isRefunded: Bool {
        currentTransaction.status == "refunded"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    GroupBox("Transaction") {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(currentTransaction.formattedTotal)
                                    .font(.title2.weight(.semibold))
                                    .foregroundStyle(POSBrand.textPrimary)
                                Spacer()
                                Text(currentTransaction.paymentLabel)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(POSBrand.textSecondary)
                            }
                            Text(currentTransaction.formattedCreated)
                                .font(.subheadline)
                                .foregroundStyle(POSBrand.textSecondary)
                            Text(currentTransaction.itemSummary)
                                .font(.subheadline)
                                .foregroundStyle(POSBrand.textPrimary)
                            Text(currentTransaction.id)
                                .font(.caption.monospaced())
                                .foregroundStyle(POSBrand.textSecondary)
                        }
                    }
                    .groupBoxStyle(POSPanelGroupBoxStyle())

                    receiptSection
                    refundSection
                }
                .padding(20)
            }
            .background(POSBrand.pageBackground.ignoresSafeArea())
            .navigationTitle("Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var receiptSection: some View {
        GroupBox("Receipt") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Correct or resend the receipt email for this transaction.")
                    .font(.subheadline)
                    .foregroundStyle(POSBrand.textSecondary)

                TextField("name@email.com", text: $receiptEmail)
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
                        sendReceipt()
                    }

                Button {
                    sendReceipt()
                } label: {
                    if isSendingReceipt {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Label("Send Receipt Email", systemImage: "envelope")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(POSSecondaryActionStyle())
                .disabled(isSendingReceipt || isRefunded)

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
        }
        .groupBoxStyle(POSPanelGroupBoxStyle())
    }

    private var refundSection: some View {
        GroupBox("Refund") {
            VStack(alignment: .leading, spacing: 12) {
                if isRefunded {
                    Label(currentTransaction.refund?.restocked == true ? "Refunded and restocked." : "Refunded without restock.", systemImage: "checkmark.circle")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.success)
                } else {
                    Text(currentTransaction.channel == "cash" ? "Confirm cash was returned before recording the refund." : "Card refunds return to the original payment method through Stripe.")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)

                    Toggle("Return item to stock", isOn: $restock)
                        .font(.subheadline.weight(.semibold))

                    Picker("Reason", selection: $refundReason) {
                        Text("Customer request").tag("requested_by_customer")
                        Text("Duplicate sale").tag("duplicate")
                        Text("Fraudulent").tag("fraudulent")
                    }
                    .pickerStyle(.menu)

                    TextField("Optional note", text: $refundNote, axis: .vertical)
                        .lineLimit(2...4)
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

                    TextField("Type refund", text: $refundConfirmation)
                        .textInputAutocapitalization(.never)
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

                    Button(role: .destructive) {
                        refundTransaction()
                    } label: {
                        if viewModel.isRefundingTransaction {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Label(restock ? "Refund and Restock" : "Refund Only", systemImage: "arrow.uturn.backward")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(POSSecondaryActionStyle())
                    .disabled(viewModel.isRefundingTransaction || refundConfirmation.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() != "refund")
                }

                if let refundStatusMessage {
                    Label(refundStatusMessage, systemImage: "checkmark.circle")
                        .font(.footnote)
                        .foregroundStyle(POSBrand.success)
                }
                if let refundErrorMessage {
                    Label(refundErrorMessage, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(POSBrand.danger)
                }
            }
        }
        .groupBoxStyle(POSPanelGroupBoxStyle())
    }

    private func sendReceipt() {
        guard !isSendingReceipt else {
            return
        }

        let normalizedEmail = receiptEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalizedEmail.contains("@"), normalizedEmail.contains(".") else {
            receiptErrorMessage = "Enter a valid email address."
            receiptStatusMessage = nil
            return
        }

        isSendingReceipt = true
        receiptStatusMessage = nil
        receiptErrorMessage = nil
        let receiptTransaction = currentTransaction
        Task {
            do {
                try await viewModel.sendReceiptEmail(
                    referenceId: receiptTransaction.id,
                    referenceKind: receiptTransaction.channel == "cash" ? .cashOrder : .stripeTerminal,
                    email: normalizedEmail,
                    period: period
                )
                await MainActor.run {
                    isSendingReceipt = false
                    receiptEmail = normalizedEmail
                    receiptStatusMessage = "Receipt sent to \(normalizedEmail)."
                }
            } catch {
                await MainActor.run {
                    isSendingReceipt = false
                    receiptErrorMessage = error.localizedDescription
                }
            }
        }
    }

    private func refundTransaction() {
        refundStatusMessage = nil
        refundErrorMessage = nil
        let refundTransaction = currentTransaction

        Task {
            do {
                try await viewModel.refundTransaction(
                    refundTransaction,
                    restock: restock,
                    reason: refundReason,
                    note: refundNote,
                    confirmAction: refundConfirmation,
                    period: period
                )
                await MainActor.run {
                    refundStatusMessage = restock ? "Refund recorded and stock returned." : "Refund recorded without restock."
                    refundConfirmation = ""
                }
            } catch {
                await MainActor.run {
                    refundErrorMessage = error.localizedDescription
                }
            }
        }
    }
}

private extension POSTransaction {
    var paymentLabel: String {
        channel == "cash" ? "Cash" : "Card"
    }

    var statusLabel: String {
        if status == "refunded" {
            return "Refunded"
        }
        if status == "canceled" {
            return "Canceled"
        }
        return "Paid"
    }

    var formattedTotal: String {
        guard let amountTotal else {
            return "-"
        }
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = (currency ?? "usd").uppercased()
        return formatter.string(from: NSNumber(value: Double(amountTotal) / 100.0)) ?? "$0.00"
    }

    var formattedCreated: String {
        let date = Date(timeIntervalSince1970: TimeInterval(created))
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    var primaryItemTitle: String {
        items.first?.title ?? "POS Transaction"
    }

    var itemSummary: String {
        guard !items.isEmpty else {
            return "No line items"
        }
        return items
            .map { "\($0.title) x\($0.quantity)" }
            .joined(separator: ", ")
    }
}

private struct ProductRow: View {
    let product: Product
    let quantity: Int
    let onAdd: () -> Void
    let onRemove: () -> Void

    private var stockStatusText: String {
        guard product.published && !product.archived else {
            return "Unavailable"
        }
        return product.stock > 0 ? "\(product.stock) in stock" : "Out of stock"
    }

    private var stockStatusTint: Color {
        product.isAvailableForSale ? POSBrand.textSecondary : POSBrand.danger
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(product.title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(POSBrand.textPrimary)
                Text(product.formattedPrice)
                    .font(.subheadline)
                    .foregroundStyle(POSBrand.textSecondary)
                Text(stockStatusText)
                    .font(.caption)
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(stockStatusTint)
            }

            Spacer()

            HStack(spacing: 12) {
                Button {
                    onRemove()
                } label: {
                    Image(systemName: "minus")
                }
                .buttonStyle(POSStepperButtonStyle())
                .disabled(quantity == 0)

                Text("\(quantity)")
                    .font(.headline.monospacedDigit())
                    .frame(minWidth: 24)

                Button {
                    onAdd()
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(POSStepperButtonStyle())
                .disabled(!product.isAvailableForSale || quantity >= product.stock)
            }
        }
        .padding(.vertical, 6)
        .opacity(product.isAvailableForSale ? 1 : 0.58)
    }
}

private struct NoticeRow: View {
    let notice: POSViewModel.Notice

    var tint: Color {
        switch notice.style {
        case .info:
            return POSBrand.info
        case .warning:
            return POSBrand.warning
        case .error:
            return POSBrand.danger
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(tint)
            Text(notice.message)
                .foregroundStyle(POSBrand.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.subheadline)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(tint.opacity(0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(tint.opacity(0.28), lineWidth: 1)
        )
    }
}
