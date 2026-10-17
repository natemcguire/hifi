import SwiftUI
#if os(iOS)
import AudioToolbox
import UIKit
#elseif os(macOS)
import AppKit
#endif

// HIFI as a classic click-wheel iPod. The device body fills the whole window
// on every screen: stacked (screen over wheel) when tall, side by side when wide.

enum Page: Hashable {
    case main, band(String), playlists, nowPlaying, settings, about
}

enum WheelRegion: Equatable {
    case menu, next, play, previous, center
}

private struct Row {
    let title: String
    var chevron = true
    var playing = false
    var value: String?
    var subtitle: String?
}

struct IPodView: View {
    @EnvironmentObject private var radio: Radio
    @ObservedObject private var spotify = SpotifyAccount.shared
    @Environment(\.openURL) private var openURL
    @AppStorage("clicker") private var clicker = true
    @AppStorage("backlight") private var backlight = 30  // seconds; 0 = always on
    @State private var stack: [Page] = [.main]
    @State private var selection: [Page: Int] = [:]
    @State private var forward = true
    @State private var showVolume = false
    @State private var volumeTouch = 0
    @State private var dimmed = false
    @State private var lastTouch = Date.now
    @State private var flash: WheelRegion?
    @State private var flashTask: Task<Void, Never>?
    @State private var songTick = 0  // re-reads synth rotations while a list is open
    @State private var shuffleTick = 0  // redraws Settings after a shuffle toggle
    @FocusState private var focused: Bool
    @Namespace private var highlight

    private var page: Page { stack.last ?? .main }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let wide = size.width > size.height * 0.95
            let pad = max(14, min(size.width, size.height) * 0.05)
            ZStack {
                if wide {
                    let wheel = min(size.height - pad * 2, size.width * 0.42)
                    HStack(spacing: pad) {
                        screen(width: size.width - wheel - pad * 3, height: size.height - pad * 2)
                        ClickWheel(diameter: wheel, flash: flash, handler: wheelHandler)
                    }
                    .padding(pad)
                } else {
                    let screenWidth = size.width - pad * 2
                    let screenHeight = min(screenWidth * 0.82, size.height * 0.5)
                    let room = size.height - screenHeight - pad * 2
                    let wheel = min(size.width * 0.8, room * 0.9)
                    VStack(spacing: 0) {
                        screen(width: screenWidth, height: screenHeight)
                        ClickWheel(diameter: wheel, flash: flash, handler: wheelHandler)
                            .frame(maxHeight: .infinity)
                    }
                    .padding(.horizontal, pad)
                    .padding(.top, pad)
                }
            }
            .frame(width: size.width, height: size.height)
        }
        #if os(macOS)
        .padding(.top, 22)  // clear of the traffic lights in the hidden title bar
        #endif
        .background(Shell.body.ignoresSafeArea())
        .preferredColorScheme(.light)
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onAppear {
            focused = true
            #if DEBUG
            // App Store screenshots: `-screenshot radio|synth|nowPlaying|settings` opens that page.
            switch UserDefaults.standard.string(forKey: "screenshot") {
            case "radio": stack = [.main, .band("radio")]
            case "synth": stack = [.main, .band("synth")]
            case "nowPlaying": radio.start(); stack = [.main, .nowPlaying]
            case "settings": stack = [.main, .settings]
            case "playlists": stack = [.main, .playlists]
            default: break
            }
            #endif
        }
        .onKeyPress(.upArrow) { key(nil) { rotate(-1) } }
        .onKeyPress(.downArrow) { key(nil) { rotate(1) } }
        .onKeyPress(.leftArrow) { key(.previous) { radio.skip(-1) } }
        .onKeyPress(.rightArrow) { key(.next) { radio.skip(1) } }
        .onKeyPress(.return) { key(.center) { select() } }
        .onKeyPress(.escape) { key(.menu) { menu() } }
        .onKeyPress(.delete) { key(.menu) { menu() } }
        .onKeyPress(.space) { key(.play) { radio.toggle() } }
        .task(id: page) {
            if page == .playlists { await spotify.refreshPlaylists() }
        }
        // While a station list is open, keep its song lines current.
        .task(id: page) {
            guard case .band = page else { return }
            while !Task.isCancelled {
                await radio.refreshSongs()
                songTick += 1
                try? await Task.sleep(for: .seconds(20))
            }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $spotify.showConnect) { SpotifyConnectView(spotify: spotify) }
        #else
        // The Mac gets the same full white page, filling the whole window.
        .overlay {
            if spotify.showConnect {
                SpotifyConnectView(spotify: spotify)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    .onExitCommand { spotify.showConnect = false }
            }
        }
        .animation(.easeOut(duration: 0.25), value: spotify.showConnect)
        #endif
        #if os(iOS)
        .background { ShuffleHost(radio: radio).frame(width: 120, height: 120).allowsHitTesting(false) }
        #endif
        // Backlight: the screen dims after a quiet spell, like the iPod's timer.
        .task(id: lastTouch) {
            guard backlight > 0 else { return }
            try? await Task.sleep(for: .seconds(backlight))
            withAnimation(.easeInOut(duration: 0.8)) { dimmed = true }
        }
        .task(id: volumeTouch) {
            guard volumeTouch > 0 else { return }
            try? await Task.sleep(for: .seconds(1.6))
            withAnimation(.easeOut(duration: 0.25)) { showVolume = false }
        }
    }

    // A key press flashes the matching part of the wheel, so the keyboard shows where it "clicked".
    private func key(_ region: WheelRegion?, _ action: () -> Void) -> KeyPress.Result {
        if let region { flashWheel(region) }
        touched()
        action()
        return .handled
    }

    private func flashWheel(_ region: WheelRegion) {
        flashTask?.cancel()
        withAnimation(.easeOut(duration: 0.06)) { flash = region }
        flashTask = Task {
            try? await Task.sleep(for: .milliseconds(140))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) { flash = nil }
        }
    }

    private func touched() {
        lastTouch = .now
        if dimmed { withAnimation(.easeOut(duration: 0.2)) { dimmed = false } }
    }

    // MARK: Screen

    private func screen(width: CGFloat, height: CGFloat) -> some View {
        let rowHeight = min(46, max(26, height / 8))
        return VStack(spacing: 0) {
            header(height: rowHeight * 0.92)
            ZStack {
                pageView(page, width: width, rowHeight: rowHeight)
                    .id(page)
                    .transition(.asymmetric(insertion: .move(edge: forward ? .trailing : .leading),
                                            removal: .move(edge: forward ? .leading : .trailing)))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .clipped()
        }
        .background(LinearGradient(colors: [.white, Color(hex: "#eef2f5")], startPoint: .top, endPoint: .bottom))
        .overlay { Color.black.opacity(dimmed ? 0.32 : 0).allowsHitTesting(false) }
        .overlay {
            // A faint diagonal glare across the glass.
            LinearGradient(stops: [.init(color: .white.opacity(0.22), location: 0), .init(color: .white.opacity(0), location: 0.45)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: "#1d1f21")))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.25), lineWidth: 1))
        .frame(width: width, height: height)
        .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
    }

    @ViewBuilder
    private func pageView(_ page: Page, width: CGFloat, rowHeight: CGFloat) -> some View {
        switch page {
        case .nowPlaying: NowPlaying(rowHeight: rowHeight, showVolume: showVolume)
        case .about: about(rowHeight: rowHeight)
        default:
            HStack(spacing: 0) {
                list(rowHeight: rowHeight)
                if page == .main && width > 380 {
                    Cover(station: radio.station)
                        .frame(width: (width - 12) * 0.46)
                        .frame(maxHeight: .infinity)
                        .background(Color(hex: "#1b2024"))
                        .id(radio.station.id)
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.35), value: radio.station.id)
        }
    }

    private func header(height: CGFloat) -> some View {
        ZStack {
            Text(title)
                .font(.system(size: height * 0.5, weight: .bold))
                .lineLimit(1)
                .id(title)
                .transition(.opacity)
            HStack {
                Image(systemName: radio.isPlaying ? "play.fill" : "pause.fill")
                    .font(.system(size: height * 0.36))
                    .foregroundStyle(Color(hex: "#2b6fd6"))
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.pulse, options: .repeating, isActive: radio.isBuffering)
                Spacer()
                Image(systemName: "battery.100")
                    .font(.system(size: height * 0.5))
                    .foregroundStyle(Color(hex: "#3a9a3a"))
            }
            .padding(.horizontal, 8)
        }
        .foregroundStyle(Color(hex: "#111"))
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .background(LinearGradient(colors: [Color(hex: "#fdfdfd"), Color(hex: "#c5cbd1")], startPoint: .top, endPoint: .bottom))
        .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: "#8d959c")).frame(height: 1) }
        .animation(.easeInOut(duration: 0.2), value: title)
    }

    private var title: String {
        switch page {
        case .main: "HIFI"
        case .band(let band): band == "synth" ? "Synth Sounds" : "Radio"
        case .playlists: "Playlists"
        case .nowPlaying: "Now Playing"
        case .settings: "Settings"
        case .about: "About"
        }
    }

    private func list(rowHeight: CGFloat) -> some View {
        let items = rows
        let current = selection[page] ?? 0
        return ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, row in
                        rowView(row, selected: index == current, height: rowHeight)
                            .id(index)
                            .contentShape(Rectangle())
                            .onTapGesture { tapRow(index) }
                    }
                }
            }
            .onChange(of: current) { withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo(current) } }
        }
    }

    private func rowView(_ row: Row, selected: Bool, height: CGFloat) -> some View {
        HStack(spacing: 6) {
            if let subtitle = row.subtitle {
                VStack(alignment: .leading, spacing: 0) {
                    Text(row.title).lineLimit(1).font(.system(size: height * 0.4, weight: .semibold))
                    Text(subtitle).lineLimit(1).font(.system(size: height * 0.3, weight: .regular))
                        .opacity(selected ? 0.9 : 0.6)
                        .contentTransition(.opacity)
                }
            } else {
                Text(row.title).lineLimit(1)
            }
            Spacer(minLength: 4)
            if let value = row.value {
                Text(value).font(.system(size: height * 0.42, weight: .regular))
            }
            if row.playing {
                Image(systemName: "speaker.wave.2.fill")
                    .font(.system(size: height * 0.36))
                    .symbolEffect(.variableColor.iterative, options: .repeating, isActive: radio.isPlaying && !radio.isBuffering)
            }
            if row.chevron { Image(systemName: "chevron.right").font(.system(size: height * 0.36, weight: .bold)) }
        }
        .font(.system(size: height * 0.48, weight: .semibold))
        .foregroundStyle(selected ? .white : Color(hex: "#111"))
        .padding(.horizontal, 10)
        .frame(height: height)
        .background {
            if selected {
                LinearGradient(colors: [Color(hex: "#7cc0f7"), Color(hex: "#2b78e0"), Color(hex: "#1c64c8")], startPoint: .top, endPoint: .bottom)
                    .matchedGeometryEffect(id: "highlight", in: highlight)
            }
        }
    }

    private func about(rowHeight: CGFloat) -> some View {
        VStack(spacing: rowHeight * 0.18) {
            Spacer(minLength: 0)
            Text("HIFI").font(.system(size: rowHeight * 0.9, weight: .heavy))
            Text("by Nate's Software").font(.system(size: rowHeight * 0.5, weight: .semibold))
            Text("Live radio from Radio Paradise and SomaFM, streamed straight from the stations. Synth Sounds are made here.")
                .font(.system(size: rowHeight * 0.36))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 14)
            Text("hifi.nates-software.com").font(.system(size: rowHeight * 0.36, weight: .semibold))
                .foregroundStyle(Color(hex: "#2b6fd6"))
            Spacer(minLength: 0)
        }
        .foregroundStyle(Color(hex: "#111"))
        .minimumScaleFactor(0.5)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { menu() }
    }

    // MARK: Menu model

    private static let mainPages: [Page] = [.nowPlaying, .band("radio"), .band("synth"), .playlists, .settings, .about]

    private var rows: [Row] {
        switch page {
        case .main:
            return [Row(title: "Now Playing", playing: radio.isPlaying), Row(title: "Radio"),
                    Row(title: "Synth Sounds"), Row(title: "Playlists"), Row(title: "Settings"), Row(title: "About")]
        case .band(let band):
            return stations(band).map { Row(title: $0.name.capitalized, chevron: false,
                                            playing: radio.isPlaying && $0.id == radio.station.id,
                                            subtitle: songLine($0)) }
        case .playlists:
            // Nate's Software's playlist first, then the listener's own.
            var list = playlistRows.map { Row(title: $0.name, chevron: false, subtitle: $0.detail) }
            if !spotify.isConnected { list.append(Row(title: "Connect Spotify", chevron: false, subtitle: "See your own playlists here")) }
            return list
        case .settings:
            _ = shuffleTick
            var list = [Row(title: "Backlight", chevron: false, value: backlight == 0 ? "Always On" : "\(backlight) Seconds"),
                        Row(title: "Spotify", chevron: false, value: spotify.isConnected ? "Connected" : "Connect")]
            #if os(iOS)
            list.insert(Row(title: "Clicker", chevron: false, value: clicker ? "On" : "Off"), at: 0)
            if ShufflePlayer.shared.isSupported {
                list.append(Row(title: "Mini Shuffle", chevron: false, value: ShufflePlayer.shared.isActive ? "Showing" : "Open"))
                list.append(Row(title: "Shuffle on Home", chevron: false, value: ShufflePlayer.shared.automatic ? "On" : "Off"))
            }
            #endif
            return list
        default:
            return []
        }
    }

    private var playlistRows: [SpotifyPlaylist] { [spotify.natePlaylist].compactMap { $0 } + spotify.playlists }

    private func stations(_ band: String) -> [Station] { radio.stations.filter { $0.band == band } }

    // "Artist – Song" under each live station; synth stations show their current track.
    private func songLine(_ station: Station) -> String? {
        _ = songTick
        if station.isLive {
            guard let song = radio.songs[station.id], let title = song.title, !title.isEmpty else { return nil }
            return [song.artist, title].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " – ")
        }
        guard let tracks = station.tracks, !tracks.isEmpty else { return nil }
        let track = station.id == radio.station.id && radio.isPlaying ? (radio.track ?? rotationAt(tracks, epoch: radio.catalog.epoch).track)
            : rotationAt(tracks, epoch: radio.catalog.epoch).track
        return "\(track.artist) – \(track.title)"
    }

    private var wheelHandler: ClickWheel.Handler {
        .init(touch: touched, rotate: rotate, menu: menu, previous: { radio.skip(-1) }, next: { radio.skip(1) },
              play: { radio.toggle() }, select: select)
    }

    private func rotate(_ steps: Int) {
        touched()
        if page == .nowPlaying {
            radio.volume = min(1, max(0, radio.volume + Float(steps) * 0.04))
            withAnimation(.easeOut(duration: 0.15)) { showVolume = true }
            volumeTouch += 1
            Feedback.tick()
            return
        }
        let count = rows.count
        guard count > 0 else { return }
        let current = selection[page] ?? 0
        let next = min(count - 1, max(0, current + steps))
        guard next != current else { return }
        withAnimation(.easeOut(duration: 0.1)) { selection[page] = next }
        Feedback.tick()
    }

    // Tapping a row moves the highlight there first, so you see what you picked.
    private func tapRow(_ index: Int) {
        touched()
        Feedback.click()
        withAnimation(.easeOut(duration: 0.1)) { selection[page] = index }
        Task {
            try? await Task.sleep(for: .milliseconds(120))
            select()
        }
    }

    private func push(_ next: Page) {
        if case .band(let band) = next, let index = stations(band).firstIndex(of: radio.station) {
            selection[next] = index
        }
        forward = true
        withAnimation(.easeInOut(duration: 0.25)) { stack.append(next) }
    }

    private func select() {
        touched()
        let index = selection[page] ?? 0
        switch page {
        case .main:
            if Self.mainPages.indices.contains(index) { push(Self.mainPages[index]) }
        case .band(let band):
            let list = stations(band)
            guard list.indices.contains(index) else { return }
            radio.tune(list[index])
            push(.nowPlaying)
        case .playlists:
            // Spotify plays its own music: a playlist opens in the Spotify app.
            if let playlist = playlistRows[safe: index] { openURL(playlist.url) } else { spotify.showConnect = true }
        case .settings:
            switch rows[safe: index]?.title {
            case "Clicker": clicker.toggle()
            case "Spotify": if spotify.isConnected { spotify.disconnect() } else { spotify.showConnect = true }
            #if os(iOS)
            case "Mini Shuffle": ShufflePlayer.shared.toggle()
            case "Shuffle on Home": ShufflePlayer.shared.automatic.toggle(); shuffleTick += 1
            #endif
            case "Backlight":
                let options = [10, 30, 60, 0]
                backlight = options[((options.firstIndex(of: backlight) ?? 1) + 1) % options.count]
                lastTouch = .now
            default: break
            }
        case .nowPlaying:
            radio.toggle()
        case .about:
            menu()
        }
    }

    private func menu() {
        touched()
        guard stack.count > 1 else { return }
        forward = false
        withAnimation(.easeInOut(duration: 0.25)) { _ = stack.removeLast() }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

// MARK: Now Playing

private struct NowPlaying: View {
    @EnvironmentObject private var radio: Radio
    @ObservedObject private var spotify = SpotifyAccount.shared
    let rowHeight: CGFloat
    let showVolume: Bool

    var body: some View {
        GeometryReader { geo in
            let art = min(geo.size.width * 0.42, geo.size.height * 0.62)
            VStack(spacing: 0) {
                Text(position)
                    .font(.system(size: rowHeight * 0.36, weight: .semibold))
                    .foregroundStyle(Color(hex: "#444"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.top, 6)
                HStack(alignment: .center, spacing: 12) {
                    Cover(station: radio.station)
                        .frame(width: art, height: art)
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                        .shadow(color: .black.opacity(0.25), radius: 3, y: 2)
                        .rotation3DEffect(.degrees(radio.isPlaying ? 0 : 8), axis: (x: 0, y: 1, z: 0))
                        .id(radio.station.id)
                        .transition(.asymmetric(insertion: .scale(scale: 0.85).combined(with: .opacity), removal: .opacity))
                    VStack(alignment: .leading, spacing: rowHeight * 0.12) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(radio.displayTitle)
                                .font(.system(size: rowHeight * 0.5, weight: .bold))
                                .lineLimit(3)
                                .contentTransition(.opacity)
                            if radio.heartable { heart }
                        }
                        Text(radio.displayArtist)
                            .font(.system(size: rowHeight * 0.42, weight: .semibold))
                            .foregroundStyle(Color(hex: "#333"))
                            .lineLimit(2)
                            .contentTransition(.opacity)
                        Text(radio.station.name.capitalized)
                            .font(.system(size: rowHeight * 0.38))
                            .foregroundStyle(Color(hex: "#555"))
                            .lineLimit(1)
                        if let problem = radio.problem ?? spotify.problem {
                            Text(problem).font(.system(size: rowHeight * 0.32)).foregroundStyle(.orange)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .minimumScaleFactor(0.6)
                }
                .padding(.horizontal, 10)
                .frame(maxHeight: .infinity)
                ZStack {
                    if showVolume { volume.transition(.opacity) } else { progress.transition(.opacity) }
                }
                .padding(.horizontal, 10)
                .padding(.bottom, rowHeight * 0.35)
            }
            .foregroundStyle(Color(hex: "#111"))
            .animation(.easeInOut(duration: 0.3), value: radio.station.id)
            .animation(.easeInOut(duration: 0.4), value: radio.displayTitle)
            .animation(.spring(duration: 0.4), value: radio.isPlaying)
        }
    }

    // ♥ saves the live song to the listener's Spotify Liked Songs.
    private var heart: some View {
        let liked = spotify.isLiked(trackId: radio.spotifyTrackId, artist: radio.displayArtist, title: radio.displayTitle)
        return Button {
            Feedback.click()
            spotify.toggleHeart(trackId: radio.spotifyTrackId, artist: radio.displayArtist, title: radio.displayTitle)
        } label: {
            Image(systemName: liked ? "heart.fill" : "heart")
                .font(.system(size: rowHeight * 0.5, weight: .semibold))
                .foregroundStyle(liked ? Color(hex: "#e5484d") : Color(hex: "#555"))
                .contentTransition(.symbolEffect(.replace))
                .padding(4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(liked ? "Remove from Liked Songs" : "Save to Liked Songs on Spotify")
        .task(id: radio.displayTitle) {
            await spotify.check(trackId: radio.spotifyTrackId, artist: radio.displayArtist, title: radio.displayTitle)
        }
    }

    private var position: String {
        let list = radio.stations.filter { $0.band == radio.station.band }
        let index = (list.firstIndex(of: radio.station) ?? 0) + 1
        return "\(index) of \(list.count)"
    }

    private var progress: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
            let duration = radio.station.isLive ? 0 : (radio.track?.duration ?? 0)
            let elapsed = min(radio.elapsed, duration)
            VStack(spacing: 3) {
                Bar(fraction: duration > 0 ? elapsed / duration : (radio.isPlaying ? 1 : 0), height: rowHeight * 0.3,
                    live: radio.station.isLive, shimmer: radio.station.isLive && radio.isPlaying)
                HStack {
                    Text(radio.station.isLive ? "LIVE" : clock(elapsed))
                    Spacer()
                    Text(radio.isBuffering ? "Tuning…" : radio.isPlaying ? "" : "Stopped")
                    Spacer()
                    Text(radio.station.isLive ? "HIFI" : "-" + clock(duration - elapsed))
                }
                .font(.system(size: rowHeight * 0.32, weight: .semibold).monospacedDigit())
            }
        }
    }

    private var volume: some View {
        HStack(spacing: 8) {
            Image(systemName: "speaker.fill")
            Bar(fraction: Double(radio.volume), height: rowHeight * 0.3, live: false, shimmer: false)
                .animation(.easeOut(duration: 0.1), value: radio.volume)
            Image(systemName: "speaker.wave.3.fill")
        }
        .font(.system(size: rowHeight * 0.36))
        .padding(.bottom, rowHeight * 0.32 + 3)
    }

    private func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

private struct Bar: View {
    let fraction: Double
    let height: CGFloat
    let live: Bool
    let shimmer: Bool

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(LinearGradient(colors: [Color(hex: "#d9dde1"), Color(hex: "#f4f6f8")], startPoint: .top, endPoint: .bottom))
                Rectangle()
                    .fill(LinearGradient(colors: live ? [Color(hex: "#9fd57a"), Color(hex: "#4f9e2f")] : [Color(hex: "#7cc0f7"), Color(hex: "#1c64c8")],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(width: geo.size.width * min(1, max(0, fraction)))
                if shimmer {
                    // A light sweeping across the live bar: on air.
                    TimelineView(.animation) { context in
                        let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
                        LinearGradient(colors: [.white.opacity(0), .white.opacity(0.55), .white.opacity(0)], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width * 0.25)
                            .offset(x: geo.size.width * (t * 1.5 - 0.25))
                    }
                    .clipped()
                }
            }
            .overlay(Rectangle().stroke(Color(hex: "#6f7880"), lineWidth: 1))
        }
        .frame(height: height)
    }
}

// MARK: Click wheel

struct ClickWheel: View {
    struct Handler {
        let touch: () -> Void
        let rotate: (Int) -> Void
        let menu: () -> Void
        let previous: () -> Void
        let next: () -> Void
        let play: () -> Void
        let select: () -> Void
    }

    let diameter: CGFloat
    var flash: WheelRegion?
    let handler: Handler
    @State private var lastAngle: Double?
    @State private var accumulated = 0.0
    @State private var rotated = false
    @State private var startedOnRing = false
    @State private var pressed: WheelRegion?
    @State private var thumb: Double?  // finger angle while scrolling
    @State private var hover: WheelRegion?
    @State private var releaseTask: Task<Void, Never>?

    private var hub: CGFloat { diameter * 0.36 }
    private var active: WheelRegion? { pressed ?? flash }
    private let detent = Double.pi * 2 / 18

    var body: some View {
        ZStack {
            Circle()
                .fill(LinearGradient(colors: [Color(hex: "#f4f4f4"), Color(hex: "#d8d9db")], startPoint: .top, endPoint: .bottom))
                .overlay(Circle().stroke(Color.black.opacity(0.12), lineWidth: 1))
                .shadow(color: .black.opacity(0.08), radius: 1, y: 1)
            ForEach([WheelRegion.menu, .next, .play, .previous], id: \.self) { region in
                Wedge(region: region, inner: hub / diameter)
                    .fill(RadialGradient(colors: [Color.black.opacity(0.03), Color.black.opacity(0.13)],
                                         center: .center, startRadius: hub / 2, endRadius: diameter / 2))
                    .opacity(active == region ? 1 : hover == region ? 0.35 : 0)
            }
            if let thumb {
                // A soft glow under the finger while scrolling.
                Circle()
                    .fill(RadialGradient(colors: [.white.opacity(0.95), .white.opacity(0)], center: .center, startRadius: 0, endRadius: diameter * 0.09))
                    .frame(width: diameter * 0.18, height: diameter * 0.18)
                    .offset(x: cos(thumb) * (diameter + hub) / 4, y: sin(thumb) * (diameter + hub) / 4)
                    .transition(.opacity)
                    .allowsHitTesting(false)
            }
            label(Text("MENU").font(.system(size: diameter * 0.065, weight: .bold)), region: .menu, y: -1)
            label(Image(systemName: "playpause.fill").font(.system(size: diameter * 0.065)), region: .play, y: 1)
            label(Image(systemName: "backward.end.alt.fill").font(.system(size: diameter * 0.065)), region: .previous, x: -1)
            label(Image(systemName: "forward.end.alt.fill").font(.system(size: diameter * 0.065)), region: .next, x: 1)
            centerButton
        }
        .frame(width: diameter, height: diameter)
        .contentShape(Circle())
        .gesture(DragGesture(minimumDistance: 0).onChanged(changed).onEnded(ended))
        #if os(macOS)
        .onContinuousHover { phase in
            switch phase {
            case .active(let point): hover = region(at: point)
            case .ended: hover = nil
            }
        }
        .animation(.easeOut(duration: 0.12), value: hover)
        #endif
        .accessibilityElement()
        .accessibilityLabel("Click wheel")
    }

    private var centerButton: some View {
        let down = active == .center
        return Circle()
            .fill(LinearGradient(colors: down ? [Color(hex: "#d4d6d9"), Color(hex: "#eeeff0")] : [Color(hex: "#fbfbfb"), Color(hex: "#e2e3e5")],
                                 startPoint: .top, endPoint: .bottom))
            .overlay(Circle().stroke(Color.black.opacity(down ? 0.22 : 0.14), lineWidth: 1))
            .overlay {
                if hover == .center && !down { Circle().fill(Color.black.opacity(0.03)) }
            }
            .frame(width: hub, height: hub)
            .scaleEffect(down ? 0.95 : 1)
            .shadow(color: .black.opacity(down ? 0.02 : 0.12), radius: down ? 0.5 : 2, y: down ? 0 : 1)
    }

    private func label(_ content: some View, region: WheelRegion, x: CGFloat = 0, y: CGFloat = 0) -> some View {
        content
            .foregroundStyle(active == region ? Color(hex: "#4d5358") : hover == region ? Color(hex: "#7f858b") : Color(hex: "#a3a8ad"))
            .scaleEffect(active == region ? 0.88 : 1)
            .offset(x: x * diameter * 0.37, y: y * diameter * 0.37)
    }

    private func region(at point: CGPoint) -> WheelRegion? {
        let dx = point.x - diameter / 2, dy = point.y - diameter / 2
        let distance = hypot(dx, dy)
        if distance > diameter / 2 { return nil }
        if distance <= hub / 2 { return .center }
        switch atan2(dy, dx) {
        case (-3 * .pi / 4)..<(-.pi / 4): return .menu
        case (-.pi / 4)..<(.pi / 4): return .next
        case (.pi / 4)..<(3 * .pi / 4): return .play
        default: return .previous
        }
    }

    private func changed(_ value: DragGesture.Value) {
        let dx = value.location.x - diameter / 2, dy = value.location.y - diameter / 2
        let angle = atan2(dy, dx)
        guard let last = lastAngle else {
            // Touch down: show the press right away.
            releaseTask?.cancel()
            lastAngle = angle
            startedOnRing = hypot(dx, dy) > hub / 2
            handler.touch()
            withAnimation(.easeOut(duration: 0.06)) { pressed = region(at: value.location) }
            return
        }
        guard startedOnRing, hypot(dx, dy) > hub * 0.3 else { return }
        var delta = angle - last
        if delta > .pi { delta -= 2 * .pi }
        if delta < -.pi { delta += 2 * .pi }
        lastAngle = angle
        accumulated += delta
        if rotated || abs(accumulated) > detent * 0.5 {
            if pressed != nil { withAnimation(.easeOut(duration: 0.15)) { pressed = nil } }
            thumb = angle
        }
        while abs(accumulated) >= detent {
            let step = accumulated > 0 ? 1 : -1  // clockwise scrolls down, like the iPod
            handler.rotate(step)
            accumulated -= Double(step) * detent
            rotated = true
        }
    }

    private func ended(_ value: DragGesture.Value) {
        let wasRotating = rotated
        let tapped = !wasRotating && hypot(value.translation.width, value.translation.height) < 12
        let target = region(at: value.location)
        lastAngle = nil; accumulated = 0; rotated = false
        withAnimation(.easeOut(duration: 0.3)) { thumb = nil }
        if tapped, let target {
            Feedback.click()
            switch target {
            case .center: handler.select()
            case .menu: handler.menu()
            case .next: handler.next()
            case .play: handler.play()
            case .previous: handler.previous()
            }
            // Hold the pressed look a beat so a quick tap still shows where it landed.
            pressed = target
            releaseTask = Task {
                try? await Task.sleep(for: .milliseconds(130))
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.22)) { pressed = nil }
            }
        } else {
            withAnimation(.easeOut(duration: 0.2)) { pressed = nil }
        }
    }
}

// One quarter of the ring, centered on its button.
private struct Wedge: Shape {
    let region: WheelRegion
    let inner: CGFloat  // hub diameter / wheel diameter

    func path(in rect: CGRect) -> Path {
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let middle: Double = switch region {
        case .menu: -90
        case .next: 0
        case .play: 90
        case .previous, .center: 180
        }
        var path = Path()
        path.addArc(center: center, radius: outer, startAngle: .degrees(middle - 45), endAngle: .degrees(middle + 45), clockwise: false)
        path.addArc(center: center, radius: outer * inner, startAngle: .degrees(middle + 45), endAngle: .degrees(middle - 45), clockwise: true)
        path.closeSubpath()
        return path
    }
}

// MARK: Look and feel

enum Shell {
    static let body = LinearGradient(colors: [Color(hex: "#fdfdfd"), Color(hex: "#e9eaec"), Color(hex: "#d6d8db")],
                                     startPoint: .top, endPoint: .bottom)
}

// Haptics plus the iPod's clicker sound (iPhone; Settings > Clicker).
enum Feedback {
    private static var clicker: Bool { UserDefaults.standard.object(forKey: "clicker") as? Bool ?? true }

    static func tick() {
        #if os(iOS)
        UISelectionFeedbackGenerator().selectionChanged()
        if clicker { AudioServicesPlaySystemSound(1104) }
        #elseif os(macOS)
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        #endif
    }

    static func click() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        if clicker { AudioServicesPlaySystemSound(1104) }
        #elseif os(macOS)
        NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
        #endif
    }
}
