import Foundation
import CryptoKit

private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

actor CloudAPI {
    static let production = URL(string: "https://pic.zenohy.uk")!
    private let baseURL: URL
    private let session: URLSession
    private let persistSession: Bool
    private var cookie: String?
    private var csrf = ""
    init(baseURL: URL = CloudAPI.production, configuration: URLSessionConfiguration = .ephemeral, persistSession: Bool = true) {
        self.baseURL = baseURL; self.persistSession = persistSession
        configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
        configuration.urlCache = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 60; configuration.timeoutIntervalForResource = 120
        self.session = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    }
    func restoreSession() async throws -> JSONValue {
        if persistSession { cookie = try SessionKeychain.load() }
        return try await request("/session")
    }
    func login(username: String, password: String) async throws -> JSONValue {
        try await request("/login", method: "POST", value: .object(["username": .string(username), "password": .string(password)]))
    }
    func logout() async throws {
        _ = try await request("/logout", method: "POST", value: .object([:]))
        cookie = nil; csrf = ""; if persistSession { try SessionKeychain.save(nil) }
    }
    private func send(_ path: String, method: String = "GET", data: Data? = nil, mime: String? = nil, refreshCSRF: Bool = true) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: baseURL.appendingPathComponent("api" + path))
        request.httpMethod = method; request.httpBody = data
        request.setValue(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        if let cookie { request.setValue("picmake_session=" + cookie, forHTTPHeaderField: "Cookie") }
        if method != "GET" { request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token") }
        if let mime { request.setValue(mime, forHTTPHeaderField: "Content-Type") }
        let (bytes, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw CloudError(status: 0, message: "服务器响应无效。") }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONDecoder().decode(JSONValue.self, from: bytes))?["error"].string ?? "请求失败（\(response.statusCode)）。"
            if response.statusCode == 403 && refreshCSRF && message == "会话校验失败，请刷新重试" {
                _ = try await self.request("/session")
                return try await send(path, method: method, data: data, mime: mime, refreshCSRF: false)
            }
            if response.statusCode == 401 { cookie = nil; csrf = ""; if persistSession { try SessionKeychain.save(nil) } }
            throw CloudError(status: response.statusCode, message: response.statusCode == 409 ? "电脑或其他设备已更新此项目。手机草稿已保留；请返回查看云端版本，或另存为新项目。" : message)
        }
        if path == "/login", let header = response.value(forHTTPHeaderField: "Set-Cookie") {
            let candidates = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: baseURL)
            guard let token = candidates.first(where: { $0.name == "picmake_session" })?.value, token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw CloudError(status: 0, message: "服务器未返回有效登录凭据。") }
            if persistSession { try SessionKeychain.save(token) }; cookie = token
        }
        return (bytes, response)
    }
    private func request(_ path: String, method: String = "GET", value: JSONValue? = nil) async throws -> JSONValue {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let (data, _) = try await send(path, method: method, data: value.map { try encoder.encode($0) }, mime: value == nil ? nil : "application/json")
        let result = try JSONDecoder().decode(JSONValue.self, from: data)
        if let token = result["csrfToken"].string { csrf = token }
        return result
    }
    private func decode<T: Decodable>(_ value: JSONValue, as: T.Type) throws -> T { try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value)) }
    func projects() async throws -> [ProjectSummary] { try decode(await request("/projects")["projects"], as: [ProjectSummary].self) }
    func project(id: String) async throws -> ProjectEnvelope { try decode(await request("/projects/\(try checkedID(id))"), as: ProjectEnvelope.self) }
    func history(id: String) async throws -> [HistoryVersion] { try decode(await request("/projects/\(try checkedID(id))/history")["versions"], as: [HistoryVersion].self) }
    func version(id: String, revision: Int) async throws -> ProjectEnvelope {
        guard revision > 0 else { throw CloudError(status: 0, message: "版本号无效。") }
        return try decode(await request("/projects/\(try checkedID(id))/history/\(revision)"), as: ProjectEnvelope.self)
    }
    func templates() async throws -> [TemplateSummary] { try decode(await request("/templates")["templates"], as: [TemplateSummary].self) }
    func template(id: String) async throws -> ProjectEnvelope { try decode(await request("/templates/\(try checkedID(id))"), as: ProjectEnvelope.self) }
    private func checkedID(_ id: String) throws -> String {
        guard id == "legacy" || UUID(uuidString: id) != nil || AssetCodec.validID(id) else { throw CloudError(status: 0, message: "项目标识无效。") }; return id.lowercased()
    }
    func unpack(_ value: JSONValue) async throws -> ProjectDocument {
        let ids = try AssetCodec.assetIDs(value)
        var assets: [String: ImageAsset] = [:]; var total = 0
        for id in ids.sorted() {
            let (bytes, response) = try await send("/assets/" + id)
            let mime = response.mimeType ?? ""
            guard AssetCodec.validMime(mime), bytes.count <= AssetCodec.maxAsset, AssetCodec.hash(bytes, mime: mime) == id else { throw CloudError(status: 0, message: "云端图片校验失败，请重新载入。") }
            total += bytes.count; guard total <= AssetCodec.maxTotal else { throw CloudError(status: 0, message: "图片总量超过 100 MB。") }
            assets[id] = ImageAsset(data: bytes, mime: mime)
        }
        return try ProjectDocument(raw: AssetCodec.unpack(value, assets: assets).object)
    }
    private func prepare(_ document: ProjectDocument) async throws -> JSONValue {
        let packed = try AssetCodec.pack(document.jsonValue())
        let checked = try await request("/assets/check", method: "POST", value: .object(["ids": .array(packed.assets.keys.sorted().map(JSONValue.string))]))
        guard case .array(let missing) = checked["missing"] else { throw CloudError(status: 0, message: "素材检查响应无效。") }
        for value in missing {
            guard let id = value.string, let asset = packed.assets[id] else { throw CloudError(status: 0, message: "服务器请求了无效素材。") }
            _ = try await send("/assets/" + id, method: "PUT", data: asset.data, mime: asset.mime)
        }
        return packed.project
    }
    func save(_ draft: ProjectDraft, create: Bool, requestID: String) async throws -> ProjectEnvelope {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 100 else { throw CloudError(status: 0, message: "项目名称需要 1–100 个字符。") }
        let project = try await prepare(draft.project)
        var body: [String: JSONValue] = ["name": .string(name), "project": project]
        if create {
            body["requestId"] = .string(requestID)
            return try decode(await request("/projects", method: "POST", value: .object(body)), as: ProjectEnvelope.self)
        }
        guard let id = draft.cloudID else { throw CloudError(status: 0, message: "未关联云端项目。") }
        body["baseRevision"] = .number(Double(draft.revision))
        return try decode(await request("/projects/\(try checkedID(id))", method: "PUT", value: .object(body)), as: ProjectEnvelope.self)
    }
    func saveTemplate(_ project: ProjectDocument, name: String, requestID: String) async throws {
        let packed = try await prepare(project.templateSnapshot(name: name))
        _ = try await request("/templates", method: "POST", value: .object(["name": .string(name), "project": packed, "requestId": .string(requestID)]))
    }
}

struct ImageAsset: Sendable { let data: Data; let mime: String }
enum AssetCodec {
    static let maxAsset = 20 * 1024 * 1024, maxTotal = 100 * 1024 * 1024
    static func validID(_ id: String) -> Bool { id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    static func validMime(_ mime: String) -> Bool { ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml", "image/bmp", "image/x-icon"].contains(mime) }
    static func hash(_ data: Data, mime: String) -> String { var input = Data((mime + "\0").utf8); input.append(data); return SHA256.hash(data: input).map { String(format: "%02x", $0) }.joined() }
    static func map(_ value: JSONValue, depth: Int = 0, string: (String) throws -> JSONValue, asset: (String) throws -> JSONValue) throws -> JSONValue {
        guard depth < 30 else { throw CloudError(status: 0, message: "项目层级过多。") }
        switch value {
        case .string(let s): return try string(s)
        case .array(let a): return .array(try a.map { try map($0, depth: depth + 1, string: string, asset: asset) })
        case .object(let o):
            if let id = o["$asset"] { guard o.count == 1, let id = id.string, validID(id) else { throw CloudError(status: 0, message: "素材引用无效。") }; return try asset(id) }
            guard !o.keys.contains(where: { ["__proto__", "prototype", "constructor"].contains($0) }) else { throw CloudError(status: 0, message: "项目字段无效。") }
            return .object(try o.mapValues { try map($0, depth: depth + 1, string: string, asset: asset) })
        default: return value
        }
    }
    static func assetIDs(_ value: JSONValue) throws -> Set<String> {
        var ids = Set<String>()
        _ = try map(value, string: JSONValue.string, asset: { ids.insert($0); return .null })
        guard ids.count <= 1000 else { throw CloudError(status: 0, message: "素材数量超过 1000 张。") }; return ids
    }
    static func pack(_ value: JSONValue) throws -> (project: JSONValue, assets: [String: ImageAsset]) {
        var assets: [String: ImageAsset] = [:]; var total = 0
        let packed = try map(value, string: { s in
            guard !s.hasPrefix("blob:") else { throw CloudError(status: 0, message: "图片尚未载入完成。") }
            guard s.hasPrefix("data:image/") else { return .string(s) }
            guard s.utf8.count <= maxAsset * 3 / 2, let comma = s.firstIndex(of: ",") else { throw CloudError(status: 0, message: "图片超过 20 MB 或格式无效。") }
            let header = String(s[s.index(s.startIndex, offsetBy: 5)..<comma]); let mime = String(header.split(separator: ";")[0]); let body = String(s[s.index(after: comma)...])
            guard validMime(mime) else { throw CloudError(status: 0, message: "图片格式不受支持。") }
            let bytes = header.hasSuffix(";base64") ? Data(base64Encoded: body) : body.removingPercentEncoding.map { Data($0.utf8) }
            guard let bytes, bytes.count <= maxAsset else { throw CloudError(status: 0, message: "图片损坏或超过 20 MB。") }
            let id = hash(bytes, mime: mime)
            if assets[id] == nil { total += bytes.count; assets[id] = ImageAsset(data: bytes, mime: mime) }
            guard total <= maxTotal, assets.count <= 1000 else { throw CloudError(status: 0, message: "素材总量超过 100 MB / 1000 张。") }
            return .object(["$asset": .string(id)])
        }, asset: { _ in throw CloudError(status: 0, message: "项目图片尚未完整载入。") })
        guard try JSONEncoder().encode(packed).count <= 5 * 1024 * 1024 else { throw CloudError(status: 0, message: "项目文字和设置超过 5 MB。") }
        return (packed, assets)
    }
    static func unpack(_ value: JSONValue, assets: [String: ImageAsset]) throws -> JSONValue {
        try map(value, string: JSONValue.string, asset: { id in
            guard let asset = assets[id], validMime(asset.mime), hash(asset.data, mime: asset.mime) == id else { throw CloudError(status: 0, message: "图片缺失或校验失败。") }
            return .string("data:\(asset.mime);base64,\(asset.data.base64EncodedString())")
        })
    }
}
