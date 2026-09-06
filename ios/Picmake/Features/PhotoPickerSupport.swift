import Foundation
import ImageIO
import UniformTypeIdentifiers

enum CardPhotoSupport {
    enum PhotoError: LocalizedError {
        case unavailable, tooLarge, invalidImage, unsupportedURL

        var errorDescription: String? {
            switch self {
            case .unavailable: "无法读取这张照片，请重新选择。"
            case .tooLarge: "图片超过 50 MB，请选择较小的图片。"
            case .invalidImage: "无法处理这张图片，请尝试另一张照片。"
            case .unsupportedURL: "这张图片的地址无法读取，请重新选择图片。"
            }
        }
    }

    // Decode directly to a thumbnail instead of allocating the full-resolution photo.
    nonisolated static func jpegDataURL(from data: Data) throws -> String {
        guard data.count <= 50 * 1024 * 1024 else { throw PhotoError.tooLarge }
        try Task.checkCancellation()
        guard let source = CGImageSourceCreateWithData(data as CFData, [
            kCGImageSourceShouldCache: false,
        ] as CFDictionary), let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 2400,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary) else { throw PhotoError.invalidImage }

        // JPEG has no alpha channel; flatten transparent artwork onto white.
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: thumbnail.width, height: thumbnail.height,
                                      bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
            throw PhotoError.invalidImage
        }
        let bounds = CGRect(x: 0, y: 0, width: thumbnail.width, height: thumbnail.height)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(bounds)
        context.draw(thumbnail, in: bounds)
        guard let flattened = context.makeImage() else { throw PhotoError.invalidImage }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw PhotoError.invalidImage
        }
        CGImageDestinationAddImage(destination, flattened, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw PhotoError.invalidImage }
        try Task.checkCancellation()
        return "data:image/jpeg;base64," + (output as Data).base64EncodedString()
    }

    nonisolated static func imageData(for source: String) async throws -> Data {
        if source.hasPrefix("data:image/"), let separator = source.firstIndex(of: ","),
           source[..<separator].hasSuffix(";base64"),
           let data = Data(base64Encoded: String(source[source.index(after: separator)...])) {
            return data
        }
        guard let url = URL(string: source), url.scheme?.lowercased() == "https" else {
            throw PhotoError.unsupportedURL
        }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw PhotoError.unavailable
        }
        guard data.count <= 50 * 1024 * 1024 else { throw PhotoError.tooLarge }
        return data
    }

    nonisolated static func previewImage(from data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 1000,
            kCGImageSourceCreateThumbnailWithTransform: true,
        ] as CFDictionary)
    }
}
