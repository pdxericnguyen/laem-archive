import SwiftUI

struct ReaderSheetView: View {
    @ObservedObject var terminalManager: LAEMTerminalManager
    @Environment(\.dismiss) private var dismiss
    @State private var readerActionMessage: String?
    @State private var readerErrorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Reader Family") {
                    Picker("Reader Family", selection: selectedReaderFamilyBinding) {
                        ForEach(TerminalReaderFamily.allCases) { family in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(family.displayName)
                                Text(family.detailLabel)
                                    .font(.caption)
                                    .foregroundStyle(POSBrand.textSecondary)
                            }
                            .tag(family)
                        }
                    }
                    .pickerStyle(.navigationLink)
                    .disabled(terminalManager.isBusy || terminalManager.connectedReader != nil)
                }

                Section("Status") {
                    LabeledContent("State", value: terminalManager.status.label)
                    LabeledContent("Family", value: terminalManager.selectedReaderFamily.displayName)
                    LabeledContent("Detail", value: terminalManager.statusDetail)
                    LabeledContent("Display", value: terminalManager.displayMessage)
                    LabeledContent("Network", value: terminalManager.offlineNetworkStatusLabel)
                    LabeledContent("Queued offline payments", value: "\(terminalManager.offlineQueueCount)")
                    LabeledContent("Stored amount", value: terminalManager.offlineStoredAmountSummary)
                }

                if readerActionMessage != nil || readerErrorMessage != nil {
                    Section("Last Action") {
                        if let readerActionMessage {
                            Label(readerActionMessage, systemImage: "checkmark.circle")
                                .foregroundStyle(POSBrand.success)
                        }

                        if let readerErrorMessage {
                            Label(readerErrorMessage, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(POSBrand.danger)
                        }
                    }
                }

                Section("Actions") {
                    Button(terminalManager.status == .discovering ? "Restart Reader Discovery" : "Start Reader Discovery") {
                        Task {
                            readerErrorMessage = nil
                            readerActionMessage = "Searching for readers..."
                            await terminalManager.beginDiscovery()
                        }
                    }
                    .disabled(terminalManager.isBusy && terminalManager.status != .discovering)

                    if terminalManager.status == .discovering || !terminalManager.discoveredReaders.isEmpty {
                        Button("Stop Discovery") {
                            terminalManager.stopDiscovery()
                            readerActionMessage = "Reader discovery stopped."
                            readerErrorMessage = nil
                        }
                    }

                    if terminalManager.connectedReader != nil {
                        Button("Disconnect Reader", role: .destructive) {
                            Task {
                                await terminalManager.disconnectReader()
                                if terminalManager.connectedReader == nil {
                                    readerActionMessage = "Reader disconnected."
                                    readerErrorMessage = nil
                                } else {
                                    readerActionMessage = nil
                                    readerErrorMessage = terminalManager.statusDetail
                                }
                            }
                        }
                    }
                }

                Section("Readers") {
                    if terminalManager.discoveredReaders.isEmpty {
                        Text(terminalManager.isSDKInstalled
                             ? terminalManager.selectedReaderFamily.emptyStateText
                             : "Add the StripeTerminal package first, then this sheet can discover supported Stripe readers.")
                            .foregroundStyle(POSBrand.textSecondary)
                    } else {
                        ForEach(terminalManager.discoveredReaders) { reader in
                            Button {
                                Task {
                                    readerErrorMessage = nil
                                    readerActionMessage = "Connecting to \(reader.label)..."
                                    do {
                                        try await terminalManager.connect(to: reader)
                                        readerActionMessage = "Connected to \(reader.label)."
                                    } catch {
                                        readerActionMessage = nil
                                        readerErrorMessage = error.localizedDescription
                                    }
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(reader.label)
                                    Text(reader.detail)
                                        .font(.caption)
                                        .foregroundStyle(POSBrand.textSecondary)
                                }
                            }
                            .disabled(terminalManager.isBusy && terminalManager.connectedReader?.id != reader.id)
                        }
                    }
                }

                Section("Notes") {
                    Text(terminalManager.selectedReaderFamily.setupNote)
                        .foregroundStyle(POSBrand.textSecondary)
                    Text("Offline mode is enabled. When connectivity drops, Stripe Terminal can store eligible M2 payments on this device and forward them when the network returns.")
                        .foregroundStyle(POSBrand.textSecondary)
                    Text("LAEM can support both mobile and smart readers across different staff devices, but each app session should control only one connected reader at a time.")
                        .foregroundStyle(POSBrand.textSecondary)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(POSBrand.pageBackground)
            .navigationTitle("Reader Setup")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var selectedReaderFamilyBinding: Binding<TerminalReaderFamily> {
        Binding(
            get: { terminalManager.selectedReaderFamily },
            set: { terminalManager.setSelectedReaderFamily($0) }
        )
    }
}
