import SwiftUI

@main struct PicmakeApp: App {
    @StateObject private var store = AppStore()
    var body: some Scene {
        WindowGroup {
            WorkspaceView()
                .environmentObject(store)
                .tint(Color(red: 0.9, green: 0, blue: 0.07))
                .task { await store.start() }
        }
    }
}
