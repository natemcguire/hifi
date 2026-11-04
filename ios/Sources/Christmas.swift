import SwiftUI

// The Christmas look. On when the catalog says so (stations.json "features": {"christmas": true}),
// which the apps fetch live, so it switches on and off from the server without a build.
// The iPod itself is not restyled: these are layers laid over it, like a cut-out graphic. Lights
// across the top of the device, a tinsel garland wrapped round the screen bezel, a wreath on one
// corner, crossed candy canes on another, snow over everything. Everything here is drawn: no image
// assets. Nothing takes touches. With Reduce Motion on, the bulbs stay lit and the snow hangs still.

// A string of bulbs on a sagging wire across the top of the device.
struct ChristmasLights: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var height: CGFloat = 52

    private static let colors: [Color] = [Color(hex: "#ff3b30"), Color(hex: "#34c759"), Color(hex: "#ffd60a"),
                                          Color(hex: "#4aa8ff"), Color(hex: "#ff6fb5")]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.45)) { context in
            let phase = reduceMotion ? 0 : Int(context.date.timeIntervalSinceReferenceDate / 0.45)
            Canvas { canvas, size in
                let spacing: CGFloat = 66
                let count = max(2, Int(size.width / spacing))
                let step = size.width / CGFloat(count)
                let top: CGFloat = 5
                // The wire: a deep swag between every pair of bulbs.
                var wire = Path()
                wire.move(to: CGPoint(x: 0, y: top))
                for i in 0..<count {
                    let from = CGFloat(i) * step, to = from + step
                    wire.addQuadCurve(to: CGPoint(x: to, y: top), control: CGPoint(x: (from + to) / 2, y: top + 25))
                }
                canvas.stroke(wire, with: .color(Color(hex: "#1f5c2a")), style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                let ink = Color(hex: "#1a1a1a")
                for i in 0..<count {
                    let color = Self.colors[i % Self.colors.count]
                    let lit = reduceMotion || (phase + i) % 4 != 0
                    // Each bulb hangs from the swag, tilted a little, alternating sides.
                    var c = canvas
                    c.translateBy(x: CGFloat(i) * step + step / 2, y: top + 12)
                    c.rotate(by: .degrees(i % 2 == 0 ? -7 : 7))
                    let socket = Path(roundedRect: CGRect(x: -5, y: -2.5, width: 10, height: 8), cornerRadius: 2)
                    c.fill(socket, with: .color(Color(hex: "#3b4a3f")))
                    c.stroke(socket, with: .color(ink), lineWidth: 1.6)
                    let bulb = Path(ellipseIn: CGRect(x: -7.5, y: 5.5, width: 15, height: 25))
                    if lit {
                        var glow = c
                        glow.addFilter(.blur(radius: 6))
                        glow.fill(bulb, with: .color(color.opacity(0.9)))
                    }
                    c.fill(bulb, with: .color(lit ? color : color.opacity(0.45)))
                    c.stroke(bulb, with: .color(ink), lineWidth: 1.8)
                    // A highlight stroke so the glass reads as glass.
                    var shine = Path()
                    shine.move(to: CGPoint(x: -3.5, y: 10.5))
                    shine.addQuadCurve(to: CGPoint(x: -4.5, y: 19.5), control: CGPoint(x: -5.5, y: 14))
                    c.stroke(shine, with: .color(.white.opacity(lit ? 0.65 : 0.35)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                }
            }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// Tinsel: a metallic fringe wrapped round the screen bezel, strands standing across the screen
// edge (a few points in over the bezel, more out over the shell, shimmering slowly), with a garland
// of big outlined beads, silver and red, strung round it 14 pt off the screen.
struct ChristmasTinsel: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let cornerRadius: CGFloat
    var reach: CGFloat = 24  // how far the fringe stands off the screen

    private static let strands: [Color] = [Color(hex: "#E4E4E4"), .white, Color(hex: "#9C9C9C"), Color(hex: "#FFD166"),
                                           Color(hex: "#E4E4E4"), .white]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            let tick = reduceMotion ? 0 : Int(context.date.timeIntervalSinceReferenceDate / 0.5)
            Canvas { canvas, size in
                // The screen sits `reach` inside this canvas on every side.
                let rect = CGRect(x: reach, y: reach, width: size.width - reach * 2, height: size.height - reach * 2)
                let r = min(cornerRadius, min(rect.width, rect.height) / 2)
                let straight = 2 * (rect.width - 2 * r) + 2 * (rect.height - 2 * r)
                let perimeter = straight + 2 * .pi * r
                let count = Int(perimeter / 2.4)
                var shadow = canvas
                shadow.addFilter(.shadow(color: .black.opacity(0.35), radius: 2.5, y: 1.5))
                for i in 0..<count {
                    let along = CGFloat(i) * perimeter / CGFloat(count)
                    let (base, normal) = Self.point(on: rect, radius: r, at: along)
                    let r1 = Self.noise(i), r2 = Self.noise(i &+ 7919), r3 = Self.noise(i &+ 104729)
                    let angle = normal + (r2 - 0.5) * 0.9
                    let length = reach * (0.5 + r3 * 0.5)
                    // Strands start over the bezel (1 to 7 pt in), so the garland wraps the edge.
                    let inward = 1 + r1 * 6
                    let from = CGPoint(x: base.x - cos(normal) * inward, y: base.y - sin(normal) * inward)
                    let to = CGPoint(x: base.x + cos(angle) * length, y: base.y + sin(angle) * length)
                    var strand = Path()
                    strand.move(to: from)
                    strand.addLine(to: to)
                    let color = Self.strands[Int(r1 * CGFloat(Self.strands.count)) % Self.strands.count]
                    // Shimmer: brightness drifts strand by strand with the tick.
                    let shimmer = 0.78 + 0.22 * CGFloat((i &+ tick * 7) % 11) / 10
                    shadow.stroke(strand, with: .color(color.opacity(shimmer)), lineWidth: 2.2 + r3 * 1.4)
                    if (i + tick * 3) % 37 == 0 {
                        let spark = Path(ellipseIn: CGRect(x: to.x - 1.5, y: to.y - 1.5, width: 3, height: 3))
                        canvas.fill(spark, with: .color(.white))
                    }
                }
                // The beads: on a rounded rectangle 14 pt outside the screen, one every 32 pt.
                let beadRect = rect.insetBy(dx: -14, dy: -14)
                let beadR = r + 14
                let beadPerimeter = 2 * (beadRect.width - 2 * beadR) + 2 * (beadRect.height - 2 * beadR) + 2 * .pi * beadR
                let beads = max(4, Int(beadPerimeter / 32))
                for i in 0..<beads {
                    let (center, _) = Self.point(on: beadRect, radius: beadR, at: CGFloat(i) * beadPerimeter / CGFloat(beads))
                    let bead = Path(ellipseIn: CGRect(x: center.x - 9, y: center.y - 9, width: 18, height: 18))
                    shadow.fill(bead, with: .color(i % 2 == 0 ? Color(hex: "#E8ECF0") : Color(hex: "#E0262B")))
                    canvas.stroke(bead, with: .color(Color(hex: "#1a1a1a")), lineWidth: 2.4)
                    let glint = Path(ellipseIn: CGRect(x: center.x - 5, y: center.y - 5.5, width: 3.5, height: 3.5))
                    canvas.fill(glint, with: .color(.white.opacity(0.75)))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // Walks a rounded rectangle clockwise from the top edge's start; returns the point
    // and the outward normal angle.
    private static func point(on rect: CGRect, radius r: CGFloat, at distance: CGFloat) -> (CGPoint, CGFloat) {
        let w = rect.width - 2 * r, h = rect.height - 2 * r
        let arc = .pi / 2 * r
        var d = distance
        if d < w { return (CGPoint(x: rect.minX + r + d, y: rect.minY), -.pi / 2) }
        d -= w
        if d < arc { let a = -.pi / 2 + d / r; return (CGPoint(x: rect.maxX - r + cos(a) * r, y: rect.minY + r + sin(a) * r), a) }
        d -= arc
        if d < h { return (CGPoint(x: rect.maxX, y: rect.minY + r + d), 0) }
        d -= h
        if d < arc { let a = d / r; return (CGPoint(x: rect.maxX - r + cos(a) * r, y: rect.maxY - r + sin(a) * r), a) }
        d -= arc
        if d < w { return (CGPoint(x: rect.maxX - r - d, y: rect.maxY), .pi / 2) }
        d -= w
        if d < arc { let a = .pi / 2 + d / r; return (CGPoint(x: rect.minX + r + cos(a) * r, y: rect.maxY - r + sin(a) * r), a) }
        d -= arc
        if d < h { return (CGPoint(x: rect.minX, y: rect.maxY - r - d), .pi) }
        d -= h
        let a = .pi + max(0, d) / r
        return (CGPoint(x: rect.minX + r + cos(a) * r, y: rect.minY + r + sin(a) * r), a)
    }

    // A fixed pseudo-random 0..<1 per index, so nothing shuffles between frames.
    static func noise(_ i: Int) -> CGFloat {
        var x = UInt32(truncatingIfNeeded: i) &* 2654435761
        x ^= x >> 13; x = x &* 0x5bd1e995; x ^= x >> 15
        return CGFloat(x % 10000) / 10000
    }
}

// Soft snow over the device body, behind the screen and wheel.
struct Snowfall: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var flakes = 90

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 24, paused: reduceMotion)) { context in
            let t = reduceMotion ? 1000 : context.date.timeIntervalSinceReferenceDate
            Canvas { canvas, size in
                for i in 0..<flakes {
                    let a = ChristmasTinsel.noise(i), b = ChristmasTinsel.noise(i &+ 311), c = ChristmasTinsel.noise(i &+ 977)
                    let radius = 2 + c * 3  // 4 to 10 pt across
                    let speed = 16 + b * 24  // points per second: the big ones fall faster, like real snow
                    let y = (CGFloat(t) * speed + a * size.height * 3).truncatingRemainder(dividingBy: size.height + 20) - 10
                    let sway = sin(CGFloat(t) * (0.6 + b) + a * 6.28) * (6 + c * 10)
                    let x = (a * size.width + sway + size.width).truncatingRemainder(dividingBy: size.width)
                    let flake = Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
                    // A faint rim so the flakes show on the white shell as well as on the screen.
                    canvas.fill(flake, with: .color(.white.opacity(0.7 + ChristmasTinsel.noise(i &+ 1543) * 0.3)))
                    canvas.stroke(flake, with: .color(Color(hex: "#28415a").opacity(0.45)), lineWidth: 1.2)
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// A fir wreath round the click wheel: a dark ring of greenery with lighter needles laid over
// it and outlined needles bristling from both edges, berries, and a bow at the bottom. Drawn in a
// 144-unit box with the ring at radius 55 (the wheel's rim is 50), so it scales with the wheel. The labels sit well
// inside the rim, so the ring leaves them clear; touches pass through.
struct WheelWreath: View {
    let diameter: CGFloat

    var body: some View {
        Canvas { canvas, size in
            let s = size.width / 144
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let ink = Color(hex: "#1a1a1a"), dark = Color(hex: "#2a7a3b"), mid = Color(hex: "#2e8b3f"), light = Color(hex: "#43a853")
            let R = 55.0, B = 11.0  // the band sits just outside the wheel's rim, so the labels at 0.68 R stay clear
            func h(_ i: Int, _ k: Int) -> Double { Double(ChristmasTinsel.noise(i * 7 + k * 131)) }
            func at(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: c.x + x * s, y: c.y + y * s) }
            func ring(_ r: Double) -> Path { Path(ellipseIn: CGRect(x: c.x - r * s, y: c.y - r * s, width: 2 * r * s, height: 2 * r * s)) }
            func needle(_ a: Double, from rho: Double, tilt: Double, length: Double, outward: Bool, into path: inout Path) {
                let base = at(cos(a) * rho, sin(a) * rho)
                let dir = a + tilt, reach = outward ? length : -length
                path.move(to: base)
                path.addLine(to: at(cos(a) * rho + cos(dir) * reach, sin(a) * rho + sin(dir) * reach))
            }
            // The ring of greenery, inked on both edges.
            canvas.stroke(ring(R), with: .color(dark), lineWidth: B * s)
            canvas.stroke(ring(R - B / 2), with: .color(ink), lineWidth: 1.6 * s)
            canvas.stroke(ring(R + B / 2), with: .color(ink), lineWidth: 1.6 * s)
            // Needles bristling from the outer and inner edges: ink under green, so the silhouette is spiky.
            var spikes = Path()
            for i in 0..<96 {
                let a = Double(i) / 96 * 2 * .pi + (h(i, 6) - 0.5) * 0.05, out = i % 2 == 0
                needle(a, from: R + (out ? B / 2 - 1.5 : -B / 2 + 1.5), tilt: (h(i, 8) - 0.5) * 1.1, length: out ? 3.5 + h(i, 7) * 4 : 2.5 + h(i, 7) * 3, outward: out, into: &spikes)
            }
            canvas.stroke(spikes, with: .color(ink), style: StrokeStyle(lineWidth: 4.4 * s, lineCap: .round))
            canvas.stroke(spikes, with: .color(light), style: StrokeStyle(lineWidth: 2.2 * s, lineCap: .round))
            // Needles across the band, in two greens.
            var n1 = Path(), n2 = Path()
            for i in 0..<170 {
                let a = Double(i) / 170 * 2 * .pi + (h(i, 1) - 0.5) * 0.06
                let rho = R + (h(i, 2) - 0.5) * B * 0.85
                let tilt = (h(i, 3) - 0.5) * 1.3, length = B * (0.4 + h(i, 5) * 0.35), outward = h(i, 4) > 0.5
                if i % 3 == 0 { needle(a, from: rho, tilt: tilt, length: length, outward: outward, into: &n2) }
                else { needle(a, from: rho, tilt: tilt, length: length, outward: outward, into: &n1) }
            }
            canvas.stroke(n1, with: .color(light), style: StrokeStyle(lineWidth: 2.2 * s, lineCap: .round))
            canvas.stroke(n2, with: .color(mid), style: StrokeStyle(lineWidth: 2.2 * s, lineCap: .round))
            // Berries.
            for i in 0..<13 {
                let a = (Double(i) + 0.5) / 13 * 2 * .pi, reach = R * (0.95 + h(i + 40, 9) * 0.13)
                let p = at(cos(a) * reach, sin(a) * reach), r = 2.5 * s
                let berry = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r))
                canvas.fill(berry, with: .color(Color(hex: "#e5343a")))
                canvas.stroke(berry, with: .color(ink), lineWidth: 0.9 * s)
                canvas.fill(Path(ellipseIn: CGRect(x: p.x - 1.5 * s, y: p.y - 1.5 * s, width: 1.4 * s, height: 1.4 * s)), with: .color(.white.opacity(0.75)))
            }
            // The bow, at the bottom (the garland would cover it at the top on a phone).
            for (dx, rot) in [(-6.0, -0.31), (6.0, 0.31)] {
                let loop = Path(ellipseIn: CGRect(x: -7 * s, y: -4.3 * s, width: 14 * s, height: 8.6 * s))
                    .applying(CGAffineTransform(translationX: c.x + dx * s, y: c.y + R * s).rotated(by: rot))
                canvas.fill(loop, with: .color(Color(hex: "#d7262f")))
                canvas.stroke(loop, with: .color(ink), lineWidth: 1.1 * s)
            }
            let knot = Path(ellipseIn: CGRect(x: c.x - 2.8 * s, y: c.y + R * s - 2.8 * s, width: 5.6 * s, height: 5.6 * s))
            canvas.fill(knot, with: .color(Color(hex: "#b51f27")))
            canvas.stroke(knot, with: .color(ink), lineWidth: 1.1 * s)
        }
        .frame(width: diameter * 1.44, height: diameter * 1.44)
        .shadow(color: .black.opacity(0.3), radius: 2, y: 1.5)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// Two candy canes crossed on a corner of the screen bezel: inked outline, white cane, red bands.
struct CandyCanes: View {
    let size: CGFloat

    var body: some View {
        Canvas { canvas, size in
            let s = size.width / 64
            func cane(rotation: CGFloat, shift: CGPoint) {
                var c = canvas
                c.translateBy(x: 32 * s + shift.x, y: 40 * s + shift.y)
                c.rotate(by: .radians(rotation))
                c.translateBy(x: -32 * s, y: -40 * s)
                var path = Path()
                path.move(to: CGPoint(x: 22 * s, y: 58 * s))
                path.addLine(to: CGPoint(x: 22 * s, y: 20 * s))
                path.addArc(center: CGPoint(x: 31 * s, y: 20 * s), radius: 9 * s, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
                path.addLine(to: CGPoint(x: 40 * s, y: 26 * s))
                var shadow = c
                shadow.addFilter(.shadow(color: .black.opacity(0.35), radius: 2, y: 1.5))
                shadow.stroke(path, with: .color(Color(hex: "#1a1a1a")), style: StrokeStyle(lineWidth: 10.4 * s, lineCap: .round))
                c.stroke(path, with: .color(.white), style: StrokeStyle(lineWidth: 7 * s, lineCap: .round))
                c.stroke(path, with: .color(Color(hex: "#E0262B")), style: StrokeStyle(lineWidth: 7 * s, lineCap: .butt, dash: [4.5 * s, 5.5 * s]))
            }
            cane(rotation: -0.38, shift: .zero)
            cane(rotation: 0.42, shift: CGPoint(x: -2 * s, y: 2 * s))
        }
        .frame(width: size, height: size)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
