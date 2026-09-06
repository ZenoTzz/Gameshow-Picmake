import Foundation

struct IGDBGame: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let alternativeNames: [String]
    let year: Int?
    let platforms: [String]
    let cover: IGDBCover?

    var detail: String {
        ([year.map(String.init)] + [platforms.isEmpty ? nil : platforms.joined(separator: " / ")])
            .compactMap { $0 }.joined(separator: " · ")
    }
}

struct IGDBCover: Decodable, Hashable, Sendable {
    let imageId: String
    let thumbnailUrl: String
}

enum IGDBImageKind: String, Codable, CaseIterable, Sendable {
    case screenshot, artwork, cover
    var label: String {
        switch self { case .screenshot: "截图"; case .artwork: "宣传图"; case .cover: "封面" }
    }
    var priority: Int {
        switch self { case .screenshot: 0; case .artwork: 1; case .cover: 2 }
    }
}

struct IGDBImage: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let kind: IGDBImageKind
    let width: Int?
    let height: Int?
    let thumbnailUrl: String
    let previewUrl: String
    var identity: String { "\(kind.rawValue):\(id)" }
}

struct IGDBGallery: Decodable, Sendable {
    struct Game: Decodable, Sendable { let id: Int; let name: String; let url: String? }
    let game: Game
    let images: [IGDBImage]
}

struct IGDBImportResult: Decodable, Sendable {
    let dataUrl: String
    let source: IGDBImageSource
}

struct IGDBImageSource: Codable, Equatable, Sendable {
    let provider: String
    let gameId: Int
    let gameName: String
    let imageId: String
    let kind: IGDBImageKind
    let url: String

    var jsonValue: JSONValue {
        .object(["provider": .string(provider), "gameId": .number(Double(gameId)),
                 "gameName": .string(gameName), "imageId": .string(imageId),
                 "kind": .string(kind.rawValue), "url": .string(url)])
    }
}

enum IGDBSupport {
    static func cdnURL(_ value: String) -> URL? {
        guard let components = URLComponents(string: value), components.scheme == "https",
              components.host == "images.igdb.com", components.port == nil,
              components.user == nil, components.password == nil else { return nil }
        return components.url
    }

    static func query(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
    static func validQuery(_ value: String) -> Bool { (2...120).contains(query(value).count) }
    static func validImageID(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9_]{1,128}$", options: .regularExpression) != nil
    }
}
