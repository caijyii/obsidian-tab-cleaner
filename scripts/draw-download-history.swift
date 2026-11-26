// Render the README chart on macOS, using the same system fonts on each refresh.
import AppKit

struct History: Decodable {
    let id: String
    let repo: String
    let startDate: String
    let totals: [Int?]
}

func abortChart(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 3 else {
    abortChart("Usage: swift scripts/draw-download-history.swift history.json chart.png")
}

let historyURL = URL(fileURLWithPath: CommandLine.arguments[1])
let history = try JSONDecoder().decode(History.self, from: Data(contentsOf: historyURL))
let formatter = DateFormatter()
formatter.locale = Locale(identifier: "en_US_POSIX")
formatter.timeZone = TimeZone(secondsFromGMT: 0)
formatter.dateFormat = "yyyy-MM-dd"

guard history.id == "tab-cleaner", history.repo == "caijyii/obsidian-tab-cleaner",
      let start = formatter.date(from: history.startDate),
      history.totals.compactMap({ $0 }).allSatisfy({ $0 >= 0 }),
      let first = history.totals.firstIndex(where: { $0 != nil }),
      let last = history.totals.lastIndex(where: { $0 != nil }),
      let latest = history.totals[last], let peak = history.totals.compactMap({ $0 }).max() else {
    abortChart("Expected a dated download history for Tab Cleaner.")
}

func dayLabel(_ index: Int, _ format: String) -> String {
    formatter.dateFormat = format
    return formatter.string(from: start.addingTimeInterval(Double(index) * 86_400))
}

let width = 850, height = 292, scale = 2
guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width * scale,
        pixelsHigh: height * scale, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    abortChart("Could not create the chart canvas.")
}
NSGraphicsContext.current = context
context.cgContext.scaleBy(x: CGFloat(scale), y: CGFloat(scale))

func color(_ hex: Int) -> NSColor {
    NSColor(srgbRed: CGFloat(hex >> 16) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}

let ink = color(0x323038), muted = color(0x635f68), purple = color(0x7148bf)
let heading = "BradleyHandITCTT-Bold"
func label(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat, color: NSColor,
           face: String = "ChalkboardSE-Regular", alignRight: Bool = false) {
    let font = NSFont(name: face, size: size) ?? NSFont.systemFont(ofSize: size)
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
    let value = text as NSString
    let offset = alignRight ? value.size(withAttributes: attributes).width : 0
    value.draw(at: CGPoint(x: x - offset, y: y), withAttributes: attributes)
}

func stroke(_ points: [CGPoint], _ color: NSColor, _ width: CGFloat, dashed: Bool = false) {
    guard let start = points.first else { return }
    let path = NSBezierPath()
    path.move(to: start)
    for point in points.dropFirst() { path.line(to: point) }
    path.lineWidth = width
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    if dashed { path.setLineDash([2, 6], count: 2, phase: 0) }
    color.setStroke()
    path.stroke()
}

color(0xfffdf8).setFill()
CGRect(x: 0, y: 0, width: width, height: height).fill()
label("Tab Cleaner downloads", x: 28, y: 241, size: 33, color: ink, face: heading)

let maximum = CGFloat(max(peak, 1)) * 1.08
let magnitude = pow(10.0, floor(log10(maximum / 4)))
let step = max(1, ([1.0, 2, 5, 10].first { $0 * magnitude >= maximum / 4 } ?? 10) * magnitude)

func x(_ day: Int) -> CGFloat { 69 + CGFloat(day - first) * 650 / CGFloat(max(last - first, 1)) }
func y(_ count: CGFloat) -> CGFloat { 49 + count * 174 / maximum }

for tick in stride(from: 0.0, through: maximum, by: step) {
    if tick > 0 {
        stroke([CGPoint(x: 70, y: y(tick)), CGPoint(x: 724, y: y(tick))],
               color(0xdad6ce), 1, dashed: true)
    }
    let value = Double(tick).formatted(.number.notation(.compactName).locale(Locale(identifier: "en_US")))
    label(value, x: 59, y: y(tick) - 8, size: 14, color: muted, alignRight: true)
}

// A slightly uneven baseline gives the chart its hand-drawn look without shifting data points.
stroke([CGPoint(x: 69, y: 228), CGPoint(x: 68.4, y: 178), CGPoint(x: 69.4, y: 107),
        CGPoint(x: 69, y: 49), CGPoint(x: 198, y: 48.4), CGPoint(x: 393, y: 49.4),
        CGPoint(x: 607, y: 48.6), CGPoint(x: 728, y: 49)], ink, 1.8)

var previousLabelX = -CGFloat.infinity
var downloadPoints: [CGPoint] = []
for index in first...last {
    let position = x(index)
    if index == first || (dayLabel(index, "d") == "1" && position - previousLabelX >= 90) {
        let format = last - first > 365 ? "MMM yy" : "MMM d"
        label(dayLabel(index, format), x: position - 12, y: 24, size: 14, color: muted)
        previousLabelX = position
    }
    if let total = history.totals[index] {
        downloadPoints.append(CGPoint(x: position, y: y(CGFloat(total))))
    }
}
stroke(downloadPoints, purple, 3.3)

let endY = y(CGFloat(latest))
purple.setFill()
NSBezierPath(ovalIn: CGRect(x: x(last) - 4, y: endY - 4, width: 8, height: 8)).fill()
let number = latest.formatted(.number.locale(Locale(identifier: "en_US")))
label(number, x: x(last) + 13, y: endY - 9, size: number.count > 7 ? 20 : 27,
      color: purple, face: heading)
label(dayLabel(last, "MMM d, yyyy"), x: x(last) + 13, y: endY - 25, size: 12, color: muted)
label("Obsidian Community Plugins", x: 822, y: 4, size: 14, color: muted,
      face: heading, alignRight: true)

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    abortChart("Could not encode the chart as PNG.")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]), options: .atomic)
print("\(dayLabel(last, "yyyy-MM-dd")): \(latest) cumulative downloads")
