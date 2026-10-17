import SwiftUI
#if os(iOS)
import AVKit
import Combine

// Picture in Picture as a little iPod shuffle. iOS only offers PiP for video,
// so the shuffle is drawn with SwiftUI and fed to a sample-buffer video layer a
// few frames a second. Going home while HIFI plays shrinks it into the corner.
@MainActor
final class ShufflePlayer: NSObject, ObservableObject {
    static let shared = ShufflePlayer()

    @Published private(set) var isActive = false
    @AppStorage("shuffleAuto") var automatic = true {
        didSet { controller?.canStartPictureInPictureAutomaticallyFromInline = automatic }
    }

    let view = SampleBufferView()
    private var controller: AVPictureInPictureController?
    private weak var radio: Radio?
    private var watch: AnyCancellable?
    private var ticker: Timer?
    private var blink = false

    var isSupported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }

    func attach(_ radio: Radio) {
        guard self.radio == nil, isSupported else { return }
        self.radio = radio
        let source = AVPictureInPictureController.ContentSource(sampleBufferDisplayLayer: view.displayLayer, playbackDelegate: self)
        let controller = AVPictureInPictureController(contentSource: source)
        controller.delegate = self
        controller.canStartPictureInPictureAutomaticallyFromInline = automatic
        controller.requiresLinearPlayback = false
        self.controller = controller
        watch = radio.objectWillChange.sink { [weak self] _ in
            Task { @MainActor in self?.render(); self?.controller?.invalidatePlaybackState() }
        }
        // The status light blinks while playing, like the real thing.
        ticker = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isActive else { return }
                self.blink.toggle()
                self.render()
            }
        }
        render()
    }

    func toggle() {
        guard let controller else { return }
        if controller.isPictureInPictureActive { controller.stopPictureInPicture() }
        else {
            if radio?.isPlaying == false { radio?.start() }
            controller.startPictureInPicture()
        }
    }

    private func render() {
        guard let radio else { return }
        let shuffle = ShuffleView(station: radio.station, title: radio.displayTitle, artist: radio.displayArtist,
                                  playing: radio.isPlaying, buffering: radio.isBuffering, light: !radio.isPlaying || blink)
            .frame(width: 360, height: 360)
        let renderer = ImageRenderer(content: shuffle)
        renderer.scale = 2
        guard let image = renderer.cgImage, let buffer = SampleBufferView.sampleBuffer(from: image) else { return }
        view.enqueue(buffer)
    }
}

extension ShufflePlayer: AVPictureInPictureControllerDelegate {
    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in self.isActive = true }
    }
    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        Task { @MainActor in self.isActive = false }
    }
}

extension ShufflePlayer: AVPictureInPictureSampleBufferPlaybackDelegate {
    nonisolated func pictureInPictureController(_ controller: AVPictureInPictureController, setPlaying playing: Bool) {
        Task { @MainActor in
            guard let radio = self.radio else { return }
            if playing { radio.start() } else { radio.stop() }
        }
    }
    // Radio is always "now": an endless live range, so PiP shows no scrubber.
    nonisolated func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange {
        CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
    }
    nonisolated func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool {
        MainActor.assumeIsolated { !(self.radio?.isPlaying ?? false) }
    }
    nonisolated func pictureInPictureController(_ controller: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}
    // PiP's skip buttons move between songs, like the shuffle's ⏮ ⏭.
    nonisolated func pictureInPictureController(_ controller: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completion completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            self.radio?.skip(skipInterval.seconds < 0 ? -1 : 1)
            completionHandler()
        }
    }
}

// A UIView whose backing layer is the video layer PiP borrows.
final class SampleBufferView: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
    var displayLayer: AVSampleBufferDisplayLayer { layer as! AVSampleBufferDisplayLayer }

    func enqueue(_ buffer: CMSampleBuffer) {
        let renderer = displayLayer.sampleBufferRenderer
        if renderer.status == .failed { renderer.flush() }
        renderer.enqueue(buffer)
    }

    static func sampleBuffer(from image: CGImage) -> CMSampleBuffer? {
        let width = image.width, height = image.height
        let attributes = [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true,
                          kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary
        var pixels: CVPixelBuffer?
        guard CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA, attributes, &pixels) == kCVReturnSuccess,
              let pixels else { return nil }
        CVPixelBufferLockBaseAddress(pixels, [])
        let context = CGContext(data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        context?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        CVPixelBufferUnlockBaseAddress(pixels, [])
        var format: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: pixels, formatDescriptionOut: &format)
        guard let format else { return nil }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var buffer: CMSampleBuffer?
        CMSampleBufferCreateReadyWithImageBuffer(allocator: nil, imageBuffer: pixels, formatDescription: format,
                                                 sampleTiming: &timing, sampleBufferOut: &buffer)
        if let buffer, let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: true),
           CFArrayGetCount(attachments) > 0 {
            let dictionary = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dictionary, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
                                 Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        return buffer
    }
}

// Sits behind the iPod so PiP has a layer in the window to start from.
struct ShuffleHost: UIViewRepresentable {
    let radio: Radio
    func makeUIView(context: Context) -> SampleBufferView {
        ShufflePlayer.shared.attach(radio)
        return ShufflePlayer.shared.view
    }
    func updateUIView(_ uiView: SampleBufferView, context: Context) {}
}
#endif

// The 2nd-generation iPod shuffle: an anodized clip in the station's color with
// the round control pad, its status light, and the song engraved underneath.
struct ShuffleView: View {
    let station: Station
    let title: String
    let artist: String
    let playing: Bool
    let buffering: Bool
    let light: Bool

    var body: some View {
        GeometryReader { geo in
            let s = geo.size.width
            ZStack {
                LinearGradient(colors: [Color(hex: "#2a2d31"), Color(hex: "#111315")], startPoint: .top, endPoint: .bottom)
                VStack(spacing: s * 0.035) {
                    ZStack(alignment: .topTrailing) {
                        RoundedRectangle(cornerRadius: s * 0.07)
                            .fill(LinearGradient(colors: [station.tint.opacity(0.95), station.tint, station.tint.opacity(0.7)],
                                                 startPoint: .topLeading, endPoint: .bottomTrailing))
                            .overlay(RoundedRectangle(cornerRadius: s * 0.07)
                                .fill(LinearGradient(colors: [.white.opacity(0.35), .clear, .black.opacity(0.18)],
                                                     startPoint: .top, endPoint: .bottom)))
                            .overlay(RoundedRectangle(cornerRadius: s * 0.07).stroke(.white.opacity(0.4), lineWidth: s * 0.006))
                            .shadow(color: .black.opacity(0.5), radius: s * 0.03, y: s * 0.015)
                        Circle()
                            .fill(buffering ? Color.orange : light && playing ? Color(hex: "#7dff6a") : light ? Color(hex: "#ffb347") : Color(hex: "#2b3a2b"))
                            .frame(width: s * 0.03, height: s * 0.03)
                            .shadow(color: light ? (buffering ? .orange : Color(hex: "#7dff6a")) : .clear, radius: s * 0.015)
                            .padding(s * 0.045)
                        pad(s)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .frame(width: s * 0.66, height: s * 0.66)
                    VStack(spacing: s * 0.008) {
                        Text(title).font(.system(size: s * 0.05, weight: .bold)).foregroundStyle(.white)
                        Text(artist).font(.system(size: s * 0.038, weight: .medium)).foregroundStyle(.white.opacity(0.6))
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.horizontal, s * 0.06)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    // The ring: + on top, - below, previous and next at the sides, play/pause in the middle.
    private func pad(_ s: CGFloat) -> some View {
        let ring = s * 0.46
        let ink = Color(hex: "#8d9196")
        return ZStack {
            Circle()
                .fill(LinearGradient(colors: [Color(hex: "#fbfbfb"), Color(hex: "#dedfe2")], startPoint: .top, endPoint: .bottom))
                .overlay(Circle().stroke(Color(hex: "#b9bcc1"), lineWidth: s * 0.004))
                .shadow(color: .black.opacity(0.25), radius: s * 0.012, y: s * 0.006)
            Circle()
                .fill(LinearGradient(colors: [Color(hex: "#f0f1f3"), Color(hex: "#d2d4d8")], startPoint: .top, endPoint: .bottom))
                .frame(width: ring * 0.42, height: ring * 0.42)
                .overlay(Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: ring * 0.11, weight: .bold)).foregroundStyle(ink))
            Image(systemName: "plus").font(.system(size: ring * 0.12, weight: .heavy)).foregroundStyle(ink).offset(y: -ring * 0.37)
            Image(systemName: "minus").font(.system(size: ring * 0.12, weight: .heavy)).foregroundStyle(ink).offset(y: ring * 0.37)
            Image(systemName: "backward.end.alt.fill").font(.system(size: ring * 0.1)).foregroundStyle(ink).offset(x: -ring * 0.36)
            Image(systemName: "forward.end.alt.fill").font(.system(size: ring * 0.1)).foregroundStyle(ink).offset(x: ring * 0.36)
        }
        .frame(width: ring, height: ring)
    }
}
