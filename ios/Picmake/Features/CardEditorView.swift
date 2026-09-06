import SwiftUI
import PhotosUI

@MainActor
struct CardEditorView: View {
    @Binding var card: GameCard
    @EnvironmentObject private var store: AppStore

    @State private var selectedPhoto: PhotosPickerItem?
    @State private var photoTask: Task<Void, Never>?
    @State private var photoRequestID = UUID()
    @State private var isImporting = false
    @State private var imageError: String?
    @State private var preview: CGImage?
    @State private var previewFailed = false
    @State private var customPlatform = ""
    @State private var confirmsImageRemoval = false
    @State private var matchedGames: [IGDBGame] = []
    @State private var matchMessage: String?
    @State private var matching = false
    @State private var igdbPicker: IGDBPickerRequest?
    @FocusState private var focusedField: Field?

    private enum Field: Hashable { case title, date, info, customPlatform }
    private let platformOptions = ["PS5", "XBOX Series", "Switch", "Switch 2", "PC", "Mac", "移动端", "iOS", "Android"]

    private struct IGDBPickerRequest: Identifiable {
        let id = UUID()
        let cardID: String
        let imageRequestID: UUID
        let previousImage: String
        let query: String
        let games: [IGDBGame]
        let selectedGame: IGDBGame?
    }

    var body: some View {
        let photoLabel = card.image.isEmpty ? "从相册选择图片" : "替换图片"
        Form {
            Section("卡片标题") {
                TextField("游戏或内容名称", text: $card.title, axis: .vertical)
                    .accessibilityIdentifier("card.title")
                    .lineLimit(1...4)
                    .focused($focusedField, equals: .title)
                    .accessibilityLabel("卡片标题")
            }

            Section {
                imagePreview
                PhotosPicker(selection: $selectedPhoto, matching: .images, photoLibrary: .shared()) {
                    Label(photoLabel, systemImage: "photo.badge.plus")
                }
                if store.authenticated {
                    Button { openIGDB() } label: {
                        Label("搜索游戏图片", systemImage: "magnifyingglass")
                    }
                    .accessibilityIdentifier("card.searchImages")
                    if matching {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("正在匹配游戏…").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(matchedGames.prefix(3)) { game in
                        Button { openIGDB(game: game) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(game.name).font(.subheadline)
                                if !game.detail.isEmpty {
                                    Text(game.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                        }
                        .accessibilityLabel("查看 \(game.name) 的图片，\(game.detail)")
                    }
                    if let matchMessage {
                        Text(matchMessage).font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Text("返回项目，使用网站账号登录后可按游戏名称搜索图片。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if card.raw["imageSource"]?["provider"].string == "igdb" {
                    Text("图片资料：IGDB · \(card.raw["imageSource"]?["gameName"].string ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if isImporting {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("正在处理图片…").foregroundStyle(.secondary)
                    }
                }
                if let imageError {
                    Text(imageError).font(.footnote).foregroundStyle(.red)
                        .accessibilityLabel("图片错误：\(imageError)")
                }
                if !card.image.isEmpty {
                    Button("移除图片", role: .destructive) { confirmsImageRemoval = true }
                }
            } header: {
                Text("卡片图片")
            } footer: {
                Text("照片会缩小至最长边 2400 像素后保存。下方展示完整图片，海报中的裁切以预览为准。")
            }

            Section {
                Toggle("显示发售日期", isOn: $card.showDate)
                    .accessibilityIdentifier("card.showDate")
                if card.showDate {
                    TextField("例如：2026 年 10 月 / 待定", text: $card.date, axis: .vertical)
                        .focused($focusedField, equals: .date)
                        .accessibilityLabel("发售日期")
                }
                Toggle("显示平台", isOn: $card.showPlatforms)
                    .accessibilityIdentifier("card.showPlatforms")
            } header: {
                Text("本卡片显示内容")
            } footer: {
                Text("关闭后保留已经填写的内容，仅在这张卡片的海报预览与导出中隐藏。")
            }

            if card.showPlatforms {
                Section("平台 · 可多选") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
                        ForEach(allPlatforms, id: \.self) { platform in
                            platformButton(platform)
                        }
                    }
                    .padding(.vertical, 4)
                    HStack {
                        TextField("其他平台", text: $customPlatform)
                            .focused($focusedField, equals: .customPlatform)
                            .submitLabel(.done)
                            .onSubmit(addCustomPlatform)
                            .accessibilityLabel("自定义平台")
                        Button("添加", action: addCustomPlatform)
                            .buttonStyle(.borderless)
                            .disabled(customPlatform.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }

            Section {
                TextField("价格、试玩、发售窗口或其他说明", text: $card.info, axis: .vertical)
                    .lineLimit(6...16)
                    .focused($focusedField, equals: .info)
                    .accessibilityLabel("关键信息")
            } header: {
                Text("关键信息")
            } footer: {
                Text("支持换行。编辑后可返回项目查看整张海报的排版。")
            }
        }
        .navigationTitle("编辑卡片")
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("完成") { focusedField = nil }
            }
        }
        .onChange(of: selectedPhoto) { _, photo in importPhoto(photo) }
        .onChange(of: card.id) { _, _ in
            cancelPhotoImport()
            selectedPhoto = nil
            customPlatform = ""
            imageError = nil
            focusedField = nil
            igdbPicker = nil
            matchedGames = []
            matchMessage = nil
        }
        .onDisappear { cancelPhotoImport() }
        .task(id: card.image) { await loadPreview() }
        .task(id: "\(card.id)|\(card.title)|\(store.authenticated)") { await matchGameTitle() }
        .sheet(item: $igdbPicker) { request in
            IGDBImagePickerView(query: request.query, games: request.games, selectedGame: request.selectedGame) { result in
                guard igdbPicker?.id == request.id, card.id == request.cardID,
                      photoRequestID == request.imageRequestID, card.image == request.previousImage else { return false }
                var updated = card
                updated.image = result.dataUrl
                updated.raw["imageSource"] = result.source.jsonValue
                card = updated
                imageError = nil
                return true
            }
        }
        .confirmationDialog("移除这张卡片的图片？", isPresented: $confirmsImageRemoval, titleVisibility: .visible) {
            Button("移除图片", role: .destructive) {
                cancelPhotoImport()
                selectedPhoto = nil
                card.image = ""
                card.raw.removeValue(forKey: "imageSource")
                imageError = nil
            }
            Button("取消", role: .cancel) { }
        }
    }

    @ViewBuilder
    private var imagePreview: some View {
        if let preview {
            Image(decorative: preview, scale: 1)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: 240)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .accessibilityLabel("卡片图片预览")
        } else if !card.image.isEmpty {
            VStack(spacing: 8) {
                if previewFailed {
                    Image(systemName: "photo.badge.exclamationmark")
                    Text("图片暂时无法预览，可重新选择图片")
                } else {
                    ProgressView()
                    Text("正在加载图片…")
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 110)
        }
    }

    private var allPlatforms: [String] {
        var result = platformOptions
        for platform in card.platforms where !result.contains(where: { $0.caseInsensitiveCompare(platform) == .orderedSame }) {
            result.append(platform)
        }
        return result
    }

    private func containsPlatform(_ platform: String) -> Bool {
        card.platforms.contains { $0.caseInsensitiveCompare(platform) == .orderedSame }
    }

    private func platformButton(_ platform: String) -> some View {
        let selected = containsPlatform(platform)
        return Button {
            if selected {
                card.platforms.removeAll { $0.caseInsensitiveCompare(platform) == .orderedSame }
            } else {
                card.platforms.append(platform)
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                Text(platform).lineLimit(2)
            }
            .font(.subheadline)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal, 6)
            .background(selected ? Color.accentColor.opacity(0.12) : Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(platform)
        .accessibilityValue(selected ? "已选择" : "未选择")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func addCustomPlatform() {
        let value = customPlatform.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        if !containsPlatform(value) { card.platforms.append(value) }
        customPlatform = ""
    }

    private func cancelPhotoImport() {
        photoTask?.cancel()
        photoTask = nil
        photoRequestID = UUID()
        isImporting = false
    }

    private func importPhoto(_ photo: PhotosPickerItem?) {
        guard let photo else { return }
        igdbPicker = nil
        cancelPhotoImport()
        let requestID = photoRequestID
        let cardID = card.id
        let previousImage = card.image
        imageError = nil
        isImporting = true
        photoTask = Task {
            defer {
                if photoRequestID == requestID {
                    isImporting = false
                    selectedPhoto = nil
                }
            }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self) else {
                    throw CardPhotoSupport.PhotoError.unavailable
                }
                try Task.checkCancellation()
                let conversion = Task.detached(priority: .userInitiated) {
                    try CardPhotoSupport.jpegDataURL(from: data)
                }
                let dataURL = try await withTaskCancellationHandler {
                    try await conversion.value
                } onCancel: {
                    conversion.cancel()
                }
                try Task.checkCancellation()
                guard card.id == cardID, photoRequestID == requestID, card.image == previousImage else { return }
                card.image = dataURL
                card.raw.removeValue(forKey: "imageSource")
            } catch is CancellationError {
                // A different selection or leaving the editor cancels this request.
            } catch {
                guard card.id == cardID, photoRequestID == requestID, !Task.isCancelled else { return }
                imageError = error.localizedDescription
            }
        }
    }

    private func openIGDB(game: IGDBGame? = nil) {
        guard store.authenticated else { return }
        cancelPhotoImport()
        selectedPhoto = nil
        focusedField = nil
        igdbPicker = IGDBPickerRequest(cardID: card.id, imageRequestID: photoRequestID,
                                      previousImage: card.image, query: card.title,
                                      games: matchedGames, selectedGame: game)
    }

    private func matchGameTitle() async {
        let cardID = card.id
        let query = IGDBSupport.query(card.title)
        matchedGames = []
        matchMessage = nil
        matching = false
        guard store.authenticated, IGDBSupport.validQuery(query) else { return }
        do {
            try await Task.sleep(for: .milliseconds(700))
            try Task.checkCancellation()
            matching = true
            guard try await store.api.igdbConfigured() else {
                guard !Task.isCancelled, card.id == cardID, IGDBSupport.query(card.title) == query else { return }
                matching = false
                matchMessage = "搜图服务尚未配置。"
                return
            }
            let games = try await store.api.igdbSearch(query: query)
            guard !Task.isCancelled, card.id == cardID, IGDBSupport.query(card.title) == query, store.authenticated else { return }
            matching = false
            matchedGames = games
            matchMessage = games.isEmpty ? "未找到匹配游戏，可点搜图尝试英文名或简称。" : "点选游戏查看图片；只有选图后才会替换当前图片。"
        } catch {
            guard !Task.isCancelled, card.id == cardID, IGDBSupport.query(card.title) == query else { return }
            matching = false
            matchMessage = "暂时无法匹配游戏，可点搜图重试。\(error.localizedDescription)"
        }
    }

    private func loadPreview() async {
        let source = card.image
        preview = nil
        previewFailed = false
        guard !source.isEmpty else { return }
        do {
            let loading = Task.detached(priority: .userInitiated) {
                let data = try await CardPhotoSupport.imageData(for: source)
                try Task.checkCancellation()
                return CardPhotoSupport.previewImage(from: data)
            }
            let image = try await withTaskCancellationHandler {
                try await loading.value
            } onCancel: {
                loading.cancel()
            }
            guard !Task.isCancelled, card.image == source else { return }
            preview = image
            previewFailed = image == nil
        } catch {
            guard !Task.isCancelled, card.image == source else { return }
            previewFailed = true
        }
    }
}
