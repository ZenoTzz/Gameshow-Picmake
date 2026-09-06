import XCTest
@testable import Picmake

final class IGDBTests: XCTestCase {
    func testSearchEncodesChinesePlusAndReservedCharactersAsOneQueryValue() async throws {
        let query = "塞尔达 C++ & Mario / #2?"
        let game: JSONValue = .object([
            "id": .number(42), "name": .string("The Legend of Zelda"),
            "alternativeNames": .array([.string("塞尔达传说")]), "year": .number(2023),
            "platforms": .array([.string("Nintendo Switch")]), "cover": .null
        ])
        let (api, server) = makeAPI([.json(["games": .array([game]), "query": .string(query)])])
        let games = try await api.igdbSearch(query: "  \(query)  ")
        let request = try XCTUnwrap(server.requests.first)
        let components = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/api/igdb/search")
        XCTAssertEqual(components.queryItems, [URLQueryItem(name: "q", value: query)])
        XCTAssertNil(components.fragment)
        XCTAssertTrue(components.percentEncodedQuery?.contains("%2B%2B") == true)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://igdb.picmake.test")
        XCTAssertEqual(games.first?.alternativeNames, ["塞尔达传说"])
        XCTAssertEqual(games.first?.year, 2023)
        XCTAssertEqual(games.first?.detail, "2023 · Nintendo Switch")
    }

    func testStatusAndNullableGameMetadataDecode() async throws {
        let (api, _) = makeAPI([
            .json(["configured": .bool(false)]),
            .json(["games": .array([.object([
                "id": .number(1), "name": .string("Untitled"), "alternativeNames": .array([]),
                "year": .null, "platforms": .array([]), "cover": .null
            ])])])
        ])
        let configured = try await api.igdbConfigured()
        XCTAssertFalse(configured)
        let games = try await api.igdbSearch(query: "Untitled")
        XCTAssertNil(games.first?.year)
        XCTAssertNil(games.first?.cover)
        XCTAssertEqual(games.first?.detail, "")
    }

    func testGalleryParsesImageKindsDimensionsAndCDNAddresses() async throws {
        let (api, server) = makeAPI([.json([
            "game": .object(["id": .number(42), "name": .string("Game"), "url": .string("https://www.igdb.com/games/game")]),
            "images": .array([imageJSON(id: "sc123", kind: "screenshot"), imageJSON(id: "ar123", kind: "artwork"), imageJSON(id: "co123", kind: "cover")])
        ])])
        let gallery = try await api.igdbImages(gameID: 42)
        XCTAssertEqual(server.requests.first?.url?.path, "/api/igdb/games/42/images")
        XCTAssertEqual(gallery.game.id, 42)
        XCTAssertEqual(gallery.images.map(\.kind), [.screenshot, .artwork, .cover])
        XCTAssertEqual(gallery.images.first?.width, 1920)
        XCTAssertNotNil(gallery.images.first.flatMap { IGDBSupport.cdnURL($0.thumbnailUrl) })
    }

    func testImportCarriesSessionAndCSRFAndPreservesProvenance() async throws {
        let token = String(repeating: "a", count: 64)
        let (api, server) = makeAPI([
            .json(["authenticated": .bool(true), "csrfToken": .string("csrf-igdb")],
                  headers: ["Set-Cookie": "picmake_session=\(token); Path=/; Secure; HttpOnly; SameSite=Strict"]),
            importResponse()
        ])
        _ = try await api.login(username: "test", password: "mock-only")
        let result = try await api.igdbImport(gameID: 42, image: image())
        let request = try XCTUnwrap(server.requests.last)
        XCTAssertEqual(request.url?.path, "/api/igdb/import")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "picmake_session=\(token)")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-CSRF-Token"), "csrf-igdb")
        let body = try JSONDecoder().decode(JSONValue.self, from: try XCTUnwrap(request.httpBody))
        XCTAssertEqual(body, .object(["gameId": .number(42), "imageId": .string("sc123"), "kind": .string("screenshot")]))

        var card = GameCard()
        card.title = "我的标题"
        card.platforms = ["Switch 2"]
        card.image = result.dataUrl
        card.raw["imageSource"] = result.source.jsonValue
        let packed = try AssetCodec.pack(.object(card.raw))
        let roundtrip = try AssetCodec.unpack(packed.project, assets: packed.assets)
        XCTAssertEqual(roundtrip["imageSource"]["gameId"], .number(42))
        XCTAssertEqual(roundtrip["imageSource"]["kind"], .string("screenshot"))
        XCTAssertEqual(roundtrip["title"], .string("我的标题"))
        XCTAssertEqual(roundtrip["platforms"], .array([.string("Switch 2")]))
    }

    func testQuerySurvivesCSRFRefreshWithoutChangingExistingSessionPath() async throws {
        let (api, server) = makeAPI([
            .json(["error": .string("会话校验失败，请刷新重试")], status: 403),
            .json(["authenticated": .bool(true), "csrfToken": .string("fresh")]),
            .json(["games": .array([])])
        ])
        _ = try await api.igdbSearch(query: "C++ 中文")
        XCTAssertEqual(server.requests.map { $0.url?.path }, ["/api/igdb/search", "/api/session", "/api/igdb/search"])
        XCTAssertEqual(server.requests.first?.url, server.requests.last?.url)
        XCTAssertNil(server.requests[1].url?.query)
    }

    func testInvalidQueryOrImageIDDoesNotMakeNetworkRequests() async throws {
        let (api, server) = makeAPI([])
        for query in [" ", "a", String(repeating: "x", count: 121)] {
            do { _ = try await api.igdbSearch(query: query); XCTFail("Should reject invalid query") }
            catch let error as CloudError { XCTAssertEqual(error.status, 0) }
        }
        do { _ = try await api.igdbImages(gameID: -1); XCTFail("Should reject game ID") }
        catch let error as CloudError { XCTAssertEqual(error.status, 0) }
        let invalid = IGDBImage(id: "../secret", kind: .screenshot, width: nil, height: nil, thumbnailUrl: "", previewUrl: "")
        do { _ = try await api.igdbImport(gameID: 42, image: invalid); XCTFail("Should reject image ID") }
        catch let error as CloudError { XCTAssertEqual(error.status, 0) }
        XCTAssertTrue(server.requests.isEmpty)
    }

    func testImportRejectsMismatchedSourceAndInvalidBase64() async throws {
        for response in [importResponse(gameID: 99), importResponse(dataURL: "data:image/jpeg;base64,**invalid**")] {
            let (api, _) = makeAPI([response])
            do { _ = try await api.igdbImport(gameID: 42, image: image()); XCTFail("Should reject unusable import") }
            catch { XCTAssertTrue(error is CloudError) }
        }
    }

    func testOnlyFixedHTTPSIGDBCDNIsUsedForThumbnails() {
        XCTAssertNotNil(IGDBSupport.cdnURL("https://images.igdb.com/igdb/image/upload/t_thumb/sc123.jpg"))
        for value in ["http://images.igdb.com/image.jpg", "https://images.igdb.com.evil.test/image.jpg", "https://evil.test/image.jpg", "https://user@images.igdb.com/image.jpg", "https://images.igdb.com:444/image.jpg", "data:image/png;base64,abc"] {
            XCTAssertNil(IGDBSupport.cdnURL(value))
        }
    }

    private func image() -> IGDBImage {
        IGDBImage(id: "sc123", kind: .screenshot, width: 1920, height: 1080,
                  thumbnailUrl: "https://images.igdb.com/igdb/image/upload/t_thumb/sc123.jpg",
                  previewUrl: "https://images.igdb.com/igdb/image/upload/t_1080p/sc123.jpg")
    }
    private func imageJSON(id: String, kind: String) -> JSONValue {
        .object(["id": .string(id), "kind": .string(kind), "width": .number(1920), "height": .number(1080),
                 "thumbnailUrl": .string("https://images.igdb.com/igdb/image/upload/t_thumb/\(id).jpg"),
                 "previewUrl": .string("https://images.igdb.com/igdb/image/upload/t_1080p/\(id).jpg")])
    }
    private func importResponse(gameID: Int = 42, dataURL: String = "data:image/jpeg;base64,aGVsbG8=") -> IGDBStubResponse {
        .json(["dataUrl": .string(dataURL), "source": .object([
            "provider": .string("igdb"), "gameId": .number(Double(gameID)), "gameName": .string("Game"),
            "imageId": .string("sc123"), "kind": .string("screenshot"), "url": .string("https://www.igdb.com/games/game")
        ])])
    }
    private func makeAPI(_ responses: [IGDBStubResponse]) -> (CloudAPI, IGDBStubServer) {
        let server = IGDBStubServer(responses: responses)
        IGDBStubProtocol.registry.insert(server)
        let id = server.id
        addTeardownBlock { IGDBStubProtocol.registry.remove(id) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [IGDBStubProtocol.self]
        config.httpAdditionalHeaders = ["X-IGDB-Test-ID": id]
        return (CloudAPI(baseURL: URL(string: "https://igdb.picmake.test")!, configuration: config, persistSession: false), server)
    }
}

private struct IGDBStubResponse: Sendable {
    let status: Int
    let headers: [String: String]
    let body: Data
    static func json(_ value: [String: JSONValue], status: Int = 200, headers: [String: String] = [:]) -> Self {
        Self(status: status, headers: headers.merging(["Content-Type": "application/json"]) { _, new in new },
             body: try! JSONEncoder().encode(JSONValue.object(value)))
    }
}

private final class IGDBStubServer: @unchecked Sendable {
    let id = UUID().uuidString
    private let lock = NSLock()
    private var pending: [IGDBStubResponse]
    private var recorded: [URLRequest] = []
    init(responses: [IGDBStubResponse]) { pending = responses }
    var requests: [URLRequest] { lock.withLock { recorded } }
    func reply(_ request: URLRequest) -> IGDBStubResponse {
        lock.withLock {
            var copy = request
            if copy.httpBody == nil, let stream = copy.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var bytes = Data(), buffer = [UInt8](repeating: 0, count: 4096)
                while true {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    bytes.append(buffer, count: count)
                }
                copy.httpBody = bytes
            }
            recorded.append(copy)
            return pending.isEmpty ? .json(["error": .string("Unexpected request")], status: 500) : pending.removeFirst()
        }
    }
}

private final class IGDBStubRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var servers: [String: IGDBStubServer] = [:]
    func insert(_ server: IGDBStubServer) { lock.withLock { servers[server.id] = server } }
    func remove(_ id: String) { _ = lock.withLock { servers.removeValue(forKey: id) } }
    func server(_ request: URLRequest) -> IGDBStubServer? {
        lock.withLock { servers[request.value(forHTTPHeaderField: "X-IGDB-Test-ID") ?? ""] }
    }
}

private final class IGDBStubProtocol: URLProtocol, @unchecked Sendable {
    static let registry = IGDBStubRegistry()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let server = Self.registry.server(request), let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
            return
        }
        let value = server.reply(request)
        let response = HTTPURLResponse(url: url, statusCode: value.status, httpVersion: "HTTP/1.1", headerFields: value.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: value.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
