import SwiftUI

struct ReaderStatusCard: View {
    @ObservedObject var terminalManager: LAEMTerminalManager
    let onSetupTapped: () -> Void

    private var tint: Color {
        switch terminalManager.status {
        case .connected:
            return .green
        case .discovering, .connecting, .disconnecting, .reconnecting:
            return .orange
        case .sdkMissing, .error:
            return .red
        default:
            return .blue
        }
    }

    var body: some View {
        GroupBox("Reader") {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(terminalManager.status.label, systemImage: "wave.3.right.circle.fill")
                        .foregroundStyle(tint)
                    Spacer()
                    Button("Setup", action: onSetupTapped)
                }

                Text(terminalManager.statusDetail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                LabeledContent("Family", value: terminalManager.selectedReaderFamily.displayName)
                LabeledContent("Network", value: terminalManager.offlineNetworkStatusLabel)
                LabeledContent("Queued offline", value: "\(terminalManager.offlineQueueCount)")
                LabeledContent("Stored amount", value: terminalManager.offlineStoredAmountSummary)

                if let reader = terminalManager.connectedReader {
                    LabeledContent("Connected", value: reader.label)
                } else {
                    Text("No reader connected")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
