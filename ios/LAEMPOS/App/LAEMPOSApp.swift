import SwiftUI

@main
struct LAEMPOSApp: App {
    @StateObject private var appModel = LAEMPOSAppModel()

    var body: some Scene {
        WindowGroup {
            POSRootView(
                viewModel: appModel.viewModel,
                terminalManager: appModel.terminalManager
            )
        }
    }
}

@MainActor
final class LAEMPOSAppModel: ObservableObject {
    let terminalManager: LAEMTerminalManager
    let viewModel: POSViewModel

    init() {
        let apiClient = APIClient.makeDefault()
        let terminalManager = LAEMTerminalManager(apiClient: apiClient)
        let viewModel = POSViewModel(
            apiClient: apiClient,
            terminalManager: terminalManager,
            userDefaults: .standard
        )
        self.terminalManager = terminalManager
        self.viewModel = viewModel
        apiClient?.setUnauthorizedHandler { [weak viewModel] in
            viewModel?.handleUnauthorizedSession()
        }
    }
}
