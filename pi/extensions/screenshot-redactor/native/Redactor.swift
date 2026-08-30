import AppKit
import CoreGraphics
import Darwin
import Foundation
import ImageIO

struct PixelRect: Codable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

enum RedactionStyle: String, Codable {
    case solid
    case pixelated
}

let defaultPixelBlockSize = 16
let pixelBlockSizeRange = 2...128

struct Request: Decodable {
    let action: String
    let source: String
    let path: String?
    let rectangles: [PixelRect]?
    let outputPath: String?
    let copyToClipboard: Bool?
    let overwrite: Bool?
    let style: RedactionStyle?
    let pixelBlockSize: Int?
    let maskColor: String?
    let temporaryDirectory: String?
}

struct Result: Encodable {
    let status: String
    let path: String?
    let width: Int?
    let height: Int?
    let rectangles: Int?
    let style: RedactionStyle?
    let pixelBlockSize: Int?
    let copiedToClipboard: Bool?
    let error: String?
}

struct Raster {
    let width: Int
    let height: Int
    var bytes: Data
}

enum RedactorError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }
}

func fail(_ message: String) throws -> Never {
    throw RedactorError.message(message)
}

func decodeRaster(_ data: Data, label: String) throws -> Raster {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary) else {
        try fail("Could not decode \(label) as a raster image. Use a valid PNG, JPEG, TIFF, GIF, HEIC, or other ImageIO-supported image.")
    }
    let width = image.width
    let height = image.height
    guard width > 0, height > 0, width <= Int.max / 4, height <= Int.max / (width * 4) else {
        try fail("The source image has invalid or unsupported dimensions.")
    }

    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    let bytesPerRow = width * 4
    var bytes = Data(count: bytesPerRow * height)
    let rendered = bytes.withUnsafeMutableBytes { raw -> Bool in
        guard let base = raw.baseAddress,
              let context = CGContext(data: base,
                                      width: width,
                                      height: height,
                                      bitsPerComponent: 8,
                                      bytesPerRow: bytesPerRow,
                                      space: colorSpace,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else {
            return false
        }
        context.interpolationQuality = .none
        // A bitmap context stores the decoded CGImage scanlines in the same top-to-bottom
        // order expected by rasterImage() and the public rectangle coordinates.
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard rendered else { try fail("Could not create an 8-bit sRGB image buffer.") }
    return Raster(width: width, height: height, bytes: bytes)
}

func rasterImage(_ raster: Raster) throws -> CGImage {
    guard let provider = CGDataProvider(data: raster.bytes as CFData),
          let image = CGImage(width: raster.width,
                              height: raster.height,
                              bitsPerComponent: 8,
                              bitsPerPixel: 32,
                              bytesPerRow: raster.width * 4,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
                              provider: provider,
                              decode: nil,
                              shouldInterpolate: false,
                              intent: .defaultIntent) else {
        try fail("Could not construct the output image.")
    }
    return image
}

func readRegularFile(_ path: String) throws -> Data {
    let descriptor = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC)
    guard descriptor >= 0 else {
        try fail("Could not open input image: \(String(cString: strerror(errno)))")
    }
    defer { close(descriptor) }

    var info = stat()
    guard fstat(descriptor, &info) == 0 else {
        try fail("Could not inspect input image: \(String(cString: strerror(errno)))")
    }
    guard (info.st_mode & S_IFMT) == S_IFREG else {
        try fail("Input image is not a regular file: \(path)")
    }

    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    while true {
        let count = buffer.withUnsafeMutableBytes { raw in
            Darwin.read(descriptor, raw.baseAddress, raw.count)
        }
        if count == 0 { break }
        if count < 0 {
            if errno == EINTR { continue }
            try fail("Could not read input image: \(String(cString: strerror(errno)))")
        }
        data.append(contentsOf: buffer.prefix(count))
    }
    return data
}

func acquire(_ request: Request) throws -> Raster {
    switch request.source {
    case "clipboard":
        let pasteboard = NSPasteboard.general
        let data = pasteboard.data(forType: .png) ?? pasteboard.data(forType: .tiff)
        guard let data else {
            try fail("The clipboard does not contain decodable PNG or TIFF image data. Copy a screenshot, then try again.")
        }
        return try decodeRaster(data, label: "clipboard image")

    case "file":
        guard let path = request.path, !path.isEmpty else { try fail("A file source requires an input path.") }
        return try decodeRaster(readRegularFile(path), label: "input file")

    case "screen":
        let ownsDirectory = request.temporaryDirectory == nil
        let directory: String
        if let supplied = request.temporaryDirectory {
            directory = supplied
        } else {
            directory = try FileManager.default.url(for: .itemReplacementDirectory,
                                                    in: .userDomainMask,
                                                    appropriateFor: FileManager.default.temporaryDirectory,
                                                    create: true).path
            chmod(directory, S_IRWXU)
        }
        defer {
            if ownsDirectory { try? FileManager.default.removeItem(atPath: directory) }
        }
        let capturePath = URL(fileURLWithPath: directory).appendingPathComponent("screen.png").path
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-x", "-t", "png", capturePath]
        let stderr = Pipe()
        process.standardError = stderr
        do { try process.run() } catch {
            try fail("Could not start macOS screen capture: \(error.localizedDescription)")
        }
        process.waitUntilExit()
        let diagnostic = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard process.terminationStatus == 0, FileManager.default.fileExists(atPath: capturePath) else {
            let detail = diagnostic.isEmpty ? "macOS returned no screenshot" : diagnostic
            try fail("Full-screen capture failed (\(detail)). Grant Screen Recording permission to the app running Pi in System Settings > Privacy & Security > Screen Recording, then retry.")
        }
        chmod(capturePath, S_IRUSR | S_IWUSR)
        defer { try? FileManager.default.removeItem(atPath: capturePath) }
        return try decodeRaster(Data(contentsOf: URL(fileURLWithPath: capturePath), options: .mappedIfSafe), label: "full-screen capture")

    default:
        try fail("Unsupported source '\(request.source)'. Use clipboard, file, or screen.")
    }
}

func parseColor(_ value: String?) throws -> (UInt8, UInt8, UInt8) {
    let text = value ?? "#000000"
    guard text.count == 7, text.first == "#", let number = UInt32(text.dropFirst(), radix: 16) else {
        try fail("maskColor must be an opaque RGB color in #RRGGBB form.")
    }
    return (UInt8((number >> 16) & 0xff), UInt8((number >> 8) & 0xff), UInt8(number & 0xff))
}

func validate(_ rectangles: [PixelRect], width: Int, height: Int) throws {
    guard !rectangles.isEmpty else { try fail("At least one redaction rectangle is required.") }
    for (index, rectangle) in rectangles.enumerated() {
        guard rectangle.x >= 0, rectangle.y >= 0, rectangle.width > 0, rectangle.height > 0,
              rectangle.x <= width, rectangle.y <= height,
              rectangle.width <= width - rectangle.x,
              rectangle.height <= height - rectangle.y else {
            try fail("Rectangle \(index + 1) is outside the \(width)x\(height) image. Rectangles use exact integer pixels with a top-left origin.")
        }
    }
}

func render(_ rectangles: [PixelRect], style: RedactionStyle, pixelBlockSize: Int,
            color: (UInt8, UInt8, UInt8), from source: Raster) -> Raster {
    var output = source
    source.bytes.withUnsafeBytes { sourceRaw in
        output.bytes.withUnsafeMutableBytes { outputRaw in
            guard let sourceBytes = sourceRaw.bindMemory(to: UInt8.self).baseAddress,
                  let outputBytes = outputRaw.bindMemory(to: UInt8.self).baseAddress else { return }
            for rectangle in rectangles {
                switch style {
                case .solid:
                    for y in rectangle.y..<(rectangle.y + rectangle.height) {
                        for x in rectangle.x..<(rectangle.x + rectangle.width) {
                            let offset = (y * source.width + x) * 4
                            outputBytes[offset] = color.0
                            outputBytes[offset + 1] = color.1
                            outputBytes[offset + 2] = color.2
                            outputBytes[offset + 3] = 255
                        }
                    }
                case .pixelated:
                    let maxX = rectangle.x + rectangle.width
                    let maxY = rectangle.y + rectangle.height
                    var blockY = rectangle.y
                    while blockY < maxY {
                        let blockEndY = min(blockY + pixelBlockSize, maxY)
                        var blockX = rectangle.x
                        while blockX < maxX {
                            let blockEndX = min(blockX + pixelBlockSize, maxX)
                            var red = 0
                            var green = 0
                            var blue = 0
                            var count = 0
                            for y in blockY..<blockEndY {
                                for x in blockX..<blockEndX {
                                    let offset = (y * source.width + x) * 4
                                    red += Int(sourceBytes[offset])
                                    green += Int(sourceBytes[offset + 1])
                                    blue += Int(sourceBytes[offset + 2])
                                    count += 1
                                }
                            }
                            let average = (UInt8(red / count), UInt8(green / count), UInt8(blue / count))
                            for y in blockY..<blockEndY {
                                for x in blockX..<blockEndX {
                                    let offset = (y * source.width + x) * 4
                                    outputBytes[offset] = average.0
                                    outputBytes[offset + 1] = average.1
                                    outputBytes[offset + 2] = average.2
                                    outputBytes[offset + 3] = 255
                                }
                            }
                            blockX = blockEndX
                        }
                        blockY = blockEndY
                    }
                }
            }
        }
    }
    return output
}

func encodePNG(_ raster: Raster) throws -> Data {
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, "public.png" as CFString, 1, nil) else {
        try fail("Could not initialize the PNG encoder.")
    }
    let properties: [CFString: Any] = [
        kCGImagePropertyPNGDictionary: [:],
        kCGImagePropertyProfileName: "sRGB IEC61966-2.1"
    ]
    CGImageDestinationAddImage(destination, try rasterImage(raster), properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { try fail("Could not encode the output PNG.") }
    return output as Data
}

func defaultOutputPath() -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyyMMdd-HHmmss"
    return FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Desktop")
        .appendingPathComponent("redacted-\(formatter.string(from: Date())).png").path
}

func writeExclusiveAtomic(_ data: Data, to path: String, overwrite: Bool) throws {
    let destination = URL(fileURLWithPath: path)
    let parent = destination.deletingLastPathComponent()
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: parent.path, isDirectory: &isDirectory), isDirectory.boolValue else {
        try fail("Output directory does not exist: \(parent.path)")
    }

    var destinationInfo = stat()
    if lstat(path, &destinationInfo) == 0 {
        let destinationType = destinationInfo.st_mode & S_IFMT
        if destinationType == S_IFLNK {
            try fail("Refusing to write through an output symlink: \(path)")
        }
        if destinationType != S_IFREG {
            try fail("Refusing to overwrite a non-regular destination: \(path)")
        }
        if !overwrite { try fail("Output already exists: \(path). Choose another path or explicitly enable overwrite.") }
    } else if errno != ENOENT {
        try fail("Could not inspect output path: \(String(cString: strerror(errno)))")
    }

    let temporary = parent.appendingPathComponent(".redacted-\(UUID().uuidString).tmp").path
    let descriptor = open(temporary, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { try fail("Could not securely create an output temporary file: \(String(cString: strerror(errno)))") }
    var keepTemporary = true
    defer {
        close(descriptor)
        if keepTemporary { unlink(temporary) }
    }

    do {
        try data.withUnsafeBytes { raw in
            var remaining = raw.count
            var cursor = raw.baseAddress!
            while remaining > 0 {
                let count = Darwin.write(descriptor, cursor, remaining)
                if count < 0 {
                    if errno == EINTR { continue }
                    try fail("Could not write output PNG: \(String(cString: strerror(errno)))")
                }
                remaining -= count
                cursor = cursor.advanced(by: count)
            }
        }
    } catch { throw error }
    guard fsync(descriptor) == 0 else { try fail("Could not flush output PNG: \(String(cString: strerror(errno)))") }

    let result: Int32
    if overwrite {
        result = rename(temporary, path)
    } else {
        result = renamex_np(temporary, path, UInt32(RENAME_EXCL))
    }
    guard result == 0 else {
        if errno == EEXIST { try fail("Output already exists: \(path). No file was overwritten.") }
        try fail("Could not install output PNG: \(String(cString: strerror(errno)))")
    }
    keepTemporary = false
}

final class CanvasView: NSView {
    let raster: Raster
    private var previewImage: NSImage
    let color: (UInt8, UInt8, UInt8)
    let pixelBlockSize: Int
    var style: RedactionStyle { didSet { rebuildPreview() } }
    var rectangles: [PixelRect] = [] { didSet { rebuildPreview() } }
    private var dragStart: NSPoint?
    private var dragCurrent: NSPoint?
    var onChange: (() -> Void)?

    init(frame: NSRect, raster: Raster, style: RedactionStyle, pixelBlockSize: Int,
         color: (UInt8, UInt8, UInt8)) throws {
        self.raster = raster
        self.style = style
        self.pixelBlockSize = pixelBlockSize
        self.color = color
        self.previewImage = NSImage(cgImage: try rasterImage(raster), size: NSSize(width: raster.width, height: raster.height))
        super.init(frame: frame)
    }

    private func rebuildPreview() {
        let preview = render(rectangles, style: style, pixelBlockSize: pixelBlockSize, color: color, from: raster)
        if let image = try? rasterImage(preview) {
            previewImage = NSImage(cgImage: image, size: NSSize(width: raster.width, height: raster.height))
        }
        needsDisplay = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var acceptsFirstResponder: Bool { true }

    private var imageRect: NSRect {
        let available = bounds.insetBy(dx: 12, dy: 12)
        let scale = min(available.width / CGFloat(raster.width), available.height / CGFloat(raster.height))
        let size = NSSize(width: CGFloat(raster.width) * scale, height: CGFloat(raster.height) * scale)
        return NSRect(x: available.midX - size.width / 2, y: available.midY - size.height / 2, width: size.width, height: size.height)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        bounds.fill()
        let target = imageRect
        previewImage.draw(in: target, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.none])
        if let start = dragStart, let current = dragCurrent {
            NSColor.black.withAlphaComponent(0.72).setFill()
            NSRect(x: min(start.x, current.x), y: min(start.y, current.y), width: abs(current.x - start.x), height: abs(current.y - start.y)).intersection(target).fill()
        }
    }

    private func clamped(_ point: NSPoint) -> NSPoint {
        let target = imageRect
        return NSPoint(x: min(max(point.x, target.minX), target.maxX), y: min(max(point.y, target.minY), target.maxY))
    }

    private func pixelRect(from start: NSPoint, to end: NSPoint) -> PixelRect? {
        let target = imageRect
        let a = clamped(start)
        let b = clamped(end)
        let left = min(a.x, b.x)
        let right = max(a.x, b.x)
        let bottom = min(a.y, b.y)
        let top = max(a.y, b.y)
        let x0 = max(0, min(raster.width, Int(floor((left - target.minX) * CGFloat(raster.width) / target.width))))
        let x1 = max(0, min(raster.width, Int(ceil((right - target.minX) * CGFloat(raster.width) / target.width))))
        let y0 = max(0, min(raster.height, Int(floor((target.maxY - top) * CGFloat(raster.height) / target.height))))
        let y1 = max(0, min(raster.height, Int(ceil((target.maxY - bottom) * CGFloat(raster.height) / target.height))))
        guard x1 > x0, y1 > y0 else { return nil }
        return PixelRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        guard imageRect.contains(point) else { return }
        dragStart = point
        dragCurrent = point
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard dragStart != nil else { return }
        dragCurrent = clamped(convert(event.locationInWindow, from: nil))
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        if let start = dragStart, let rectangle = pixelRect(from: start, to: convert(event.locationInWindow, from: nil)) {
            rectangles.append(rectangle)
            onChange?()
        }
        dragStart = nil
        dragCurrent = nil
        needsDisplay = true
    }

    override func keyDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers?.lowercased() == "z" {
            undo()
        } else if event.modifierFlags.contains(.command), event.keyCode == 51 {
            clear()
        } else {
            super.keyDown(with: event)
        }
    }

    func undo() {
        if !rectangles.isEmpty { rectangles.removeLast(); onChange?() }
    }

    func clear() {
        if !rectangles.isEmpty { rectangles.removeAll(); onChange?() }
    }
}

final class EditorController: NSObject, NSWindowDelegate {
    let window: NSWindow
    let canvas: CanvasView
    private let undoButton: NSButton
    private let clearButton: NSButton
    private let saveButton: NSButton
    private let styleSelector: NSSegmentedControl
    var saved = false

    init(raster: Raster, copyOnSave: Bool, style: RedactionStyle, pixelBlockSize: Int,
         color: (UInt8, UInt8, UInt8)) throws {
        let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let maximum = NSSize(width: min(1200, visible.width * 0.9), height: min(900, visible.height * 0.9))
        let scale = min(maximum.width / CGFloat(raster.width), (maximum.height - 92) / CGFloat(raster.height), 1.0)
        let size = NSSize(width: max(560, CGFloat(raster.width) * scale + 24), height: max(454, CGFloat(raster.height) * scale + 92))
        window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.title = copyOnSave
            ? "Redact Screenshot — saves to Desktop and copies to clipboard"
            : "Redact Screenshot — drag masks, then Save"
        window.minSize = NSSize(width: 520, height: 394)
        canvas = try CanvasView(frame: NSRect(x: 0, y: 86, width: size.width, height: size.height - 86),
                                raster: raster, style: style, pixelBlockSize: pixelBlockSize, color: color)
        undoButton = NSButton(title: "Undo", target: nil, action: nil)
        clearButton = NSButton(title: "Clear", target: nil, action: nil)
        saveButton = NSButton(title: copyOnSave ? "Save & Copy to Clipboard" : "Save", target: nil, action: nil)
        let solidStyleLabel = color.0 == 0 && color.1 == 0 && color.2 == 0 ? "Secure Black" : "Secure Solid"
        styleSelector = NSSegmentedControl(labels: [solidStyleLabel, "Pixelated (not secure)"],
                                           trackingMode: .selectOne, target: nil, action: nil)
        super.init()

        window.delegate = self
        let content = NSView(frame: NSRect(origin: .zero, size: size))
        content.autoresizingMask = [.width, .height]
        canvas.autoresizingMask = [.width, .height]
        content.addSubview(canvas)

        let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelAction))
        saveButton.target = self; saveButton.action = #selector(saveAction)
        saveButton.keyEquivalent = "\r"
        undoButton.target = self; undoButton.action = #selector(undoAction)
        clearButton.target = self; clearButton.action = #selector(clearAction)
        styleSelector.target = self; styleSelector.action = #selector(styleAction)
        styleSelector.selectedSegment = style == .solid ? 0 : 1
        for button in [undoButton, clearButton, cancel, saveButton, styleSelector] { content.addSubview(button) }
        undoButton.frame = NSRect(x: 14, y: 12, width: 76, height: 30)
        clearButton.frame = NSRect(x: 94, y: 12, width: 76, height: 30)
        styleSelector.frame = NSRect(x: 14, y: 48, width: 270, height: 26)
        cancel.frame = NSRect(x: size.width - 266, y: 12, width: 76, height: 30)
        saveButton.frame = NSRect(x: size.width - 184, y: 12, width: 170, height: 30)
        cancel.autoresizingMask = [.minXMargin]
        saveButton.autoresizingMask = [.minXMargin]
        canvas.onChange = { [weak self] in self?.updateButtons() }
        window.contentView = content
        updateButtons()
    }

    private func updateButtons() {
        undoButton.isEnabled = !canvas.rectangles.isEmpty
        clearButton.isEnabled = !canvas.rectangles.isEmpty
        saveButton.isEnabled = !canvas.rectangles.isEmpty
    }

    @objc private func undoAction() { canvas.undo() }
    @objc private func clearAction() { canvas.clear() }
    @objc private func styleAction() { canvas.style = styleSelector.selectedSegment == 0 ? .solid : .pixelated }
    @objc private func saveAction() { saved = true; finish() }
    @objc private func cancelAction() { saved = false; finish() }
    func windowWillClose(_ notification: Notification) { if window.isVisible { saved = false }; NSApp.stop(nil) }
    private func finish() { window.orderOut(nil); NSApp.stop(nil) }
}

struct EditorSelection {
    let rectangles: [PixelRect]
    let style: RedactionStyle
}

func editInteractively(_ raster: Raster, copyOnSave: Bool, style: RedactionStyle,
                       pixelBlockSize: Int, color: (UInt8, UInt8, UInt8)) throws -> EditorSelection? {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let controller = try EditorController(raster: raster, copyOnSave: copyOnSave, style: style,
                                          pixelBlockSize: pixelBlockSize, color: color)
    controller.window.center()
    controller.window.makeKeyAndOrderFront(nil)
    controller.window.makeFirstResponder(controller.canvas)
    app.activate(ignoringOtherApps: true)
    app.run()
    return controller.saved ? EditorSelection(rectangles: controller.canvas.rectangles, style: controller.canvas.style) : nil
}

func run(_ request: Request) throws -> Result {
    guard request.action == "interactive" || request.action == "apply" else {
        try fail("Unsupported action '\(request.action)'. Use interactive or apply.")
    }
    let initialStyle = request.style ?? .solid
    let pixelBlockSize = request.pixelBlockSize ?? defaultPixelBlockSize
    guard pixelBlockSizeRange.contains(pixelBlockSize) else {
        try fail("pixelBlockSize must be between \(pixelBlockSizeRange.lowerBound) and \(pixelBlockSizeRange.upperBound) source pixels.")
    }
    if initialStyle == .pixelated && request.maskColor != nil {
        try fail("maskColor applies only when style is solid.")
    }
    let color = try parseColor(request.maskColor)
    let source = try acquire(request)
    let rectangles: [PixelRect]
    let style: RedactionStyle
    if request.action == "interactive" {
        guard request.rectangles == nil else { try fail("Interactive mode does not accept rectangles; draw them in the native editor.") }
        guard let selected = try editInteractively(source, copyOnSave: request.copyToClipboard ?? true,
                                                   style: initialStyle, pixelBlockSize: pixelBlockSize, color: color) else {
            return Result(status: "cancelled", path: nil, width: source.width, height: source.height,
                          rectangles: nil, style: nil, pixelBlockSize: nil,
                          copiedToClipboard: false, error: nil)
        }
        rectangles = selected.rectangles
        style = selected.style
    } else {
        guard let supplied = request.rectangles else { try fail("Apply mode requires a non-empty rectangles array.") }
        rectangles = supplied
        style = initialStyle
    }
    if rectangles.isEmpty && request.action == "apply" { try fail("Apply mode requires at least one rectangle.") }
    if !rectangles.isEmpty { try validate(rectangles, width: source.width, height: source.height) }
    let raster = render(rectangles, style: style, pixelBlockSize: pixelBlockSize, color: color, from: source)
    let png = try encodePNG(raster)
    let outputPath = request.outputPath ?? defaultOutputPath()
    try writeExclusiveAtomic(png, to: outputPath, overwrite: request.overwrite ?? false)

    let copy = request.copyToClipboard ?? true
    if copy {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard pasteboard.setData(png, forType: .png) else {
            if style == .pixelated {
                try fail("Saved the pixelated PNG at \(outputPath), but macOS refused to copy it to the clipboard. Pixelated output is NOT SAFE FOR SECRETS.")
            }
            try fail("Saved the sanitized PNG at \(outputPath), but macOS refused to copy it to the clipboard. The solid-masked file is safe to share.")
        }
    }
    return Result(status: "saved", path: outputPath, width: raster.width, height: raster.height,
                  rectangles: rectangles.count, style: style,
                  pixelBlockSize: style == .pixelated ? pixelBlockSize : nil,
                  copiedToClipboard: copy, error: nil)
}

func emit(_ result: Result) {
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(result), let line = String(data: data, encoding: .utf8) {
        print(line)
    } else {
        print("{\"status\":\"error\",\"error\":\"Could not encode helper result.\"}")
    }
}

do {
    guard CommandLine.arguments.count == 2 else { try fail("Usage: Redactor <request.json>") }
    let requestURL = URL(fileURLWithPath: CommandLine.arguments[1])
    let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: requestURL))
    emit(try run(request))
} catch {
    emit(Result(status: "error", path: nil, width: nil, height: nil, rectangles: nil,
                style: nil, pixelBlockSize: nil, copiedToClipboard: nil, error: error.localizedDescription))
    exit(1)
}
