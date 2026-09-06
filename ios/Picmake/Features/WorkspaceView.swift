import SwiftUI

struct WorkspaceView: View {
    @EnvironmentObject private var store: AppStore
    @State private var localDrafts: [ProjectDraft] = []
    @State private var selectedDraft: ProjectDraft?
    @State private var showsLogin = false
    @State private var openingProject = false
    @State private var workspaceError: String?
    @State private var draftToRemove: ProjectDraft?
    @State private var cloudProjectToOpen: ProjectSummary?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(action: createProject) {
                        Label("新建项目", systemImage: "plus.circle.fill")
                            .font(.headline)
                            .padding(.vertical, 6)
                    }
                    .accessibilityIdentifier("workspace.newProject")
                } footer: {
                    Text("文字、图片和排版保存在项目里；切换主题可以尝试不同设计。")
                }

                if !localDrafts.isEmpty {
                    Section("本机草稿") {
                        ForEach(localDrafts) { draft in
                            Button {
                                selectedDraft = draft
                            } label: {
                                ProjectRow(name: draft.name, count: draft.project.games.count,
                                           detail: draft.cloudID == nil ? "仅保存在这台 iPhone" : "本机编辑副本 · 云端版本 \(draft.revision)")
                            }
                            .tint(.primary)
                            .swipeActions {
                                Button("移除", role: .destructive) { draftToRemove = draft }
                            }
                        }
                    }
                }

                Section {
                    if store.authenticated {
                        if store.projects.isEmpty {
                            ContentUnavailableView("还没有云端项目", systemImage: "icloud",
                                                   description: Text("新建项目后，点击“保存到云端”，就能在电脑上继续修改。"))
                        } else {
                            ForEach(store.projects) { project in
                                Button {
                                    openCloudProject(project)
                                } label: {
                                    ProjectRow(name: project.name, count: project.cardCount,
                                               detail: "版本 \(project.revision) · \(friendlyDate(project.updatedAt))")
                                }
                                .tint(.primary)
                                .disabled(openingProject)
                            }
                        }
                    } else {
                        Button { showsLogin = true } label: {
                            Label("登录以查看云端项目", systemImage: "person.crop.circle")
                        }
                    }
                } header: {
                    HStack {
                        Text("云端项目")
                        Spacer()
                        if store.isBusy || openingProject { ProgressView() }
                    }
                } footer: {
                    if !store.authenticated {
                        Text("可以先在本机编辑。登录后，将项目保存到云端即可跨设备继续。")
                    }
                }

                if let error = workspaceError ?? store.error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                            .font(.subheadline)
                    }
                }
            }
            .navigationTitle("我的项目")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if store.authenticated {
                        Menu {
                            Text(store.username)
                            Button("刷新项目", systemImage: "arrow.clockwise") {
                                Task { await store.refreshProjects() }
                            }
                            Button("退出登录", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                                Task { await store.logout() }
                            }
                        } label: { Image(systemName: "person.crop.circle") }
                        .accessibilityLabel("账户")
                    } else {
                        Button("登录") { showsLogin = true }
                    }
                }
            }
            .refreshable {
                reloadDrafts()
                if store.authenticated { await store.refreshProjects() }
            }
            .task {
                reloadDrafts()
                if store.authenticated { await store.refreshProjects() }
            }
            .onChange(of: store.draftVersion) { _, _ in reloadDrafts() }
            .sheet(isPresented: $showsLogin) { LoginView() }
            .fullScreenCover(item: $selectedDraft, onDismiss: reloadDrafts) { draft in
                ProjectEditorView(draft: draft)
            }
            .confirmationDialog("移除本机草稿？", isPresented: Binding(
                get: { draftToRemove != nil },
                set: { if !$0 { draftToRemove = nil } }
            ), titleVisibility: .visible) {
                Button("移除本机草稿", role: .destructive) {
                    guard let draft = draftToRemove else { return }
                    do {
                        try store.removeDraft(draft.id)
                        reloadDrafts()
                    } catch { workspaceError = error.localizedDescription }
                    draftToRemove = nil
                }
            } message: {
                Text("云端项目会保留。这个草稿中尚未保存到云端的修改将被删除。")
            }
            .confirmationDialog("这个项目已有本机草稿", isPresented: Binding(
                get: { cloudProjectToOpen != nil },
                set: { if !$0 { cloudProjectToOpen = nil } }
            ), titleVisibility: .visible) {
                Button("继续本机草稿") {
                    if let project = cloudProjectToOpen {
                        selectedDraft = localDrafts.first(where: { $0.cloudID == project.id })
                    }
                    cloudProjectToOpen = nil
                }
                Button("载入云端内容") {
                    if let project = cloudProjectToOpen { fetchCloudProject(project) }
                    cloudProjectToOpen = nil
                }
            } message: {
                Text("载入云端内容会创建一份新的本机副本，现有草稿及未上传的修改会保留。")
            }
        }
    }

    private func reloadDrafts() { localDrafts = store.loadDrafts() }

    private func createProject() {
        let draft = ProjectDraft(id: UUID().uuidString, cloudID: nil, name: "未命名项目", revision: 0, project: .blank())
        do {
            try store.persistDraft(draft)
            selectedDraft = draft
        } catch { workspaceError = error.localizedDescription }
    }

    private func openCloudProject(_ project: ProjectSummary) {
        if localDrafts.contains(where: { $0.cloudID == project.id }) {
            cloudProjectToOpen = project
            return
        }
        fetchCloudProject(project)
    }

    private func fetchCloudProject(_ project: ProjectSummary) {
        openingProject = true
        workspaceError = nil
        Task {
            defer { openingProject = false }
            do {
                var draft = try await store.openProject(project.id)
                draft.id = UUID().uuidString
                try store.persistDraft(draft)
                selectedDraft = draft
            } catch { workspaceError = error.localizedDescription }
        }
    }

    private func friendlyDate(_ value: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

private struct ProjectRow: View {
    let name: String
    let count: Int
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "rectangle.stack")
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 5) {
                Text(name.isEmpty ? "未命名项目" : name).font(.headline).lineLimit(2)
                Text("\(count) 张卡片 · \(detail)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

struct LoginView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""
    @State private var password = ""
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("用户名", text: $username)
                        .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("login.username")
                    SecureField("密码", text: $password)
                        .textContentType(.password)
                        .accessibilityIdentifier("login.password")
                } footer: {
                    Text("使用 pic.zenohy.uk 的账户登录，访问同一份云端项目。")
                }
                if let error = store.error {
                    Section { Text(error).font(.subheadline).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        submitting = true
                        Task {
                            await store.login(username: username.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
                            submitting = false
                            if store.authenticated { dismiss() }
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if submitting { ProgressView() } else { Text("登录") }
                            Spacer()
                        }
                    }
                    .disabled(submitting || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty)
                    .accessibilityIdentifier("login.submit")
                }
            }
            .disabled(submitting)
            .navigationTitle("登录云端").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(submitting) } }
            .interactiveDismissDisabled(submitting)
        }
    }
}

struct ProjectEditorView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State var draft: ProjectDraft
    @State private var saving = false
    @State private var localError: String?
    @State private var cloudError: String?
    @State private var cloudMessage: String?
    @State private var showsPreview = false
    @State private var showsLogin = false
    @State private var pendingDeletion: Set<String> = []
    @State private var editingCardID: String?
    @State private var showsCopyConfirmation = false
    @State private var lastCloudSavedDraft: ProjectDraft?
    @State private var showsLibrary = false
    @State private var showsThemeEditor = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label(localError == nil ? "修改自动保存在本机" : "本机保存失败", systemImage: localError == nil ? "iphone" : "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(localError == nil ? Color.secondary : Color.red)
                    if let localError { Text(localError).font(.caption).foregroundStyle(.red) }
                    if let cloudError { Text(cloudError).font(.subheadline).foregroundStyle(.red) }
                    if let cloudMessage { Text(cloudMessage).font(.caption).foregroundStyle(.secondary) }
                    Button {
                        if store.authenticated { saveToCloud() } else { showsLogin = true }
                    } label: {
                        Label(saving ? "正在保存…" : "保存到云端", systemImage: "icloud.and.arrow.up")
                    }
                    .accessibilityIdentifier("editor.saveCloud")
                } footer: {
                    Text("云端保存成功后，其他设备可以打开最新版本。若发生版本冲突，请另存为新项目以保留修改。")
                }

                Section("项目") {
                    TextField("项目名称", text: $draft.name)
                        .accessibilityIdentifier("editor.projectName")
                    Picker("主题", selection: $draft.project.theme) {
                        ForEach(draft.project.themeOptions) { theme in
                            Text(theme.label).tag(theme.id)
                        }
                    }
                    .accessibilityIdentifier("editor.theme")
                    Button("复制并修改当前模板", systemImage: "paintpalette") {
                        showsThemeEditor = true
                    }
                    .accessibilityIdentifier("editor.copyTheme")
                    Button {
                        if store.authenticated { showsLibrary = true } else { showsLogin = true }
                    } label: {
                        Label("模板与历史版本", systemImage: "books.vertical")
                    }
                    .accessibilityIdentifier("editor.library")
                }

                Section("海报文字") {
                    LabeledContent("活动") { TextField("活动名称", text: $draft.project.eventLabel).multilineTextAlignment(.trailing) }
                    TextField("主标题", text: $draft.project.title, axis: .vertical)
                        .accessibilityIdentifier("editor.title")
                    TextField("副标题", text: $draft.project.subtitle, axis: .vertical)
                    TextField("底部署名", text: $draft.project.footerCreditText, axis: .vertical)
                }

                Section {
                    ForEach(Array(draft.project.games.enumerated()), id: \.element.id) { index, game in
                        Button {
                            editingCardID = game.id
                        } label: {
                            HStack(alignment: .center, spacing: 12) {
                                Text(String(index + 1)).font(.callout.monospacedDigit())
                                    .foregroundStyle(.secondary).frame(minWidth: 24)
                                Text(game.title.isEmpty ? "未命名卡片" : game.title)
                                    .foregroundStyle(.primary).lineLimit(2)
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 5)
                        }
                        .accessibilityIdentifier("editor.card.\(index)")
                    }
                    .onMove { source, destination in draft.project.games.move(fromOffsets: source, toOffset: destination) }
                    .onDelete { offsets in pendingDeletion = Set(offsets.map { draft.project.games[$0].id }) }
                    Button {
                        let card = GameCard()
                        draft.project.games.append(card)
                        editingCardID = card.id
                    } label: { Label("新增卡片", systemImage: "plus") }
                        .accessibilityIdentifier("editor.addCard")
                } header: {
                    HStack {
                        Text("卡片 · \(draft.project.games.count)")
                        Spacer()
                        EditButton().font(.caption)
                    }
                } footer: { Text("点击卡片编辑文字和图片。点“编辑”可以拖动排序，向左滑动可以删除。") }

                Section("排版") {
                    Toggle("自动填满页面", isOn: $draft.project.fillEmptySpace)
                    Toggle("后续页面紧凑排版", isOn: $draft.project.compactFollowupPages)
                    Toggle("显示卡片说明", isOn: $draft.project.showGameInfo)
                }
            }
            .disabled(saving)
            .navigationTitle(draft.name.isEmpty ? "未命名项目" : draft.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("完成") {
                        if persistLocally() { dismiss() }
                    }.disabled(saving)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("预览", systemImage: "eye") { showsPreview = true }
                        .disabled(saving)
                        .accessibilityIdentifier("editor.preview")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("另存为云端新项目", systemImage: "doc.on.doc") {
                            if store.authenticated { showsCopyConfirmation = true } else { showsLogin = true }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                    .disabled(saving)
                    .accessibilityLabel("更多项目操作")
                }
            }
            .navigationDestination(item: $editingCardID) { id in
                if draft.project.games.contains(where: { $0.id == id }) {
                    CardEditorView(card: Binding(
                        get: { draft.project.games.first(where: { $0.id == id }) ?? GameCard() },
                        set: { card in
                            var cards = draft.project.games
                            guard let index = cards.firstIndex(where: { $0.id == id }) else { return }
                            cards[index] = card
                            draft.project.games = cards
                        }
                    ))
                } else {
                    ContentUnavailableView("卡片已移除", systemImage: "rectangle.slash")
                }
            }
            .sheet(isPresented: $showsPreview) {
                NavigationStack {
                    PosterPreviewView(project: draft.project.jsonValue())
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { showsPreview = false } } }
                }
            }
            .sheet(isPresented: $showsLogin) { LoginView() }
            .sheet(isPresented: $showsLibrary) { ProjectLibraryView(store: store, draft: $draft) }
            .sheet(isPresented: $showsThemeEditor) { ThemeEditorView(project: $draft.project) }
            .confirmationDialog("删除所选卡片？", isPresented: Binding(
                get: { !pendingDeletion.isEmpty },
                set: { if !$0 { pendingDeletion = [] } }
            ), titleVisibility: .visible) {
                Button("删除 \(pendingDeletion.count) 张卡片", role: .destructive) {
                    draft.project.games.removeAll { pendingDeletion.contains($0.id) }
                    pendingDeletion = []
                }
            } message: { Text("卡片中的文字和图片将从当前项目移除。") }
            .confirmationDialog("另存为新项目？", isPresented: $showsCopyConfirmation, titleVisibility: .visible) {
                Button("创建云端副本") { saveToCloud(asCopy: true) }
            } message: { Text("当前内容会保存为独立云端项目，之后的修改将保存到这个新项目。") }
            .interactiveDismissDisabled(saving || localError != nil)
            .task(id: draft) {
                if lastCloudSavedDraft != draft { cloudMessage = nil }
                do { try await Task.sleep(for: .milliseconds(600)) }
                catch { return }
                guard !Task.isCancelled else { return }
                persistLocally()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { persistLocally() }
            }
            .onDisappear { persistLocally() }
        }
    }

    @discardableResult
    private func persistLocally() -> Bool {
        do {
            try store.persistDraft(draft)
            localError = nil
            return true
        } catch {
            localError = "未能保存本机草稿：\(error.localizedDescription)"
            return false
        }
    }

    private func saveToCloud(asCopy: Bool = false) {
        guard !saving, persistLocally() else { return }
        saving = true
        cloudError = nil
        cloudMessage = nil
        Task {
            defer { saving = false }
            do {
                draft = try await store.saveDraft(draft, asCopy: asCopy)
                lastCloudSavedDraft = draft
                persistLocally()
                cloudMessage = "已保存到云端 · 版本 \(draft.revision)"
            } catch {
                cloudError = "未能确认云端保存结果，修改仍保存在本机。\(error.localizedDescription)"
            }
        }
    }
}
