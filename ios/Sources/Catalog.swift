import Foundation
import SwiftUI

// Mirrors ../stations.json, the same catalog the web player uses.
struct Catalog: Decodable {
    let epoch: Double  // ms since 1970; synth rotations are measured from here
    let stations: [Station]
    // Names for the `country` codes the world stations carry ("DE": "Germany").
    let countries: [String: String]?
    // Server-side switches (stations.json "features"); absent means off.
    let features: Features?

    // One list, the order the Radio menu shows: live stations, then Synth Sounds.
    var all: [Station] {
        stations.filter { $0.band != "synth" } + stations.filter { $0.band == "synth" }
    }

    // The Christmas look as the server has it. The app ORs this with the listener's own
    // "christmas" default (a long press on the title bar, or `-christmas 1` at launch).
    var christmas: Bool { features?.christmas ?? false }

    func countryName(_ code: String) -> String { countries?[code] ?? code }

    static let base = URL(string: "https://hifi.nates-software.com/")!

    static var bundled: Catalog {
        let url = Bundle.main.url(forResource: "stations", withExtension: "json")!
        return try! JSONDecoder().decode(Catalog.self, from: Data(contentsOf: url))
    }

    // The live catalog wins so new stations and tracks show up without a rebuild.
    static func fetchLive() async -> Catalog? {
        var request = URLRequest(url: base.appending(path: "stations.json"))
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let catalog = try? JSONDecoder().decode(Catalog.self, from: data),
              !catalog.stations.isEmpty else { return nil }
        return catalog
    }
}

struct Features: Decodable, Equatable {
    let christmas: Bool?
}

struct Station: Decodable, Identifiable, Equatable {
    let id: String
    let name: String
    let band: String
    let frequency: String
    let subtitle: String?  // a fixed line under the name in the list, instead of the song
    let line: String?      // shown under the name when no song is known ("Houston · Top 40")
    let country: String?   // a world station: the Radio list files it under its country's row
    let nowPlaying: String?  // the station's song feed; without one it is never asked what is on
    let tagline: String
    let genre: String
    let tags: [String]?    // what the station is about, for search (christmas, lofi, work…)
    let color: String
    let stream: String?
    let website: String?
    let providerLabel: String?
    let support: String?
    let tracks: [Track]?
    let tv: [String]?      // HIFI TV clips for Now Playing
    let label: String?     // a name with its own capitals, like "Y2K Chill-Out"

    var isLive: Bool { stream != nil }
    var hasSongFeed: Bool { isLive && nowPlaying != nil }
    var displayName: String { label ?? name.capitalized }
    var clips: [URL] { (tv ?? []).map { Catalog.base.appending(path: $0) } }
    var tint: Color { Color(hex: color) }
    var streamURL: URL? { stream.flatMap(URL.init(string:)) }
}

struct Track: Decodable, Equatable {
    let src: String
    let title: String
    let artist: String
    let duration: Double

    var url: URL { Catalog.base.appending(path: src) }
}

struct Rotation {
    let index: Int
    let track: Track
    let offset: Double
}

// Same math as engine/scheduler.js rotationAt: everyone hears the same moment.
func rotationAt(_ tracks: [Track], epoch: Double, now: Date = .now) -> Rotation {
    let total = tracks.reduce(0) { $0 + $1.duration }
    let elapsed = (now.timeIntervalSince1970 * 1000 - epoch) / 1000
    var position = (elapsed.truncatingRemainder(dividingBy: total) + total).truncatingRemainder(dividingBy: total)
    for (index, track) in tracks.enumerated() {
        if position < track.duration || index == tracks.count - 1 {
            return Rotation(index: index, track: track, offset: min(position, max(0, track.duration - 0.25)))
        }
        position -= track.duration
    }
    return Rotation(index: 0, track: tracks[0], offset: 0)
}
