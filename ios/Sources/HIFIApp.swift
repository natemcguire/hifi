import SwiftUI

@main
struct HIFIApp: App {
    @StateObject private var radio = Radio()
    @UIApplicationDelegateAdaptor(OrientationLock.self) private var orientation

    var body: some Scene {
        WindowGroup {
            IPodView()
                .environmentObject(radio)
                .onOpenURL { SpotifyAccount.shared.handle($0) }
        }
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
