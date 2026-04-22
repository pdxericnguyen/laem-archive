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

struct POSRootView: View {
    @ObservedObject var viewModel: POSViewModel
    @ObservedObject var terminalManager: LAEMTerminalManager

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
            OrderResultView(result: result) { paymentIntentId, email in
                try await viewModel.sendReceiptEmail(paymentIntentId: paymentIntentId, email: email)
            }
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

                GroupBox("Checkout") {
                    VStack(alignment: .leading, spacing: 12) {
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
                            Label("Reader Setup", systemImage: "dot.radiowaves.left.and.right")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(POSSecondaryActionStyle())

                        Button {
                            Task {
                                await viewModel.chargeCart()
                            }
                        } label: {
                            if viewModel.isCharging {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            } else {
                                Label("Charge \(viewModel.formattedTotal)", systemImage: "creditcard")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(POSPrimaryActionStyle())
                        .disabled(viewModel.isCharging || viewModel.cartLines.isEmpty)

                        Button("Clear Cart", role: .destructive) {
                            viewModel.clearCart()
                        }
                        .buttonStyle(POSQuietActionStyle(tint: POSBrand.danger))
                        .disabled(viewModel.cartLines.isEmpty)
                    }
                }
                .groupBoxStyle(POSPanelGroupBoxStyle())
            }
            .padding(20)
        }
        .background(POSBrand.pageBackground)
        .navigationTitle("Checkout")
    }
}

private struct ProductRow: View {
    let product: Product
    let quantity: Int
    let onAdd: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(product.title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(POSBrand.textPrimary)
                Text(product.formattedPrice)
                    .font(.subheadline)
                    .foregroundStyle(POSBrand.textSecondary)
                Text(product.stock > 0 ? "\(product.stock) in stock" : "Out of stock")
                    .font(.caption)
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(product.stock > 0 ? AnyShapeStyle(POSBrand.textSecondary) : AnyShapeStyle(POSBrand.danger))
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
