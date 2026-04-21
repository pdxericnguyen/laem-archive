import SwiftUI

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
    }

    private var loginGate: some View {
        NavigationStack {
            VStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(AppConfiguration.appDisplayName)
                        .font(.largeTitle.weight(.semibold))
                    Text("Enter the LAEM POS staff passcode to unlock catalog, reader setup, and checkout.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 12) {
                    SecureField("Staff passcode", text: $viewModel.staffPasscode)
                        .textContentType(.password)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit {
                            Task {
                                await viewModel.signIn()
                            }
                        }

                    if let message = viewModel.authErrorMessage {
                        Label(message, systemImage: "lock.slash")
                            .font(.subheadline)
                            .foregroundStyle(.red)
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
                    .buttonStyle(.borderedProminent)
                    .disabled(viewModel.isAuthenticating)
                }

                Spacer()
            }
            .padding(24)
            .navigationTitle("Staff Sign In")
        }
    }

    private var catalogPane: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(AppConfiguration.appDisplayName)
                        .font(.title2.weight(.semibold))
                    Text("Staff-only point of sale for in-person transactions")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }

            if let notice = viewModel.notice {
                Section {
                    NoticeRow(notice: notice)
                }
            }

            Section("Catalog") {
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
            }
        }
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
            VStack(alignment: .leading, spacing: 20) {
                ReaderStatusCard(terminalManager: terminalManager) {
                    viewModel.showReaderSheet = true
                }

                GroupBox("Cart") {
                    VStack(alignment: .leading, spacing: 12) {
                        if viewModel.cartLines.isEmpty {
                            Text("No items selected yet.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(viewModel.cartLines) { line in
                                HStack(alignment: .firstTextBaseline) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(line.product.title)
                                            .font(.headline)
                                        Text("\(line.quantity) x \(line.product.formattedPrice)")
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(line.formattedSubtotal)
                                        .font(.headline)
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

                GroupBox("Checkout") {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Reader family: \(terminalManager.selectedReaderFamily.displayName)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        if let authMessage = viewModel.authErrorMessage {
                            Label(authMessage, systemImage: "person.badge.key")
                                .font(.subheadline)
                                .foregroundStyle(.orange)
                        }

                        Button {
                            viewModel.showReaderSheet = true
                        } label: {
                            Label("Reader Setup", systemImage: "dot.radiowaves.left.and.right")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)

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
                        .buttonStyle(.borderedProminent)
                        .disabled(viewModel.isCharging || viewModel.cartLines.isEmpty)

                        Button("Clear Cart", role: .destructive) {
                            viewModel.clearCart()
                        }
                        .disabled(viewModel.cartLines.isEmpty)
                    }
                }
            }
            .padding(20)
        }
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
                    .font(.headline)
                Text(product.formattedPrice)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(product.stock > 0 ? "\(product.stock) in stock" : "Out of stock")
                    .font(.caption)
                    .foregroundStyle(product.stock > 0 ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
            }

            Spacer()

            HStack(spacing: 12) {
                Button {
                    onRemove()
                } label: {
                    Image(systemName: "minus.circle.fill")
                }
                .buttonStyle(.plain)
                .disabled(quantity == 0)

                Text("\(quantity)")
                    .font(.headline.monospacedDigit())
                    .frame(minWidth: 24)

                Button {
                    onAdd()
                } label: {
                    Image(systemName: "plus.circle.fill")
                }
                .buttonStyle(.plain)
                .disabled(!product.isAvailableForSale || quantity >= product.stock)
            }
            .font(.title3)
        }
        .padding(.vertical, 6)
    }
}

private struct NoticeRow: View {
    let notice: POSViewModel.Notice

    var tint: Color {
        switch notice.style {
        case .info:
            return .blue
        case .warning:
            return .orange
        case .error:
            return .red
        }
    }

    var body: some View {
        Label {
            Text(notice.message)
        } icon: {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(tint)
        }
        .font(.subheadline)
    }
}
