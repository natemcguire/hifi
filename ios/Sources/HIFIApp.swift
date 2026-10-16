import SwiftUI

@main
struct HIFIApp: App {
    @StateObject private var radio = Radio()

    var body: some Scene {
        WindowGroup {
            IPodView()
                .environmentObject(radio)
                #if os(macOS)
                .frame(minWidth: 340, minHeight: 520)
                #endif
        }
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 420, height: 700)
        .windowResizability(.contentMinSize)
        #endif
    }
}

extension Color {
    init(hex: String) {
        let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0xb5ed88
        self.init(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }
}
