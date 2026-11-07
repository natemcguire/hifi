import Foundation

// The Radio list's search. Ranked, forgiving type-ahead over everything the catalog knows about
// a station: its name first, then its tags (christmas, lofi, work…), genre, line and tagline.
// Every word typed has to land somewhere; a word lands by exact match, prefix, substring, a
// typo away, or as initials ("rp" finds Radio Paradise). Closer matches on weightier fields
// score higher, and ties keep the catalog's order.
enum StationSearch {
    static func rank(_ stations: [Station], query: String) -> [Station] {
        let words = tokens(query)
        guard !words.isEmpty else { return stations }
        let scored = stations.enumerated().compactMap { index, station -> (Int, Double, Station)? in
            guard let score = score(station, words: words, phrase: fold(query)) else { return nil }
            return (index, score, station)
        }
        return scored.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }.map(\.2)
    }

    // One indexed field: its words and how much a hit there is worth.
    private struct Field {
        let text: String
        let words: [String]
        let weight: Double
    }

    private static var cache: [String: [Field]] = [:]

    private static func fields(_ station: Station) -> [Field] {
        if let hit = cache[station.id] { return hit }
        func field(_ text: String, _ weight: Double) -> Field { Field(text: fold(text), words: tokens(text), weight: weight) }
        let made = [field(station.displayName, 3), field(station.name, 3),
                    field((station.tags ?? []).joined(separator: " "), 2.2),
                    field(station.genre, 1.8), field(station.subtitle ?? "", 1.4),
                    field(station.tagline, 1), field(station.providerLabel ?? "", 0.8)]
        cache[station.id] = made
        return made
    }

    private static func score(_ station: Station, words: [String], phrase: String) -> Double? {
        let fields = fields(station)
        var total = 0.0
        for word in words {
            var best = 0.0
            for field in fields {
                guard !field.words.isEmpty else { continue }
                best = max(best, match(word, in: field) * field.weight)
            }
            guard best > 0 else { return nil }  // a word that lands nowhere rules the station out
            total += best
        }
        // The whole thing typed, in order, at the start of the name: the strongest signal there is.
        let name = fields[0].text
        if name.hasPrefix(phrase) { total += 4 } else if name.contains(phrase) { total += 2 }
        return total
    }

    // How well one typed word fits one field, 0…1.
    private static func match(_ word: String, in field: Field) -> Double {
        if field.words.contains(word) { return 1 }
        if field.words.contains(where: { $0.hasPrefix(word) }) { return 0.85 }
        if field.text.hasPrefix(word) { return 0.8 }  // "lo f" across "lo-fi"
        if field.text.contains(word) { return 0.6 }
        // A word squeezed together ("lofi") against the field's words run together ("lo fi").
        if word.count >= 4, field.text.replacingOccurrences(of: " ", with: "").contains(word) { return 0.55 }
        // Initials: "rp" for Radio Paradise, "ipr" for Indie Pop Rocks.
        if word.count >= 2, word.count <= 4, String(field.words.compactMap(\.first)).hasPrefix(word) { return 0.5 }
        // A typo away: one edit for a short word, two for a long one, against each word and its prefixes.
        if word.count >= 4 {
            let allowed = word.count >= 7 ? 2 : 1
            for candidate in field.words where abs(candidate.count - word.count) <= allowed + 2 {
                let trimmed = candidate.count > word.count + allowed ? String(candidate.prefix(word.count + allowed)) : candidate
                if distance(word, trimmed, limit: allowed) <= allowed { return 0.45 }
                if candidate.count > word.count, distance(word, String(candidate.prefix(word.count)), limit: allowed) <= allowed { return 0.4 }
            }
        }
        return 0
    }

    // Damerau–Levenshtein distance, capped: anything past `limit` comes back as limit + 1.
    private static func distance(_ a: String, _ b: String, limit: Int) -> Int {
        let a = Array(a), b = Array(b)
        if abs(a.count - b.count) > limit { return limit + 1 }
        var previous2 = [Int](), previous = Array(0...b.count), current = [Int](repeating: 0, count: b.count + 1)
        for i in 1...max(1, a.count) where i <= a.count {
            current[0] = i
            var rowMin = i
            for j in 1...max(1, b.count) where j <= b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                var value = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
                if i > 1, j > 1, a[i - 1] == b[j - 2], a[i - 2] == b[j - 1] { value = min(value, previous2[j - 2] + 1) }
                current[j] = value
                rowMin = min(rowMin, value)
            }
            if rowMin > limit { return limit + 1 }
            previous2 = previous; previous = current
        }
        return b.isEmpty ? a.count : previous[b.count]
    }

    // Lowercase, accents off, punctuation out: "Lo-Fi Beats" → "lo fi beats", "Rockin'" → "rockin".
    static func fold(_ text: String) -> String {
        let plain = text.folding(options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive], locale: nil)
        var out = ""
        for scalar in plain.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) { out.unicodeScalars.append(scalar) }
            else if scalar == "'" || scalar == "’" { continue }  // rockin' → rockin
            else if out.last != " " { out.append(" ") }
        }
        return out.trimmingCharacters(in: .whitespaces)
    }

    static func tokens(_ text: String) -> [String] {
        fold(text).split(separator: " ").map(String.init)
    }
}
