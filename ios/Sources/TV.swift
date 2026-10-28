import AVFoundation
import SwiftUI
import WebKit
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// HIFI TV and video stations on the Now Playing screen.

#if os(iOS)
typealias PlatformView = UIView
typealias PlatformRepresentable = UIViewRepresentable
#else
typealias PlatformView = NSView
typealias PlatformRepresentable = NSViewRepresentable
#endif

// A station's clip, muted and looping, filling its frame with hard pixels. A new
// clip loads under the old one and crossfades in once its first frame is ready.
struct LoopingVideo: PlatformRepresentable {
    let url: URL

    final class Slot {
        let player = AVQueuePlayer()
        let layer = AVPlayerLayer()
        var looper: AVPlayerLooper?
        var ready: NSKeyValueObservation?
    }

    final class Coordinator {
        var current: Slot?
        var shown: URL?
    }

    final class LayerView: PlatformView {
        #if os(iOS)
        override func layoutSubviews() { super.layoutSubviews(); layer.sublayers?.forEach { $0.frame = bounds } }
        #else
        override init(frame: CGRect) { super.init(frame: frame); wantsLayer = true }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func layout() { super.layout(); layer?.sublayers?.forEach { $0.frame = bounds } }
        #endif
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func show(_ url: URL, in view: LayerView, _ coordinator: Coordinator) {
        guard coordinator.shown != url else { return }
        coordinator.shown = url
        let slot = Slot()
        slot.layer.videoGravity = .resizeAspectFill
        slot.layer.magnificationFilter = .nearest
        slot.layer.opacity = 0
        slot.layer.frame = view.bounds
        slot.layer.player = slot.player
        slot.player.isMuted = true
        slot.player.preventsDisplaySleepDuringVideoPlayback = false
        slot.looper = AVPlayerLooper(player: slot.player, templateItem: AVPlayerItem(url: url))
        #if os(iOS)
        view.layer.addSublayer(slot.layer)
        #else
        view.layer?.addSublayer(slot.layer)
        #endif
        let old = coordinator.current
        coordinator.current = slot
        slot.ready = slot.layer.observe(\.isReadyForDisplay, options: [.initial, .new]) { layer, _ in
            guard layer.isReadyForDisplay else { return }
            // Out, then in: the old clip fades to black before the new one fades up, like changing channel.
            DispatchQueue.main.async {
                CATransaction.begin()
                CATransaction.setAnimationDuration(0.45)
                old?.layer.opacity = 0
                CATransaction.commit()
                DispatchQueue.main.asyncAfter(deadline: .now() + (old == nil ? 0 : 0.45)) {
                    CATransaction.begin()
                    CATransaction.setAnimationDuration(0.55)
                    layer.opacity = 1
                    CATransaction.commit()
                    old?.player.pause()
                    old?.layer.removeFromSuperlayer()
                }
            }
        }
        // It comes on with the screen, like a TV, whether or not the radio is playing.
        slot.player.play()
    }

    #if os(iOS)
    func makeUIView(context: Context) -> LayerView { let view = LayerView(frame: .zero); show(url, in: view, context.coordinator); return view }
    func updateUIView(_ view: LayerView, context: Context) { show(url, in: view, context.coordinator) }
    static func dismantleUIView(_ view: LayerView, coordinator: Coordinator) { coordinator.current?.player.pause() }
    #else
    func makeNSView(context: Context) -> LayerView { let view = LayerView(frame: .zero); show(url, in: view, context.coordinator); return view }
    func updateNSView(_ view: LayerView, context: Context) { show(url, in: view, context.coordinator) }
    static func dismantleNSView(_ view: LayerView, coordinator: Coordinator) { coordinator.current?.player.pause() }
    #endif
}

// Which clip a station shows: it goes with the station and a 30-second slot (the
// same rule as the web), so tuning changes it once and it moves on calmly after.
func tvClip(_ station: Station, at date: Date) -> URL? {
    let clips = station.clips
    guard !clips.isEmpty else { return nil }
    let hash = station.id.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xffff_ffff }
    return clips[(Int(date.timeIntervalSince1970 / 30) + hash) % clips.count]
}

// The main menu's side panel: the station's HIFI TV clip under its name, or its cover.
struct SidePanel: View {
    let station: Station

    var body: some View {
        if station.clips.isEmpty {
            Cover(station: station)
        } else {
            GeometryReader { geo in
                let u = geo.size.width / 32
                ZStack(alignment: .bottom) {
                    Color.black
                    TimelineView(.periodic(from: .now, by: 5)) { context in
                        if let clip = tvClip(station, at: context.date) { LoopingVideo(url: clip) }
                    }
                    DotScreen()
                    LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                    VStack(spacing: 0.4 * u) {
                        Text(station.name)
                            .font(.system(size: 2.8 * u, weight: .heavy, design: .rounded))
                            .foregroundStyle(station.tint)
                        Text(station.genre)
                            .font(.system(size: 1.5 * u, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .lineLimit(1).minimumScaleFactor(0.3)
                    .shadow(color: .black.opacity(0.7), radius: 2, y: 1)
                    .frame(width: 28 * u)
                    .padding(.bottom, geo.size.height * 0.1)
                }
                .overlay(alignment: .topTrailing) {
                    Text("HIFI TV")
                        .font(.system(size: 1.6 * u, weight: .black).italic())
                        .foregroundStyle(.white)
                        .shadow(color: .black.opacity(0.6), radius: 2, y: 1)
                        .padding(1.2 * u)
                }
            }
            .clipped()
        }
    }
}

// The fine dot screen of an old set, over the clip.
struct DotScreen: View {
    var body: some View {
        Canvas { context, size in
            let step: CGFloat = 3
            var dots = Path()
            for y in stride(from: step / 2, to: size.height, by: step) {
                for x in stride(from: step / 2, to: size.width, by: step) {
                    dots.addEllipse(in: CGRect(x: x - 0.6, y: y - 0.6, width: 1.2, height: 1.2))
                }
            }
            // Darken around each dot: draw the grid's gaps.
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.black.opacity(0.22)))
            context.blendMode = .destinationOut
            context.fill(dots, with: .color(.black))
        }
        .compositingGroup()
        .allowsHitTesting(false)
    }
}

extension View {
    // Clear liquid glass where the system has it, so the clip shows through; a light
    // dark wash before that. The words carry their own shadow.
    @ViewBuilder func hifiGlass(radius: CGFloat) -> some View {
        #if os(iOS)
        glassEffect(.clear.tint(.black.opacity(0.06)), in: RoundedRectangle(cornerRadius: radius))
        #else
        if #available(macOS 26, *) {
            glassEffect(.clear.tint(.black.opacity(0.06)), in: RoundedRectangle(cornerRadius: radius))
        } else {
            background(Color.black.opacity(0.12), in: RoundedRectangle(cornerRadius: radius))
                .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(.white.opacity(0.2), lineWidth: 1))
        }
        #endif
    }
}

// A video station (101X Chillville): hifi.nates-software.com/video plays the
// rotation in YouTube's privacy-enhanced player and tells the radio what's on.
struct VideoStation: PlatformRepresentable {
    let station: Station
    @EnvironmentObject private var radio: Radio

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var radio: Radio?
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            Task { @MainActor [weak radio] in radio?.videoSaid(body) }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func make(_ coordinator: Coordinator) -> WKWebView {
        coordinator.radio = radio
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        #endif
        config.userContentController.add(coordinator, name: "hifi")
        let web = WKWebView(frame: .zero, configuration: config)
        #if os(iOS)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        #endif
        var url = Catalog.base.appending(path: "video")
        url.append(queryItems: [URLQueryItem(name: "station", value: station.id)])
        web.load(URLRequest(url: url))
        return web
    }

    private static func dismantle(_ web: WKWebView) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "hifi")
        web.loadHTMLString("", baseURL: nil)
    }

    #if os(iOS)
    func makeUIView(context: Context) -> WKWebView { make(context.coordinator) }
    func updateUIView(_ view: WKWebView, context: Context) {}
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) { dismantle(view) }
    #else
    func makeNSView(context: Context) -> WKWebView { make(context.coordinator) }
    func updateNSView(_ view: WKWebView, context: Context) {}
    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) { dismantle(view) }
    #endif
}
