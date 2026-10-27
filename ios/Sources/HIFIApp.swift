import SwiftUI

@main
struct HIFIApp: App {
    @StateObject private var radio = Radio()

    var body: some Scene {
        WindowGroup {
            IPodView()
                .environmentObject(radio)
                .onOpenURL { SpotifyAccount.shared.handle($0) }
                #if os(macOS)
                .frame(minWidth: 340, minHeight: 520)
                .handlesExternalEvents(preferring: ["*"], allowing: ["*"])  // a link reuses this window
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
        var digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }  // "#555" means "#555555"
        let value = UInt32(digits, radix: 16) ?? 0xb5ed88
        self.init(red: Double((value >> 16) & 0xff) / 255, green: Double((value >> 8) & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }
}
