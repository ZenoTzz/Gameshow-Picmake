import SwiftUI

@MainActor
struct IGDBImagePickerView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let onSelect: @MainActor (IGDBImportResult) -> Bool
    @State private var query: String
    @State private var games: [IGDBGame]
    @State private var path: [IGDBGame]
    @State private var loading = false
    @State private var searched = false
    @State private var errorMessage: String?
    @State private var retry = 0

    init(query: String, games: [IGDBGame] = [], selectedGame: IGDBGame? = nil,
         onSelect: @escaping @MainActor (IGDBImportResult) -> Bool) {
        _query = State(initialValue: query)
        _games = State(initialValue: games)
        _path = State(initialValue: selectedGame.map { [$0] } ?? [])
        self.onSelect = onSelect
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    TextField("游戏名称，也可以尝试英文名", text: $query)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .accessibilityIdentifier("igdb.query")
                } footer: {
                    Text("这里的搜索词不会修改卡片标题。先确认游戏及年份，再选择图片。")
                }
                if !store.authenticated {
                    ContentUnavailableView("请先登录", systemImage: "person.crop.circle",
                                           description: Text("返回项目，使用网站账号登录后即可搜索游戏图片。"))
                } else if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.secondary)
                        Button("重试") { retry += 1 }
                    }
                } else if !IGDBSupport.validQuery(query) {
                    Text("请输入 2–120 个字符的游戏名称。")
                        .foregroundStyle(.secondary)
                } else {
                    Section {
                        ForEach(games) { game in
                            NavigationLink(value: game) {
                                IGDBGameRow(game: game)
                            }
                        }
                        if loading { ProgressView("正在匹配游戏…") }
                        if searched && games.isEmpty && !loading {
                            ContentUnavailableView("没有找到匹配游戏", systemImage: "magnifyingglass",
                                                   description: Text("可以试试英文名、简称，或去掉副标题。中文名称在 IGDB 中可能尚未收录。"))
                        }
                    } header: {
                        Text("选择游戏")
                    } footer: {
                        Text("游戏与图片资料来自 IGDB。")
                    }
                }
            }
            .navigationTitle("搜索游戏图片")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } }
            }
            .navigationDestination(for: IGDBGame.self) { game in
                IGDBGalleryView(game: game, onSelect: onSelect, closeLibrary: { dismiss() })
            }
            .task(id: "\(query)|\(store.authenticated)|\(retry)") { await search() }
        }
    }

    private func search() async {
        let term = IGDBSupport.query(query)
        games = []
        searched = false
        errorMessage = nil
        loading = false
        guard store.authenticated, IGDBSupport.validQuery(term) else { return }
        do {
            try await Task.sleep(for: .milliseconds(700))
            try Task.checkCancellation()
            loading = true
            guard try await store.api.igdbConfigured() else {
                guard !Task.isCancelled, IGDBSupport.query(query) == term else { return }
                loading = false
                errorMessage = "搜图服务尚未配置，请稍后再试。"
                return
            }
            let values = try await store.api.igdbSearch(query: term)
            guard !Task.isCancelled, IGDBSupport.query(query) == term, store.authenticated else { return }
            games = values
            searched = true
            loading = false
        } catch {
            guard !Task.isCancelled, IGDBSupport.query(query) == term else { return }
            loading = false
            errorMessage = error.localizedDescription
        }
    }
}

private struct IGDBGameRow: View {
    let game: IGDBGame
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IGDBRemoteImage(source: game.cover?.thumbnailUrl)
                .frame(width: 45, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: 5))
            VStack(alignment: .leading, spacing: 4) {
                Text(game.name).font(.headline)
                if !game.detail.isEmpty {
                    Text(game.detail).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                }
                if let alternative = game.alternativeNames.first(where: { $0 != game.name }) {
                    Text(alternative).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 3)
    }
}

@MainActor
private struct IGDBGalleryView: View {
    @EnvironmentObject private var store: AppStore
    let game: IGDBGame
    let onSelect: @MainActor (IGDBImportResult) -> Bool
    let closeLibrary: @MainActor () -> Void
    @State private var images: [IGDBImage] = []
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var retry = 0
    @State private var chosenImage: IGDBImage?
    @State private var importing = false
    @State private var importTask: Task<Void, Never>?
    @State private var requestID = UUID()
    @State private var importError: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(game.name).font(.title2.bold())
                if !game.detail.isEmpty { Text(game.detail).font(.subheadline).foregroundStyle(.secondary) }
                if loading { ProgressView("正在加载图库…").frame(maxWidth: .infinity) }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.secondary)
                    Button("重新加载") { retry += 1 }
                }
                if !loading && images.isEmpty && errorMessage == nil {
                    ContentUnavailableView("暂无可用图片", systemImage: "photo.on.rectangle.angled",
                                           description: Text("可以返回选择其他版本，或从相册添加图片。"))
                }
                ForEach(IGDBImageKind.allCases, id: \.self) { kind in
                    let items = images.filter { $0.kind == kind }
                    if !items.isEmpty {
                        Text(kind.label).font(.headline)
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            ForEach(items, id: \.identity) { image in
                                Button {
                                    importError = nil
                                    chosenImage = image
                                } label: {
                                    IGDBRemoteImage(source: image.thumbnailUrl)
                                        .aspectRatio(kind == .cover ? 0.75 : 16.0 / 9.0, contentMode: .fit)
                                        .clipShape(RoundedRectangle(cornerRadius: 9))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("查看\(kind.label) \(items.firstIndex(of: image).map { $0 + 1 } ?? 1)")
                            }
                        }
                    }
                }
                Text("图片资料：IGDB").font(.caption).foregroundStyle(.secondary)
            }
            .padding()
        }
        .navigationTitle("选择图片")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(game.id)|\(retry)|\(store.authenticated)") { await load() }
        .onDisappear { cancelImport() }
        .sheet(item: $chosenImage, onDismiss: cancelImport) { image in
            NavigationStack {
                VStack(spacing: 16) {
                    IGDBRemoteImage(source: image.previewUrl)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    if let width = image.width, let height = image.height {
                        Text("\(image.kind.label) · \(width) × \(height)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let importError { Text(importError).font(.footnote).foregroundStyle(.red) }
                    Button { use(image) } label: {
                        HStack {
                            if importing { ProgressView().tint(.white) }
                            Text(importing ? "正在导入…" : "使用这张图片")
                        }.frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(importing || !store.authenticated)
                    .accessibilityIdentifier("igdb.useImage")
                }
                .padding()
                .navigationTitle(image.kind.label)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("返回图库") {
                            cancelImport()
                            chosenImage = nil
                        }
                    }
                }
            }
        }
    }

    private func load() async {
        loading = true
        errorMessage = nil
        images = []
        guard store.authenticated else {
            loading = false
            errorMessage = "请返回项目，使用网站账号重新登录。"
            return
        }
        do {
            let gallery = try await store.api.igdbImages(gameID: game.id)
            guard !Task.isCancelled, store.authenticated else { return }
            guard gallery.game.id == game.id else { throw CloudError(status: 0, message: "图库与所选游戏不一致，请重试。") }
            images = gallery.images
            loading = false
        } catch {
            guard !Task.isCancelled else { return }
            loading = false
            errorMessage = error.localizedDescription
        }
    }

    private func cancelImport() {
        importTask?.cancel()
        importTask = nil
        requestID = UUID()
        importing = false
    }

    private func use(_ image: IGDBImage) {
        guard !importing, store.authenticated else { return }
        cancelImport()
        let request = requestID
        importing = true
        importError = nil
        importTask = Task {
            defer { if requestID == request { importing = false } }
            do {
                let result = try await store.api.igdbImport(gameID: game.id, image: image)
                guard !Task.isCancelled, requestID == request, chosenImage == image, store.authenticated else { return }
                guard onSelect(result) else {
                    importError = "卡片图片已发生变化，请关闭搜图后重新选择。"
                    return
                }
                closeLibrary()
            } catch {
                guard !Task.isCancelled, requestID == request else { return }
                importError = error.localizedDescription
            }
        }
    }
}

private struct IGDBRemoteImage: View {
    let source: String?
    var body: some View {
        AsyncImage(url: source.flatMap(IGDBSupport.cdnURL)) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFit()
            case .failure: placeholder
            case .empty:
                ZStack {
                    Color.secondary.opacity(0.08)
                    if source.flatMap(IGDBSupport.cdnURL) != nil { ProgressView() }
                    else { Image(systemName: "photo").foregroundStyle(.secondary) }
                }
            @unknown default: placeholder
            }
        }
    }
    private var placeholder: some View {
        ZStack {
            Color.secondary.opacity(0.08)
            Image(systemName: "photo").foregroundStyle(.secondary)
        }
    }
}
