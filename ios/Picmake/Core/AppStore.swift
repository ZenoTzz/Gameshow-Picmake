import Foundation
import SwiftUI
import CryptoKit

@MainActor final class AppStore: ObservableObject {
    @Published var authenticated = false
    @Published var username = ""
    @Published var projects: [ProjectSummary] = []
    @Published var isBusy = false
    @Published var error: String?
    @Published var draftVersion = 0
    let api: CloudAPI
    private let directory: URL
    private let demo: Bool
    private var started = false
    init(api: CloudAPI = CloudAPI(), directory: URL? = nil) {
        #if DEBUG
        demo = ProcessInfo.processInfo.arguments.contains("--demo")
        self.api = IGDBDemo.enabled ? IGDBDemo.makeAPI() : api
        #else
        demo = false
        self.api = api
        #endif
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(demo ? "DemoDrafts" : "ProjectDrafts")
    }
    func start() async {
        guard !started else { return }
        started = true
        if demo {
            do {
                if ProcessInfo.processInfo.arguments.contains("--reset-demo"), FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
                if loadDrafts().isEmpty, let url = Bundle.main.url(forResource: "demo-project", withExtension: "json") {
                    let document = try JSONDecoder().decode(ProjectDocument.self, from: Data(contentsOf: url))
                    try persistDraft(ProjectDraft(id: UUID().uuidString, cloudID: nil, name: "Nintendo Direct 示例", revision: 0, project: document))
                }
            } catch { self.error = error.localizedDescription }
            #if DEBUG
            if IGDBDemo.enabled {
                authenticated = true
                username = "本地演示"
            }
            #endif
            return
        }
        isBusy = true; defer { isBusy = false }
        do {
            let result = try await api.restoreSession()
            authenticated = result["authenticated"].bool == true; username = result["username"].string ?? ""
            if authenticated { await refreshProjects() }
        } catch { self.error = "暂时无法连接云端，本机草稿仍可编辑。\(error.localizedDescription)" }
    }
    func login(username: String, password: String) async {
        guard !demo else { error = "这是本地演示，未连接云端。"; return }
        isBusy = true; error = nil; defer { isBusy = false }
        do { _ = try await api.login(username: username, password: password); authenticated = true; self.username = username; await refreshProjects() }
        catch { handle(error) }
    }
    func logout() async {
        isBusy = true; error = nil; defer { isBusy = false }
        do { try await api.logout(); authenticated = false; username = ""; projects = [] }
        catch { handle(error) }
    }
    func refreshProjects() async {
        guard authenticated else { return }
        isBusy = true; defer { isBusy = false }
        do { projects = try await api.projects(); error = nil } catch { handle(error) }
    }
    private func handle(_ error: Error) {
        self.error = error.localizedDescription
        if (error as? CloudError)?.status == 401 { authenticated = false; username = ""; projects = [] }
    }
    func openProject(_ id: String) async throws -> ProjectDraft {
        do {
            let envelope = try await api.project(id: id)
            return ProjectDraft(id: UUID().uuidString, cloudID: envelope.id ?? id, name: envelope.name ?? "未命名项目", revision: envelope.revision, project: try await api.unpack(envelope.project))
        } catch { handle(error); throw error }
    }
    func saveDraft(_ draft: ProjectDraft, asCopy: Bool = false) async throws -> ProjectDraft {
        guard authenticated, !demo else { throw CloudError(status: 401, message: "请先登录云端。") }
        try persistDraft(draft)
        var sending = draft
        if asCopy { sending.name = String(draft.name.prefix(96)) + " 副本" }
        let create = asCopy || draft.cloudID == nil
        // A lost creation response can be retried with identical content without creating duplicates.
        let packed = try AssetCodec.pack(sending.project.jsonValue()).project
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        var signature = try encoder.encode(packed)
        signature.append(Data((draft.id + "\0" + sending.name + "\0" + String(asCopy)).utf8))
        let requestID = "ios-" + SHA256.hash(data: signature).map { String(format: "%02x", $0) }.joined()
        do {
            let envelope = try await api.save(sending, create: create, requestID: requestID)
            var saved = sending
            if asCopy { saved.id = UUID().uuidString }
            saved.cloudID = envelope.id ?? draft.cloudID; saved.revision = envelope.revision
            saved.name = envelope.name ?? sending.name
            try persistDraft(saved)
            await refreshProjects()
            return saved
        } catch { handle(error); throw error }
    }
    private func draftURL(_ id: String) throws -> URL {
        guard UUID(uuidString: id) != nil else { throw CloudError(status: 0, message: "本机草稿标识无效。") }
        return directory.appendingPathComponent(id + ".json")
    }
    func persistDraft(_ draft: ProjectDraft) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let url = try draftURL(draft.id)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(draft)
        // Avoid rewriting large image payloads when the view appears/disappears unchanged.
        if (try? Data(contentsOf: url)) != bytes {
            try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            draftVersion += 1
        }
    }
    func loadDrafts() -> [ProjectDraft] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        do {
            let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]).filter { $0.pathExtension == "json" }
            let sorted = files.sorted { ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) > ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
            var drafts: [ProjectDraft] = []
            for file in sorted {
                do { drafts.append(try JSONDecoder().decode(ProjectDraft.self, from: Data(contentsOf: file))) }
                catch { self.error = "有草稿暂时无法读取，原文件已保留。\(error.localizedDescription)" }
            }
            return drafts
        } catch { self.error = "无法读取本机草稿：\(error.localizedDescription)"; return [] }
    }
    func removeDraft(_ id: String) throws { try FileManager.default.removeItem(at: draftURL(id)); draftVersion += 1 }
}
