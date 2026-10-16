import AppKit

// App icons: a mini iPod click wheel on a white body. Drawn at 1024px.
// `Icon.swift out.png` is the square iOS icon (iOS masks it).
// `Icon.swift out.png --mac` adds the rounded tile and margin macOS expects.
let mac = CommandLine.arguments.contains("--mac")
let size = 1024.0
let tile = mac ? CGRect(x: 100, y: 100, width: 824, height: 824) : CGRect(x: 0, y: 0, width: size, height: size)
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4,
                              hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let cg = NSGraphicsContext.current!.cgContext
let space = CGColorSpaceCreateDeviceRGB()

func rgb(_ hex: Int, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: alpha)
}
func linear(_ colors: [CGColor], in path: CGPath, from top: CGFloat, to bottom: CGFloat) {
    cg.saveGState()
    cg.addPath(path); cg.clip()
    let gradient = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: nil)!
    cg.drawLinearGradient(gradient, start: CGPoint(x: 0, y: top), end: CGPoint(x: 0, y: bottom), options: [])
    cg.restoreGState()
}
func circle(_ center: CGPoint, _ radius: CGFloat) -> CGPath {
    CGPath(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2), transform: nil)
}

// Body: brushed white plastic, a little cooler at the bottom.
let body = mac ? CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil) : CGPath(rect: tile, transform: nil)
if mac {
    cg.saveGState()
    cg.setShadow(offset: CGSize(width: 0, height: -10), blur: 28, color: rgb(0x000000, 0.35))
    cg.addPath(body); cg.setFillColor(rgb(0xf4f4f6)); cg.fillPath()
    cg.restoreGState()
}
linear([rgb(0xffffff), rgb(0xf1f1f3), rgb(0xdcdde1)], in: body, from: tile.maxY, to: tile.minY)

let center = CGPoint(x: tile.midX, y: tile.midY)
let wheel = tile.width * 0.39
let hub = wheel * 0.38

// Wheel: soft drop shadow, then a satin gray dish.
cg.saveGState()
cg.setShadow(offset: CGSize(width: 0, height: -tile.width * 0.012), blur: tile.width * 0.035, color: rgb(0x000000, 0.22))
cg.addPath(circle(center, wheel)); cg.setFillColor(rgb(0xe2e3e6)); cg.fillPath()
cg.restoreGState()
linear([rgb(0xd3d4d8), rgb(0xe9eaed), rgb(0xf6f6f8)], in: circle(center, wheel), from: center.y + wheel, to: center.y - wheel)

// Wheel rim.
cg.addPath(circle(center, wheel - 1.5)); cg.setStrokeColor(rgb(0xbfc0c5)); cg.setLineWidth(3); cg.strokePath()

// Labels: MENU, previous, next, play/pause, in iPod gray.
let ink = rgb(0x9a9ca3)
cg.setFillColor(ink)
let label = wheel * 0.69, glyph = wheel * 0.085
let menu = NSAttributedString(string: "MENU", attributes: [
    .font: NSFont.systemFont(ofSize: wheel * 0.115, weight: .heavy), .foregroundColor: NSColor(cgColor: ink)!, .kern: wheel * 0.012,
])
let menuSize = menu.size()
menu.draw(at: CGPoint(x: center.x - menuSize.width / 2, y: center.y + label - menuSize.height / 2))
func triangle(tip: CGPoint, pointingRight: Bool) {
    let back = tip.x + (pointingRight ? -glyph * 1.1 : glyph * 1.1)
    cg.move(to: tip); cg.addLine(to: CGPoint(x: back, y: tip.y + glyph * 0.62)); cg.addLine(to: CGPoint(x: back, y: tip.y - glyph * 0.62))
    cg.closePath(); cg.fillPath()
}
func bar(x: CGFloat, y: CGFloat) { cg.fill(CGRect(x: x, y: y - glyph * 0.62, width: glyph * 0.26, height: glyph * 1.24)) }
// Next: ▶▶|
let right = CGPoint(x: center.x + label, y: center.y)
triangle(tip: CGPoint(x: right.x, y: right.y), pointingRight: true)
triangle(tip: CGPoint(x: right.x + glyph * 1.0, y: right.y), pointingRight: true)
bar(x: right.x + glyph * 1.02, y: right.y)
// Previous: |◀◀
let left = CGPoint(x: center.x - label, y: center.y)
triangle(tip: CGPoint(x: left.x, y: left.y), pointingRight: false)
triangle(tip: CGPoint(x: left.x - glyph * 1.0, y: left.y), pointingRight: false)
bar(x: left.x - glyph * 1.28, y: left.y)
// Play/pause: ▶❚❚
let bottom = CGPoint(x: center.x, y: center.y - label)
triangle(tip: CGPoint(x: bottom.x - glyph * 0.05, y: bottom.y), pointingRight: true)
bar(x: bottom.x + glyph * 0.2, y: bottom.y)
bar(x: bottom.x + glyph * 0.6, y: bottom.y)

// Center button: raised white, lit from above.
cg.saveGState()
cg.setShadow(offset: CGSize(width: 0, height: -tile.width * 0.006), blur: tile.width * 0.016, color: rgb(0x000000, 0.25))
cg.addPath(circle(center, hub)); cg.setFillColor(rgb(0xf2f2f4)); cg.fillPath()
cg.restoreGState()
linear([rgb(0xffffff), rgb(0xf3f3f5), rgb(0xdedfe3)], in: circle(center, hub), from: center.y + hub, to: center.y - hub)
cg.addPath(circle(center, hub - 1.5)); cg.setStrokeColor(rgb(0xc9cace)); cg.setLineWidth(3); cg.strokePath()

NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(filePath: CommandLine.arguments[1]))
