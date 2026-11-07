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
        controller.requiresLinearPlayback = true  // no skip buttons: the shuffle is for seeing the song and coming back
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
            .frame(width: 480, height: 300)
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
    // PiP's skip buttons change station, like the shuffle's ⏮ ⏭.
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

// The 2nd-generation iPod shuffle in white, filling the whole picture so it floats on the
// home screen as an object, not a window: brushed aluminium, the round control pad on the
// left, the status light, and the song engraved on the body to its right.
struct ShuffleView: View {
    let station: Station
    let title: String
    let artist: String
    let playing: Bool
    let buffering: Bool
    let light: Bool

    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height, w = geo.size.width
            ZStack {
                // The body: white anodized aluminium with a soft brushed sheen and a bevel at the top edge.
                LinearGradient(colors: [Color(hex: "#ffffff"), Color(hex: "#f1f2f4"), Color(hex: "#e2e4e7")], startPoint: .top, endPoint: .bottom)
                LinearGradient(stops: [.init(color: .white.opacity(0.7), location: 0), .init(color: .clear, location: 0.12),
                                       .init(color: .clear, location: 0.85), .init(color: .black.opacity(0.08), location: 1)],
                               startPoint: .top, endPoint: .bottom)
                // A faint brushed grain across the metal.
                Canvas { context, size in
                    for i in stride(from: 0, to: Int(size.height), by: 3) {
                        let y = CGFloat(i)
                        context.stroke(Path { $0.move(to: CGPoint(x: 0, y: y)); $0.addLine(to: CGPoint(x: size.width, y: y)) },
                                       with: .color(.black.opacity(i % 2 == 0 ? 0.018 : 0.008)), lineWidth: 1)
                    }
                }
                HStack(spacing: h * 0.08) {
                    pad(h * 0.78)
                        .padding(.leading, h * 0.11)
                    VStack(alignment: .leading, spacing: h * 0.03) {
                        HStack(spacing: h * 0.03) {
                            Circle()
                                .fill(buffering ? Color.orange : light && playing ? Color(hex: "#52d04a") : light ? Color(hex: "#ffb347") : Color(hex: "#c9ccd0"))
                                .frame(width: h * 0.04, height: h * 0.04)
                                .shadow(color: light ? (buffering ? .orange : Color(hex: "#52d04a")).opacity(0.8) : .clear, radius: h * 0.02)
                            Text(station.displayName.uppercased())
                                .font(.system(size: h * 0.055, weight: .semibold))
                                .tracking(h * 0.008)
                                .foregroundStyle(Color(hex: "#9ea3a9"))
                        }
                        // Engraved: dark ink with a hairline of light beneath, like lettering cut into the metal.
                        Text(title)
                            .font(.system(size: h * 0.115, weight: .bold))
                            .foregroundStyle(Color(hex: "#3a3f45"))
                            .shadow(color: .white.opacity(0.9), radius: 0, y: 1)
                            .lineLimit(2)
                        Text(artist)
                            .font(.system(size: h * 0.08, weight: .medium))
                            .foregroundStyle(Color(hex: "#7a8087"))
                            .shadow(color: .white.opacity(0.9), radius: 0, y: 1)
                            .lineLimit(1)
                    }
                    .minimumScaleFactor(0.55)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.trailing, h * 0.1)
                }
                .frame(width: w, height: h)
            }
        }
        .aspectRatio(1.6, contentMode: .fit)
    }

    // The control pad, engraved not lit: a dished ring with its marks and the plain button in the middle.
    private func pad(_ ring: CGFloat) -> some View {
        let ink = Color(hex: "#b4b8bd")
        return ZStack {
            Circle()
                .fill(LinearGradient(colors: [Color(hex: "#e6e8eb"), Color(hex: "#fafafb")], startPoint: .top, endPoint: .bottom))
                .overlay(Circle().stroke(Color(hex: "#cfd2d6"), lineWidth: ring * 0.008))
                .shadow(color: .white, radius: ring * 0.02, y: -ring * 0.01)
                .shadow(color: .black.opacity(0.1), radius: ring * 0.02, y: ring * 0.012)
            Circle()
                .fill(LinearGradient(colors: [Color(hex: "#fdfdfd"), Color(hex: "#e9ebee")], startPoint: .top, endPoint: .bottom))
                .frame(width: ring * 0.4, height: ring * 0.4)
                .overlay(Circle().stroke(Color(hex: "#d5d8dc"), lineWidth: ring * 0.006))
                .shadow(color: .black.opacity(0.12), radius: ring * 0.015, y: ring * 0.008)
            Image(systemName: "plus").font(.system(size: ring * 0.11, weight: .heavy)).foregroundStyle(ink).offset(y: -ring * 0.36)
            Image(systemName: "minus").font(.system(size: ring * 0.11, weight: .heavy)).foregroundStyle(ink).offset(y: ring * 0.36)
            Image(systemName: "backward.end.alt.fill").font(.system(size: ring * 0.09)).foregroundStyle(ink).offset(x: -ring * 0.35)
            Image(systemName: "forward.end.alt.fill").font(.system(size: ring * 0.09)).foregroundStyle(ink).offset(x: ring * 0.35)
        }
        .frame(width: ring, height: ring)
    }
}
