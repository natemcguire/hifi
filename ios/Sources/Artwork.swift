import SwiftUI

// Station art for the lock screen and the Now Playing screen: the HIFI bars on
// a dark tile in the station's color, with its name. Rendered once per station.
enum Artwork {
    #if os(macOS)
    typealias PlatformImage = NSImage
    #else
    typealias PlatformImage = UIImage
    #endif

    @MainActor private static var cache: [String: PlatformImage] = [:]

    @MainActor
    static func image(for station: Station) -> PlatformImage {
        if let hit = cache[station.id] { return hit }
        let renderer = ImageRenderer(content: Cover(station: station).frame(width: 600, height: 600))
        renderer.scale = 1
        #if os(macOS)
        let image = renderer.nsImage ?? NSImage()
        #else
        let image = renderer.uiImage ?? UIImage()
        #endif
        cache[station.id] = image
        return image
    }

    @MainActor private static var screens: [String: PlatformImage] = [:]

    // Lock-screen art: a classic iPod Now Playing screen showing this song.
    // Re-rendered whenever the song changes.
    @MainActor
    static func screen(station: Station, title: String, artist: String, position: String) -> PlatformImage {
        let key = [station.id, title, artist, position].joined(separator: "\n")
        if let hit = screens[key] { return hit }
        let renderer = ImageRenderer(content: LockScreen(station: station, title: title, artist: artist, position: position)
            .frame(width: 600, height: 600))
        renderer.scale = 2
        #if os(macOS)
        let image = renderer.nsImage ?? NSImage()
        #else
        let image = renderer.uiImage ?? UIImage()
        #endif
        if screens.count > 24 { screens.removeAll() }
        screens[key] = image
        return image
    }
}

// The iPod screen, framed in its dark bezel: title bar, "1 of 5", reflected
// cover art, song details and the progress bar (green and full when live).
struct LockScreen: View {
    let station: Station
    let title: String
    let artist: String
    let position: String

    var body: some View {
        let u = 600.0 / 100
        ZStack {
            Color(hex: "#1a1c1f")
            VStack(spacing: 0) {
                HStack(spacing: 2 * u) {
                    Image(systemName: "play.fill").font(.system(size: 3.4 * u))
                    Spacer()
                    Text("Now Playing").font(.system(size: 4.6 * u, weight: .bold))
                    Spacer()
                    battery(u)
                }
                .padding(.horizontal, 3 * u)
                .frame(height: 9 * u)
                .background(LinearGradient(colors: [Color(hex: "#fdfdfd"), Color(hex: "#d8dce0"), Color(hex: "#bfc5cb")], startPoint: .top, endPoint: .bottom))
                .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: "#8a939b")).frame(height: 0.3 * u) }

                Text(position)
                    .font(.system(size: 3.6 * u, weight: .semibold))
                    .foregroundStyle(Color(hex: "#444"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4 * u).padding(.top, 2.5 * u)

                HStack(alignment: .center, spacing: 4 * u) {
                    VStack(spacing: 0) {
                        Cover(station: station)
                            .frame(width: 40 * u, height: 40 * u)
                            .shadow(color: .black.opacity(0.35), radius: 1.2 * u, y: 0.6 * u)
                        // The classic cover reflection.
                        Cover(station: station)
                            .frame(width: 40 * u, height: 40 * u)
                            .scaleEffect(x: 1, y: -1)
                            .frame(height: 12 * u, alignment: .top)
                            .clipped()
                            .opacity(0.35)
                            .mask(LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))
                            .padding(.top, 0.6 * u)
                    }
                    VStack(alignment: .leading, spacing: 1.6 * u) {
                        Text(title).font(.system(size: 6 * u, weight: .bold)).lineLimit(3)
                        Text(artist).font(.system(size: 4.6 * u, weight: .semibold)).foregroundStyle(Color(hex: "#333")).lineLimit(2)
                        Text(station.name.capitalized).font(.system(size: 4 * u)).foregroundStyle(Color(hex: "#555")).lineLimit(1)
                    }
                    .minimumScaleFactor(0.5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 4 * u)
                .frame(maxHeight: .infinity)

                VStack(spacing: 1 * u) {
                    ZStack(alignment: .leading) {
                        Rectangle().fill(LinearGradient(colors: [Color(hex: "#d9dde1"), Color(hex: "#f4f6f8")], startPoint: .top, endPoint: .bottom))
                        Rectangle()
                            .fill(LinearGradient(colors: station.isLive ? [Color(hex: "#9fd57a"), Color(hex: "#4f9e2f")] : [Color(hex: "#7cc0f7"), Color(hex: "#1c64c8")],
                                                 startPoint: .top, endPoint: .bottom))
                            .frame(width: station.isLive ? nil : 30 * u)
                    }
                    .frame(height: 3.4 * u)
                    .overlay(Rectangle().stroke(Color(hex: "#6f7880"), lineWidth: 0.3 * u))
                    HStack {
                        Text(station.isLive ? "LIVE" : station.genre)
                        Spacer()
                        Text("HIFI")
                    }
                    .font(.system(size: 3.4 * u, weight: .semibold))
                }
                .padding(.horizontal, 4 * u).padding(.bottom, 4 * u)
            }
            .foregroundStyle(Color(hex: "#111"))
            .background(LinearGradient(colors: [.white, Color(hex: "#eef1f4")], startPoint: .top, endPoint: .bottom))
            .overlay(LinearGradient(colors: [.white.opacity(0.35), .clear], startPoint: .topLeading, endPoint: .center))
            .clipShape(RoundedRectangle(cornerRadius: 1.5 * u))
            .padding(3.5 * u)
        }
    }

    private func battery(_ u: Double) -> some View {
        HStack(spacing: 0.3 * u) {
            RoundedRectangle(cornerRadius: 0.5 * u)
                .stroke(Color(hex: "#333"), lineWidth: 0.4 * u)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 0.3 * u)
                        .fill(LinearGradient(colors: [Color(hex: "#b5ed88"), Color(hex: "#4f9e2f")], startPoint: .top, endPoint: .bottom))
                        .padding(0.7 * u)
                }
                .frame(width: 6.4 * u, height: 3.4 * u)
            Rectangle().fill(Color(hex: "#333")).frame(width: 0.5 * u, height: 1.4 * u)
        }
    }
}

struct Cover: View {
    let station: Station

    var body: some View {
        GeometryReader { geo in
            let u = geo.size.width / 32
            ZStack(alignment: .topLeading) {
                LinearGradient(colors: [Color(hex: "#3d474e"), Color(hex: "#1b2024")], startPoint: .top, endPoint: .bottom)
                ForEach([(6.0, 9.0), (14.0, 4.0), (22.0, 7.0)], id: \.0) { x, top in
                    Rectangle().fill(station.tint)
                        .frame(width: 4 * u, height: (17 - top) * u)
                        .offset(x: x * u, y: top * u)
                }
                VStack(spacing: 0.4 * u) {
                    Text(station.name)
                        .font(.system(size: 2.8 * u, weight: .heavy, design: .rounded))
                        .foregroundStyle(station.tint)
                    Text(station.genre)
                        .font(.system(size: 1.5 * u, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.65))
                }
                .lineLimit(1).minimumScaleFactor(0.3)
                .frame(width: 28 * u)
                .offset(x: 2 * u, y: 20.5 * u)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipped()
    }
}
