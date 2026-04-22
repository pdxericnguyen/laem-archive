import SwiftUI

struct ReaderStatusCard: View {
    @ObservedObject var terminalManager: LAEMTerminalManager
    let onSetupTapped: () -> Void

    private var tint: Color {
        switch terminalManager.status {
        case .connected:
            return POSBrand.success
        case .discovering, .connecting, .disconnecting, .reconnecting:
            return POSBrand.warning
        case .sdkMissing, .error:
            return POSBrand.danger
        default:
            return POSBrand.info
        }
    }

    private var statusPill: some View {
        Text(terminalManager.status.label.uppercased())
            .font(.caption2.weight(.semibold))
            .tracking(1.0)
            .padding(.vertical, 5)
            .padding(.horizontal, 10)
            .foregroundStyle(tint)
            .background(
                Capsule()
                    .fill(tint.opacity(0.14))
            )
            .overlay(
                Capsule()
                    .stroke(tint.opacity(0.24), lineWidth: 1)
            )
    }

    var body: some View {
        GroupBox("Reader") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center) {
                    statusPill
                    Spacer()
                    Button("Setup", action: onSetupTapped)
                        .buttonStyle(POSSecondaryActionStyle())
                        .frame(maxWidth: 130)
                }

                Text(terminalManager.statusDetail)
                    .font(.subheadline)
                    .foregroundStyle(POSBrand.textSecondary)

                LabeledContent("Family", value: terminalManager.selectedReaderFamily.displayName)
                LabeledContent("Network", value: terminalManager.offlineNetworkStatusLabel)
                LabeledContent("Queued offline", value: "\(terminalManager.offlineQueueCount)")
                LabeledContent("Stored amount", value: terminalManager.offlineStoredAmountSummary)

                if let reader = terminalManager.connectedReader {
                    LabeledContent("Connected", value: reader.label)
                } else {
                    Text("No reader connected")
                        .font(.subheadline)
                        .foregroundStyle(POSBrand.textSecondary)
                }
            }
            .foregroundStyle(POSBrand.textPrimary)
        }
        .groupBoxStyle(POSPanelGroupBoxStyle())
    }
}
