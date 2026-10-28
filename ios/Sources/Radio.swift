import AVFoundation
import MediaPlayer

struct VideoSong: Equatable {
    let title: String
    let artist: String
}

struct LiveSong: Decodable, Equatable {
    let artist: String?
    let title: String?
    let spotify: String?
    let trackId: String?
    let poll: Double?
}

// One AVQueuePlayer for every station. Live stations play their stream; synth
// stations queue tracks from the wall-clock rotation, like the web receiver.
@MainActor
final class Radio: ObservableObject {
    @Published private(set) var catalog: Catalog = .bundled
    @Published private(set) var station: Station
    @Published private(set) var isPlaying = false
    @Published private(set) var isBuffering = false
    @Published private(set) var track: Track?
    @Published private(set) var liveSong: LiveSong?
    @Published private(set) var problem: String?
    @Published private(set) var videoSong: VideoSong?
    @Published var volume: Float = UserDefaults.standard.object(forKey: "volume") as? Float ?? 1 {
        didSet { player.volume = volume; UserDefaults.standard.set(volume, forKey: "volume") }
    }

    // Seconds into the current synth track (0 for live streams).
    var elapsed: Double {
        let seconds = player.currentTime().seconds
        return station.isLive || !seconds.isFinite ? 0 : max(0, seconds)
    }

    private let player = AVQueuePlayer()
    private var queued: [ObjectIdentifier: Track] = [:]
    private var nextIndex = 0
    private var pollTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var observers: [NSObjectProtocol] = []
    private var keyValueObservers: [NSKeyValueObservation] = []

    init() {
        let catalog = Catalog.bundled
        let saved = UserDefaults.standard.string(forKey: "station")
        station = catalog.all.first { $0.id == saved } ?? catalog.stations[0]
        player.automaticallyWaitsToMinimizeStalling = true
        player.volume = volume
        observePlayer()
        configureRemoteCommands()
        updateNowPlaying()
        Task { await refreshCatalog() }
    }

    var stations: [Station] { catalog.all }

    func refreshCatalog() async {
        guard let live = await Catalog.fetchLive() else { return }
        catalog = live
        if let fresh = live.all.first(where: { $0.id == station.id }) { station = fresh }
    }

    // MARK: Controls

    func tune(_ next: Station) {
        station = next
        UserDefaults.standard.set(next.id, forKey: "station")
        liveSong = nil
        start()
    }

    func toggle() { isPlaying ? stop() : start() }

    // Next/previous change station, through every station in catalog order and
    // round again, like the dial on a radio.
    func skip(_ delta: Int) {
        let index = stations.firstIndex { $0.id == station.id } ?? 0
        tune(stations[(index + delta + stations.count) % stations.count])
    }

    // Radio semantics: play always rejoins the broadcast now; there is no pause point.
    func start() {
        // A video station plays on the screen (VideoStation); the radio just keeps its state.
        if station.isVideo {
            retryTask?.cancel()
            pollTask?.cancel()
            player.pause()
            player.removeAllItems()
            queued.removeAll()
            track = nil
            videoSong = nil
            problem = nil
            #if os(iOS)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)  // WebKit plays it
            #endif
            isPlaying = true
            isBuffering = true
            updateNowPlaying()
            return
        }
        if !station.isLive, let tracks = station.tracks, !tracks.isEmpty {
            let now = rotationAt(tracks, epoch: catalog.epoch)
            play(from: now.index, offset: now.offset)
        } else {
            play(from: 0, offset: 0)
        }
    }

    private func play(from index: Int, offset: Double) {
        retryTask?.cancel()
        problem = nil
        activateSession()
        player.removeAllItems()
        queued.removeAll()
        track = nil
        if let url = station.streamURL {
            player.insert(AVPlayerItem(url: url), after: nil)
            pollLiveSong()
        } else if let tracks = station.tracks, !tracks.isEmpty {
            pollTask?.cancel()
            let first = enqueue(tracks[index])
            if offset > 0 { first.seek(to: CMTime(seconds: offset, preferredTimescale: 600), completionHandler: nil) }
            nextIndex = (index + 1) % tracks.count
            enqueueNext()
            track = tracks[index]
        }
        player.play()
        isPlaying = true
        isBuffering = true
        updateNowPlaying()
    }

    // What the video station's page says it's playing.
    func videoSaid(_ message: [String: Any]) {
        guard station.isVideo, isPlaying else { return }
        if let title = message["title"] as? String {
            videoSong = VideoSong(title: title, artist: message["artist"] as? String ?? "")
            updateNowPlaying()
        }
        if message["playing"] as? Bool == true { isBuffering = false }
        if let text = message["problem"] as? String { problem = text }
    }

    func stop() {
        retryTask?.cancel()
        pollTask?.cancel()
        player.pause()
        player.removeAllItems()
        queued.removeAll()
        isPlaying = false
        isBuffering = false
        updateNowPlaying()
    }

    // MARK: Queue

    @discardableResult
    private func enqueue(_ track: Track) -> AVPlayerItem {
        let item = AVPlayerItem(url: track.url)
        queued[ObjectIdentifier(item)] = track
        player.insert(item, after: nil)
        return item
    }

    private func enqueueNext() {
        guard let tracks = station.tracks, !tracks.isEmpty else { return }
        enqueue(tracks[nextIndex % tracks.count])
        nextIndex = (nextIndex + 1) % tracks.count
    }

    private func currentItemChanged() {
        guard isPlaying, !station.isLive else { return }
        if let item = player.currentItem, let current = queued[ObjectIdentifier(item)] {
            track = current
            if player.items().count < 2 { enqueueNext() }
            updateNowPlaying()
        } else if player.items().isEmpty {
            start()  // queue ran dry (e.g. a failed item); rejoin the rotation
        }
    }

    private func failed() {
        guard isPlaying else { return }
        problem = station.isLive ? "Lost the signal. Retuning…" : "Track didn't load. Retuning…"
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, !Task.isCancelled, self.isPlaying else { return }
            self.start()
        }
    }

    // MARK: Live song titles

    // What every live station is playing right now, for the Radio menu.
    @Published private(set) var songs: [String: LiveSong] = [:]

    func refreshSongs() async {
        let live = stations.filter(\.isLive).map(\.id)
        await withTaskGroup(of: (String, LiveSong?).self) { group in
            for id in live { group.addTask { (id, await Self.fetchSong(id)) } }
            for await (id, song) in group { if let song { songs[id] = song } }
        }
    }

    nonisolated private static func fetchSong(_ id: String) async -> LiveSong? {
        var components = URLComponents(url: Catalog.base.appending(path: "api/now-playing"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "station", value: id)]
        guard let (data, _) = try? await URLSession.shared.data(from: components.url!) else { return nil }
        return try? JSONDecoder().decode(LiveSong.self, from: data)
    }

    private func pollLiveSong() {
        pollTask?.cancel()
        let id = station.id
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                var wait = 20.0
                if let song = await Self.fetchSong(id) {
                    guard let self, self.station.id == id else { return }
                    self.songs[id] = song
                    if song != self.liveSong { self.liveSong = song; self.updateNowPlaying() }
                    wait = max(10, song.poll ?? 20)
                }
                try? await Task.sleep(for: .seconds(wait))
            }
        }
    }

    // MARK: Player observation

    private func observePlayer() {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.failed() }
        })
        observers.append(center.addObserver(forName: AVPlayerItem.playbackStalledNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in if self?.station.isLive == true { self?.failed() } }
        })
        #if os(iOS)
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init)
            let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            Task { @MainActor in
                guard let self else { return }
                // A video station's sound is the web view's; its starting isn't an interruption.
                if type == .began, self.station.isVideo { return }
                if type == .began { self.wasInterrupted = self.isPlaying; self.stop() }
                else if type == .ended, self.wasInterrupted, options.contains(.shouldResume) { self.start() }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init)
            Task { @MainActor in if reason == .oldDeviceUnavailable { self?.stop() } }  // headphones out: go quiet
        })
        #endif
        keyValueObservers.append(player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.currentItemChanged() }
        })
        keyValueObservers.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let status = player.timeControlStatus
            Task { @MainActor in
                guard let self, !self.station.isVideo else { return }
                self.isBuffering = self.isPlaying && status != .playing
                if status == .playing { self.problem = nil; self.updateNowPlaying() }
            }
        })
        keyValueObservers.append(player.observe(\.currentItem?.status, options: [.new]) { [weak self] player, _ in
            let failedItem = player.currentItem?.status == .failed
            Task { @MainActor in if failedItem { self?.failed() } }
        })
    }

    private var wasInterrupted = false

    private func activateSession() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, policy: .longFormAudio)
        try? session.setActive(true)
        #endif
    }

    // MARK: Lock screen and Control Center

    private func configureRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { [weak self] _ in self?.start(); return .success }
        commands.pauseCommand.addTarget { [weak self] _ in self?.stop(); return .success }
        commands.stopCommand.addTarget { [weak self] _ in self?.stop(); return .success }
        commands.togglePlayPauseCommand.addTarget { [weak self] _ in self?.toggle(); return .success }
        commands.nextTrackCommand.addTarget { [weak self] _ in self?.skip(1); return .success }
        commands.previousTrackCommand.addTarget { [weak self] _ in self?.skip(-1); return .success }
        commands.changePlaybackPositionCommand.isEnabled = false
        commands.skipForwardCommand.isEnabled = false
        commands.skipBackwardCommand.isEnabled = false
    }

    var displayTitle: String {
        if station.isVideo { return videoSong?.title ?? station.displayName }
        if station.isLive { return liveSong?.title ?? station.name }
        return track?.title ?? station.name
    }

    // The Spotify track for the live song, when the station names one. Synth
    // stations play our own music, which isn't on Spotify.
    var heartable: Bool { station.isLive && liveSong?.title?.isEmpty == false }
    var spotifyTrackId: String? { station.isLive ? liveSong?.trackId : nil }

    var displayArtist: String {
        if station.isVideo { return videoSong?.artist ?? station.genre }
        if station.isLive { return liveSong?.artist ?? station.genre }
        return track?.artist ?? station.genre
    }

    private func updateNowPlaying() {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: displayTitle,
            MPMediaItemPropertyArtist: displayArtist,
            MPMediaItemPropertyAlbumTitle: "\(station.name) · HIFI",
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyIsLiveStream: station.isLive,
        ]
        if !station.isLive, let track {
            info[MPMediaItemPropertyPlaybackDuration] = track.duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = max(0, player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0)
        }
        let band = stations.filter { $0.band == station.band }
        let position = "\((band.firstIndex(of: station) ?? 0) + 1) of \(band.count)"
        let art = Artwork.screen(station: station, title: displayTitle, artist: displayArtist, position: position)
        info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: art.size) { _ in art }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .stopped
    }
}
