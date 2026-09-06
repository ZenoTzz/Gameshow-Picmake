import XCTest
@testable import Picmake

final class CoreTests: XCTestCase {
    func testEditingPreservesUnknownProjectAndCardFields() throws {
        var document = try ProjectDocument(raw: [
            "schemaVersion": .number(2), "theme": .string("nintendoDirectSoft"),
            "futureLayout": .object(["padding": .number(12), "values": .array([.bool(true), .null])]),
            "games": .array([.object([
                "id": .string("card-a"), "title": .string("Before"),
                "futureCrop": .object(["x": .number(0.4)]),
                "showDate": .bool(false), "showPlatforms": .bool(true)
            ])])
        ])
        let unknownProject = document.raw["futureLayout"]
        let unknownCard = document.games[0].raw["futureCrop"]
        document.games[0].title = "After"
        document.games[0].showPlatforms = false
        let reloaded = try JSONDecoder().decode(ProjectDocument.self, from: JSONEncoder().encode(document))
        XCTAssertEqual(reloaded.raw["futureLayout"], unknownProject)
        XCTAssertEqual(reloaded.games[0].raw["futureCrop"], unknownCard)
        XCTAssertEqual(reloaded.games[0].title, "After")
        XCTAssertFalse(reloaded.games[0].showDate)
        XCTAssertFalse(reloaded.games[0].showPlatforms)
    }

    func testCardDateAndPlatformVisibilityAreIndependent() throws {
        var card = GameCard()
        card.date = "2027 年"
        card.platforms = ["Switch 2"]
        card.showDate = false
        XCTAssertTrue(card.showPlatforms)
        XCTAssertEqual(card.date, "2027 年")
        card.showPlatforms = false
        card.showDate = true
        let decoded = try JSONDecoder().decode(GameCard.self, from: JSONEncoder().encode(card))
        XCTAssertTrue(decoded.showDate)
        XCTAssertFalse(decoded.showPlatforms)
        XCTAssertEqual(decoded.platforms, ["Switch 2"])
    }

    func testThemeTextIsRetainedSeparatelyForEachTheme() throws {
        var document = ProjectDocument.blank()
        document.theme = "nintendoDirectSoft"
        document.title = "任天堂项目"
        document.eventLabel = "自定义活动"
        document.theme = "stateOfPlay"
        document.title = "索尼项目"
        document.subtitle = "索尼副标题"
        document.theme = "nintendoDirectSoft"
        XCTAssertEqual(document.title, "任天堂项目")
        XCTAssertEqual(document.eventLabel, "自定义活动")
        document.theme = "stateOfPlay"
        XCTAssertEqual(document.title, "索尼项目")
        XCTAssertEqual(document.subtitle, "索尼副标题")
        XCTAssertEqual(try JSONDecoder().decode(ProjectDocument.self, from: JSONEncoder().encode(document)), document)
    }

    func testLegacyTextMigratesWithoutLosingExtraFields() throws {
        let document = try ProjectDocument(raw: [
            "theme": .string("stateOfPlay"), "games": .array([]),
            "eventLabel": .string("旧活动"), "title": .string("旧标题"),
            "subtitle": .string("旧副标题"), "legacySetting": .bool(true)
        ])
        XCTAssertEqual(document.title, "旧标题")
        XCTAssertEqual(document.eventLabel, "旧活动")
        XCTAssertEqual(document.subtitle, "旧副标题")
        XCTAssertEqual(document.raw["legacySetting"], .bool(true))
    }

    func testDuplicateAndMissingCardIDsBecomeStableUniqueIDs() throws {
        let document = try ProjectDocument(raw: ["theme": .string("stateOfPlay"), "games": .array([
            .object(["id": .string("same")]), .object(["id": .string("same")]), .object([:])
        ])])
        let ids = document.games.map(\.id)
        XCTAssertEqual(Set(ids).count, 3)
        XCTAssertFalse(ids.contains(""))
        XCTAssertEqual(document.games.map(\.id), ids)
        XCTAssertEqual(try JSONDecoder().decode(ProjectDocument.self, from: JSONEncoder().encode(document)).games.map(\.id), ids)
    }

    func testFutureSchemaAndMalformedProjectAreRejected() {
        XCTAssertThrowsError(try ProjectDocument(raw: ["theme": .string("x"), "games": .array([]), "schemaVersion": .number(3)]))
        XCTAssertThrowsError(try ProjectDocument(raw: ["theme": .string("x"), "games": .string("invalid")]))
    }

    func testAssetHashMatchesServerMimeNullByteConvention() {
        let bytes = Data("hello".utf8)
        XCTAssertEqual(AssetCodec.hash(bytes, mime: "image/png"), "97d4daea9714c1607e64e4d76fbf62125a8ee2411547064d833d6dbbe270da04")
        XCTAssertEqual(AssetCodec.hash(bytes, mime: "image/jpeg"), "0e276bbf9a2c260c8e7dac1508c71a40d66b5783299af3df024e8eac198437c0")
    }

    func testAssetPackingDeduplicatesAcrossCardsAndCustomThemes() throws {
        let image = "data:image/png;base64,aGVsbG8="
        let document: JSONValue = .object([
            "games": .array([.object(["image": .string(image)]), .object(["image": .string(image)])]),
            "customThemes": .object(["custom": .object(["logo": .string(image)])]),
            "text": .string("正常文字")
        ])
        let packed = try AssetCodec.pack(document)
        XCTAssertEqual(packed.assets.count, 1)
        XCTAssertEqual(try AssetCodec.assetIDs(packed.project).count, 1)
        XCTAssertEqual(packed.project["games"].array[0]["image"], packed.project["customThemes"]["custom"]["logo"])
        XCTAssertEqual(try AssetCodec.unpack(packed.project, assets: packed.assets), document)
    }

    func testPercentEncodedSVGNormalizesIntoAsset() throws {
        let original = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
        let encoded = original.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        let packed = try AssetCodec.pack(.string("data:image/svg+xml," + encoded))
        let asset = try XCTUnwrap(packed.assets.values.first)
        XCTAssertEqual(asset.mime, "image/svg+xml")
        XCTAssertEqual(String(data: asset.data, encoding: .utf8), original)
        XCTAssertEqual(try AssetCodec.unpack(packed.project, assets: packed.assets), .string("data:image/svg+xml;base64," + Data(original.utf8).base64EncodedString()))
    }

    func testMalformedAssetDataAndDangerousStructuresAreRejected() {
        for value: JSONValue in [
            .string("blob:unfinished"), .string("data:image/png;base64,***"),
            .string("data:image/tiff;base64,aGVsbG8="),
            .object(["$asset": .string("not-an-id")]),
            .object(["__proto__": .object([:])]),
            .object(["constructor": .string("unsafe")])
        ] { XCTAssertThrowsError(try AssetCodec.pack(value), "Must reject \(value)") }
        let id = AssetCodec.hash(Data("hello".utf8), mime: "image/png")
        XCTAssertThrowsError(try AssetCodec.assetIDs(.object(["$asset": .string(id), "other": .bool(true)])))
        XCTAssertThrowsError(try AssetCodec.pack(.object(["$asset": .string(id)])))
        var nested: JSONValue = .string("deep")
        for _ in 0..<32 { nested = .array([nested]) }
        XCTAssertThrowsError(try AssetCodec.pack(nested))
    }

    func testUnpackRejectsMissingTamperedOrWrongMimeAsset() {
        let bytes = Data("hello".utf8)
        let id = AssetCodec.hash(bytes, mime: "image/png")
        let reference: JSONValue = .object(["$asset": .string(id)])
        XCTAssertThrowsError(try AssetCodec.unpack(reference, assets: [:]))
        XCTAssertThrowsError(try AssetCodec.unpack(reference, assets: [id: ImageAsset(data: Data("changed".utf8), mime: "image/png")]))
        XCTAssertThrowsError(try AssetCodec.unpack(reference, assets: [id: ImageAsset(data: bytes, mime: "image/jpeg")]))
    }

    func testLoginThenSaveSendsOriginCookieCSRFAndRequestID() async throws {
        let (api, server) = makeAPI([loginResponse(), .json(["missing": .array([])]), envelope(status: 201)])
        _ = try await api.login(username: "tester", password: "test-password")
        _ = try await api.save(draft(), create: true, requestID: "creation-request-123")
        let requests = server.requests
        XCTAssertEqual(requests.map(\.path), ["/api/login", "/api/assets/check", "/api/projects"])
        XCTAssertTrue(requests.allSatisfy { $0.headers["origin"] == "https://picmake.test" })
        XCTAssertNil(requests[0].headers["cookie"])
        XCTAssertEqual(requests[0].json["username"], .string("tester"))
        XCTAssertEqual(requests[0].json["password"], .string("test-password"))
        for request in requests.dropFirst() {
            XCTAssertEqual(request.headers["cookie"], "picmake_session=" + Self.sessionToken)
            XCTAssertEqual(request.headers["x-csrf-token"], "csrf-first")
        }
        XCTAssertEqual(requests[2].method, "POST")
        XCTAssertEqual(requests[2].headers["content-type"], "application/json")
        XCTAssertEqual(requests[2].json["requestId"], .string("creation-request-123"))
        XCTAssertEqual(requests[2].json["name"], .string("测试项目"))
    }

    func testExplicitCreateRetryPreservesCallerRequestID() async throws {
        let (api, server) = makeAPI([.json(["missing": .array([])]), envelope(status: 201), .json(["missing": .array([])]), envelope(status: 201)])
        _ = try await api.save(draft(), create: true, requestID: "stable-request-id")
        _ = try await api.save(draft(), create: true, requestID: "stable-request-id")
        XCTAssertEqual(server.requests.filter { $0.path == "/api/projects" }.map { $0.json["requestId"] }, [.string("stable-request-id"), .string("stable-request-id")])
    }

    func testUnauthorizedIsNotRetriedAndClearsCookie() async throws {
        let (api, server) = makeAPI([loginResponse(), .error(401, "请先登录"), .json(["projects": .array([])])])
        _ = try await api.login(username: "tester", password: "password")
        do {
            _ = try await api.projects()
            XCTFail("Expected 401")
        } catch let error as CloudError { XCTAssertEqual(error.status, 401) }
        XCTAssertEqual(server.requests.count, 2)
        _ = try await api.projects()
        XCTAssertNil(server.requests.last?.headers["cookie"])
    }

    func testConflictUsesBaseRevisionAndDoesNotRetryOrCreateCopy() async throws {
        let (api, server) = makeAPI([.json(["missing": .array([])]), .error(409, "云端已有更新，请先载入或备份本机版本")])
        var editing = draft()
        editing.cloudID = "legacy"
        editing.revision = 7
        do {
            _ = try await api.save(editing, create: false, requestID: "unused-on-update")
            XCTFail("Expected conflict")
        } catch let error as CloudError {
            XCTAssertEqual(error.status, 409)
            XCTAssertTrue(error.localizedDescription.contains("另存"))
        }
        XCTAssertEqual(server.requests.count, 2)
        XCTAssertEqual(server.requests.last?.path, "/api/projects/legacy")
        XCTAssertEqual(server.requests.last?.method, "PUT")
        XCTAssertEqual(server.requests.last?.json["baseRevision"], .number(7))
        XCTAssertEqual(server.requests.last?.json["requestId"], .null)
    }

    func testCSRFSpecificForbiddenRefreshesAndRetriesOnce() async throws {
        let (api, server) = makeAPI([
            loginResponse(), .error(403, "会话校验失败，请刷新重试"),
            .json(["authenticated": .bool(true), "csrfToken": .string("csrf-fresh")]),
            .json(["missing": .array([])]), envelope(status: 201)
        ])
        _ = try await api.login(username: "tester", password: "password")
        _ = try await api.save(draft(), create: true, requestID: "csrf-retry-create")
        XCTAssertEqual(server.requests.map(\.path), ["/api/login", "/api/assets/check", "/api/session", "/api/assets/check", "/api/projects"])
        XCTAssertEqual(server.requests[1].headers["x-csrf-token"], "csrf-first")
        XCTAssertEqual(server.requests[3].headers["x-csrf-token"], "csrf-fresh")
        XCTAssertEqual(server.requests[1].body, server.requests[3].body)
    }

    func testRepeatedCSRFFailureStopsAfterOneRefresh() async throws {
        let (api, server) = makeAPI([
            .error(403, "会话校验失败，请刷新重试"),
            .json(["authenticated": .bool(true), "csrfToken": .string("csrf-fresh")]),
            .error(403, "会话校验失败，请刷新重试")
        ])
        do {
            _ = try await api.save(draft(), create: true, requestID: "csrf-stops-here")
            XCTFail("Expected 403")
        } catch let error as CloudError { XCTAssertEqual(error.status, 403) }
        XCTAssertEqual(server.requests.map(\.path), ["/api/assets/check", "/api/session", "/api/assets/check"])
    }

    func testUnrelatedForbiddenDoesNotRefreshOrRetry() async throws {
        let (api, server) = makeAPI([.error(403, "来源不受信任")])
        do {
            _ = try await api.save(draft(), create: true, requestID: "no-retry-forbidden")
            XCTFail("Expected 403")
        } catch let error as CloudError { XCTAssertEqual(error.status, 403) }
        XCTAssertEqual(server.requests.count, 1)
    }

    func testSaveUploadsMissingAssetOnceAndReferencesItsHash() async throws {
        var editing = draft()
        var card = GameCard()
        card.image = "data:image/png;base64,aGVsbG8="
        editing.project.games = [card, GameCard()]
        editing.project.games[1].image = card.image
        let id = "97d4daea9714c1607e64e4d76fbf62125a8ee2411547064d833d6dbbe270da04"
        let (api, server) = makeAPI([.json(["missing": .array([.string(id)])]), .json([:]), envelope(status: 201)])
        _ = try await api.save(editing, create: true, requestID: "asset-upload-request")
        XCTAssertEqual(server.requests.map(\.method), ["POST", "PUT", "POST"])
        XCTAssertEqual(server.requests[0].json["ids"], .array([.string(id)]))
        XCTAssertEqual(server.requests[1].path, "/api/assets/" + id)
        XCTAssertEqual(server.requests[1].headers["content-type"], "image/png")
        XCTAssertEqual(server.requests[1].body, Data("hello".utf8))
        let games = server.requests[2].json["project"]["games"].array
        XCTAssertEqual(games[0]["image"], .object(["$asset": .string(id)]))
        XCTAssertEqual(games[0]["image"], games[1]["image"])
    }

    func testUnpackDownloadsSharedAssetOnceAndRejectsTampering() async throws {
        let id = "97d4daea9714c1607e64e4d76fbf62125a8ee2411547064d833d6dbbe270da04"
        let ref: JSONValue = .object(["$asset": .string(id)])
        let project: JSONValue = .object(["theme": .string("stateOfPlay"), "games": .array([
            .object(["id": .string("a"), "image": ref]), .object(["id": .string("b"), "image": ref])
        ])])
        let (api, server) = makeAPI([MockResponse(status: 200, headers: ["Content-Type": "image/png"], body: Data("hello".utf8))])
        let document = try await api.unpack(project)
        XCTAssertEqual(server.requests.count, 1)
        XCTAssertEqual(document.games[0].image, "data:image/png;base64,aGVsbG8=")
        XCTAssertEqual(document.games[0].image, document.games[1].image)
        let (tamperedAPI, _) = makeAPI([MockResponse(status: 200, headers: ["Content-Type": "image/png"], body: Data("wrong".utf8))])
        do {
            _ = try await tamperedAPI.unpack(project)
            XCTFail("Expected asset integrity failure")
        } catch let error as CloudError { XCTAssertTrue(error.localizedDescription.contains("校验失败")) }
    }

    func testInvalidProjectIdentifierMakesNoNetworkRequest() async throws {
        let (api, server) = makeAPI([])
        do {
            _ = try await api.project(id: "../session")
            XCTFail("Expected invalid ID")
        } catch let error as CloudError { XCTAssertEqual(error.status, 0) }
        XCTAssertTrue(server.requests.isEmpty)
    }

    private static let sessionToken = String(repeating: "a", count: 64)
    private func loginResponse() -> MockResponse {
        .json(["authenticated": .bool(true), "username": .string("tester"), "csrfToken": .string("csrf-first")],
              headers: ["Set-Cookie": "picmake_session=\(Self.sessionToken); Path=/; HttpOnly; Secure; SameSite=Strict"])
    }
    private func draft() -> ProjectDraft {
        ProjectDraft(id: UUID().uuidString, cloudID: nil, name: " 测试项目 ", revision: 0, project: .blank())
    }
    private func envelope(status: Int) -> MockResponse {
        .json(["id": .string("11111111-1111-4111-8111-111111111111"), "name": .string("测试项目"),
               "revision": .number(1), "project": ProjectDocument.blank().jsonValue(),
               "updatedAt": .string("2026-09-06T00:00:00.000Z")], status: status)
    }
    private func makeAPI(_ responses: [MockResponse]) -> (CloudAPI, MockServer) {
        let server = MockServer(responses: responses)
        MockURLProtocol.registry.insert(server)
        let id = server.id
        addTeardownBlock { MockURLProtocol.registry.remove(id) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        configuration.httpAdditionalHeaders = ["X-Picmake-Test-ID": server.id]
        return (CloudAPI(baseURL: URL(string: "https://picmake.test")!, configuration: configuration, persistSession: false), server)
    }
}

private struct MockResponse: Sendable {
    let status: Int
    let headers: [String: String]
    let body: Data
    static func json(_ value: [String: JSONValue], status: Int = 200, headers: [String: String] = [:]) -> Self {
        var headers = headers
        headers["Content-Type"] = "application/json"
        return Self(status: status, headers: headers, body: try! JSONEncoder().encode(JSONValue.object(value)))
    }
    static func error(_ status: Int, _ message: String) -> Self { .json(["error": .string(message)], status: status) }
}

private struct RecordedRequest: Sendable {
    let path: String
    let method: String
    let headers: [String: String]
    let body: Data
    var json: JSONValue { (try? JSONDecoder().decode(JSONValue.self, from: body)) ?? .null }
    init(_ request: URLRequest) {
        path = request.url?.path ?? ""
        method = request.httpMethod ?? "GET"
        headers = Dictionary((request.allHTTPHeaderFields ?? [:]).map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { _, new in new })
        if let data = request.httpBody { body = data }
        else if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                bytes.append(buffer, count: count)
            }
            body = bytes
        } else { body = Data() }
    }
}

private final class MockServer: @unchecked Sendable {
    let id = UUID().uuidString
    private let lock = NSLock()
    private var pending: [MockResponse]
    private var recorded: [RecordedRequest] = []
    init(responses: [MockResponse]) { pending = responses }
    var requests: [RecordedRequest] { lock.withLock { recorded } }
    func reply(to request: URLRequest) -> MockResponse {
        lock.withLock {
            recorded.append(RecordedRequest(request))
            return pending.isEmpty ? .error(500, "Unexpected extra request") : pending.removeFirst()
        }
    }
}

private final class MockRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var servers: [String: MockServer] = [:]
    func insert(_ server: MockServer) { lock.withLock { servers[server.id] = server } }
    func remove(_ id: String) { _ = lock.withLock { servers.removeValue(forKey: id) } }
    func server(for request: URLRequest) -> MockServer? {
        lock.withLock { servers[request.value(forHTTPHeaderField: "X-Picmake-Test-ID") ?? ""] }
    }
}

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    static let registry = MockRegistry()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let server = Self.registry.server(for: request), let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.resourceUnavailable))
            return
        }
        let response = server.reply(to: request)
        let http = HTTPURLResponse(url: url, statusCode: response.status, httpVersion: "HTTP/1.1", headerFields: response.headers)!
        client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: response.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
