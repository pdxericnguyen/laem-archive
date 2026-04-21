import SwiftUI

struct ReaderSheetView: View {
    @ObservedObject var terminalManager: LAEMTerminalManager
    @Environment(\.dismiss) private var dismiss

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

                Section("Actions") {
                    Button(terminalManager.status == .discovering ? "Restart Reader Discovery" : "Start Reader Discovery") {
                        Task {
                            await terminalManager.beginDiscovery()
                        }
                    }
                    .disabled(terminalManager.isBusy && terminalManager.status != .discovering)

                    if terminalManager.status == .discovering || !terminalManager.discoveredReaders.isEmpty {
                        Button("Stop Discovery") {
                            terminalManager.stopDiscovery()
                        }
                    }

                    if terminalManager.connectedReader != nil {
                        Button("Disconnect Reader", role: .destructive) {
                            Task {
                                await terminalManager.disconnectReader()
                            }
                        }
                    }
                }

                Section("Readers") {
                    if terminalManager.discoveredReaders.isEmpty {
                        Text(terminalManager.isSDKInstalled
                             ? terminalManager.selectedReaderFamily.emptyStateText
                             : "Add the StripeTerminal package first, then this sheet can discover supported Stripe readers.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(terminalManager.discoveredReaders) { reader in
                            Button {
                                Task {
                                    try? await terminalManager.connect(to: reader)
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(reader.label)
                                    Text(reader.detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .disabled(terminalManager.isBusy && terminalManager.connectedReader?.id != reader.id)
                        }
                    }
                }

                Section("Notes") {
                    Text(terminalManager.selectedReaderFamily.setupNote)
                        .foregroundStyle(.secondary)
                    Text("Offline mode is enabled. When connectivity drops, Stripe Terminal can store eligible M2 payments on this device and forward them when the network returns.")
                        .foregroundStyle(.secondary)
                    Text("LAEM can support both mobile and smart readers across different staff devices, but each app session should control only one connected reader at a time.")
                        .foregroundStyle(.secondary)
                }
            }
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
