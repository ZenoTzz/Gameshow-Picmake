import SwiftUI

@MainActor
struct ProjectLibraryView: View {
    @ObservedObject var store: AppStore
    @Binding var draft: ProjectDraft
    @Environment(\.dismiss) private var dismiss

    @State private var section: LibrarySection = .history
    @State private var versions: [HistoryVersion] = []
    @State private var templates: [TemplateSummary] = []
    @State private var loading = false
    @State private var loadRequestID = UUID()
    @State private var applying = false
    @State private var errorMessage: String?
    @State private var selectedVersion: HistoryVersion?
    @State private var selectedTemplate: TemplateSummary?

    private enum LibrarySection: String, CaseIterable, Identifiable {
        case history = "历史版本", templates = "共享模板"
        var id: String { rawValue }
    }

    private var requestKey: String {
        "\(section.rawValue)|\(draft.cloudID ?? "local")|\(store.authenticated)"
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("内容", selection: $section) {
                        ForEach(LibrarySection.allCases) { section in
                            Text(section.rawValue).tag(section)
                        }
                    }
                    .pickerStyle(.segmented)
                    .disabled(applying)
                }

                if !store.authenticated {
                    ContentUnavailableView("请先登录", systemImage: "person.crop.circle",
                                           description: Text("返回项目并登录，即可查看云端历史版本和共享模板。"))
                } else if section == .history {
                    historyContent
                } else {
                    templateContent
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                            .font(.subheadline)
                        if !applying {
                            Button("重新加载") { Task { await reload() } }
                                .disabled(loading)
                        }
                    }
                }
            }
            .navigationTitle("历史与模板")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }.disabled(applying)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if loading || applying { ProgressView().accessibilityLabel(applying ? "正在载入" : "正在加载列表") }
                }
            }
            .interactiveDismissDisabled(applying)
            .refreshable { await reload() }
            .task(id: requestKey) { await reload() }
            .confirmationDialog("载入历史版本 \(selectedVersion?.revision ?? 0)？", isPresented: Binding(
                get: { selectedVersion != nil },
                set: { if !$0 { selectedVersion = nil } }
            ), titleVisibility: .visible) {
                Button("载入为独立项目") {
                    if let version = selectedVersion { restore(version) }
                    selectedVersion = nil
                }
                Button("取消", role: .cancel) { selectedVersion = nil }
            } message: {
                Text("当前草稿会保留。历史内容将打开为新的本机草稿，之后可以另存到云端。")
            }
            .confirmationDialog("应用“\(selectedTemplate?.name ?? "模板")”？", isPresented: Binding(
                get: { selectedTemplate != nil },
                set: { if !$0 { selectedTemplate = nil } }
            ), titleVisibility: .visible) {
                Button("应用模板外观") {
                    if let template = selectedTemplate { apply(template) }
                    selectedTemplate = nil
                }
                Button("取消", role: .cancel) { selectedTemplate = nil }
            } message: {
                Text("替换当前项目的模板外观，保留卡片、图片和已填写的文字。应用后可先预览，再保存到云端。")
            }
        }
    }

    @ViewBuilder
    private var historyContent: some View {
        if draft.cloudID == nil {
            ContentUnavailableView("本机草稿暂无云端历史", systemImage: "clock.arrow.circlepath",
                                   description: Text("将项目保存到云端后，可在这里找回之前保存的版本。"))
        } else {
            Section {
                ForEach(versions) { version in
                    Button {
                        selectedVersion = version
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: version.pinned ? "pin.fill" : "clock.arrow.circlepath")
                                .foregroundStyle(.tint)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(version.name.flatMap { $0.isEmpty ? nil : $0 } ?? "版本 \(version.revision)")
                                    .font(.headline)
                                Text("版本 \(version.revision) · \(friendlyDate(version.updatedAt))")
                                    .font(.caption).foregroundStyle(.secondary)
                                if version.pinned {
                                    Text("已保留的版本").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.down.doc").foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    .tint(.primary)
                    .disabled(applying || loading)
                }
                if versions.isEmpty && !loading && errorMessage == nil {
                    ContentUnavailableView("还没有历史版本", systemImage: "clock",
                                           description: Text("保存项目后，云端保留的历史版本会显示在这里。"))
                }
            } header: {
                Text(draft.name.isEmpty ? "当前项目" : draft.name)
            } footer: {
                Text("载入历史版本会新建独立草稿，原项目与当前修改都会保留。")
            }
        }
    }

    private var templateContent: some View {
        Section {
            ForEach(templates) { template in
                Button {
                    selectedTemplate = template
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "paintpalette").foregroundStyle(.tint)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(template.name).font(.headline)
                            Text(friendlyDate(template.updatedAt)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .tint(.primary)
                .disabled(applying || loading)
            }
            if templates.isEmpty && !loading && errorMessage == nil {
                ContentUnavailableView("还没有共享模板", systemImage: "paintpalette",
                                       description: Text("在网站保存到云端模板库的设计，会显示在这里。内置主题可在项目的主题选择中使用。"))
            }
        } header: {
            Text("云端模板库")
        } footer: {
            Text("模板保存可复用的外观；项目保存本次制作的文字和图片。")
        }
    }

    private func reload() async {
        guard !applying else { return }
        let key = requestKey
        let requestID = UUID()
        loadRequestID = requestID
        loading = true
        errorMessage = nil
        defer { if loadRequestID == requestID { loading = false } }
        guard store.authenticated else { versions = []; templates = []; return }
        do {
            if section == .history {
                versions = []
                guard let id = draft.cloudID else { return }
                let values = try await store.api.history(id: id)
                guard !Task.isCancelled, requestKey == key, loadRequestID == requestID else { return }
                versions = values.sorted { $0.revision > $1.revision }
            } else {
                templates = []
                let values = try await store.api.templates()
                guard !Task.isCancelled, requestKey == key, loadRequestID == requestID else { return }
                templates = values.sorted { $0.updatedAt > $1.updatedAt }
            }
        } catch {
            guard !Task.isCancelled, requestKey == key, loadRequestID == requestID else { return }
            errorMessage = error.localizedDescription
        }
    }

    private func restore(_ version: HistoryVersion) {
        guard !applying, !loading, let cloudID = draft.cloudID else { return }
        let original = draft
        applying = true
        errorMessage = nil
        Task {
            defer { applying = false }
            do {
                try store.persistDraft(original)
                let envelope = try await store.api.version(id: cloudID, revision: version.revision)
                let project = try await store.api.unpack(envelope.project)
                guard draft == original else {
                    throw CloudError(status: 0, message: "当前草稿已发生变化，请重新选择历史版本。")
                }
                let name = envelope.name ?? original.name
                let restored = ProjectDraft(id: UUID().uuidString.lowercased(), cloudID: nil,
                                            name: "\(name.isEmpty ? "未命名项目" : name) · 历史 v\(version.revision)",
                                            revision: 0, project: project)
                try store.persistDraft(restored)
                draft = restored
                dismiss()
            } catch { errorMessage = "未能载入历史版本：\(error.localizedDescription)" }
        }
    }

    private func apply(_ template: TemplateSummary) {
        guard !applying, !loading else { return }
        let original = draft
        applying = true
        errorMessage = nil
        Task {
            defer { applying = false }
            do {
                try store.persistDraft(original)
                let envelope = try await store.api.template(id: template.id)
                let design = try await store.api.unpack(envelope.project)
                guard draft == original else {
                    throw CloudError(status: 0, message: "当前草稿已发生变化，请重新选择模板。")
                }
                var updated = original
                updated.project = try original.project.applyingTemplate(design)
                try store.persistDraft(updated)
                draft = updated
                dismiss()
            } catch { errorMessage = "未能应用模板：\(error.localizedDescription)" }
        }
    }

    private func friendlyDate(_ value: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
