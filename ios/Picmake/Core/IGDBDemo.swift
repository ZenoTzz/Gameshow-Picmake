#if DEBUG
import Foundation

/// An opt-in local fixture. Its URLProtocol handles every request, including unknown paths.
enum IGDBDemo {
    static var enabled: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.contains("--demo") && arguments.contains("--igdb-demo")
    }

    static func makeAPI() -> CloudAPI {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IGDBDemoProtocol.self]
        return CloudAPI(baseURL: URL(string: "https://picmake.test")!, configuration: configuration, persistSession: false)
    }
}

private final class IGDBDemoProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let (status, value) = Self.response(for: url.path, body: Self.body(of: request))
        do {
            let data = try JSONEncoder().encode(value)
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func response(for path: String, body: JSONValue) -> (Int, JSONValue) {
        switch path {
        case "/api/session":
            return (200, .object(["authenticated": .bool(true), "username": .string("本地演示"), "csrfToken": .string("local-fixture-only")]))
        case "/api/projects": return (200, .object(["projects": .array([])]))
        case "/api/templates": return (200, .object(["templates": .array([])]))
        case "/api/logout": return (200, .object(["ok": .bool(true)]))
        case "/api/igdb/status": return (200, .object(["configured": .bool(true)]))
        case "/api/igdb/search":
            return (200, .object(["query": .string("Mario"), "games": .array([.object([
                "id": .number(42), "name": .string("Super Mario Demo"),
                "alternativeNames": .array([.string("马力欧 · 本地演示")]), "year": .number(2026),
                "platforms": .array([.string("Nintendo Switch 2")]),
                "cover": .object(["imageId": .string("local_cover"), "thumbnailUrl": .string("https://example.invalid/local-cover.png")])
            ])])]))
        case "/api/igdb/games/42/images":
            return (200, .object([
                "game": .object(["id": .number(42), "name": .string("Super Mario Demo"), "url": .string("https://example.invalid/game")]),
                "images": .array([image(id: "local_screenshot", kind: "screenshot"), image(id: "local_cover", kind: "cover")])
            ]))
        case "/api/igdb/import":
            let imageID = body["imageId"].string ?? ""
            let kind = body["kind"].string ?? ""
            guard body["gameId"].number == 42,
                  (imageID == "local_screenshot" && kind == "screenshot") || (imageID == "local_cover" && kind == "cover") else {
                return (400, .object(["error": .string("请选择本地演示图库中的图片。")]))
            }
            return (200, .object([
                "dataUrl": .string("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGN4xiAERww4OQDsxwuh1jhlQwAAAABJRU5ErkJggg=="),
                "source": .object(["provider": .string("igdb"), "gameId": .number(42),
                                   "gameName": .string("Super Mario Demo"), "imageId": .string(imageID),
                                   "kind": .string(kind), "url": .string("https://example.invalid/game")])
            ]))
        default:
            return (403, .object(["error": .string("这是本地搜图演示，此操作未连接任何服务器。")]))
        }
    }

    private static func body(of request: URLRequest) -> JSONValue {
        var bytes = request.httpBody ?? Data()
        if bytes.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 1024)
            while bytes.count < 8192 {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                bytes.append(buffer, count: count)
            }
        }
        return (try? JSONDecoder().decode(JSONValue.self, from: bytes)) ?? .null
    }

    private static func image(id: String, kind: String) -> JSONValue {
        // The production CDN allowlist rejects these addresses, so AsyncImage stays offline.
        .object(["id": .string(id), "kind": .string(kind), "width": .number(4), "height": .number(3),
                 "thumbnailUrl": .string("https://example.invalid/\(id).png"), "previewUrl": .string("https://example.invalid/\(id).png")])
    }
}
#endif
