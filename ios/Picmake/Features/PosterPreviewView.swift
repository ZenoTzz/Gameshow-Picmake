import SwiftUI
import WebKit
import UIKit

/// Native controls around the bundled website renderer; no website login or network access.
struct PosterPreviewView: View {
    let project: JSONValue
    @StateObject private var renderer = PosterRenderer()

    private var projectJSON: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(project),
              let value = String(data: data, encoding: .utf8) else { return "null" }
        return value
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { renderer.selectPage(renderer.page - 1) } label: {
                    Image(systemName: "chevron.left")
                }
                .accessibilityLabel("上一页")
                .disabled(!renderer.hasPreview || renderer.page == 0 || renderer.exporting)
                Spacer()
                Text("第 \(renderer.page + 1) / \(renderer.pageCount) 页")
                    .monospacedDigit()
                Spacer()
                Button { renderer.selectPage(renderer.page + 1) } label: {
                    Image(systemName: "chevron.right")
                }
                .accessibilityLabel("下一页")
                .disabled(!renderer.hasPreview || renderer.page + 1 >= renderer.pageCount || renderer.exporting)
            }
            .padding()
            ZStack {
                PosterWebView(renderer: renderer, projectJSON: projectJSON)
                if !renderer.hasPreview && renderer.error == nil {
                    ProgressView("正在排版…")
                        .padding(20)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            HStack {
                Text("双指缩放检查细节")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    renderer.exportPage()
                } label: {
                    if renderer.exporting { ProgressView() }
                    else { Label("分享当前页", systemImage: "square.and.arrow.up") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!renderer.hasPreview || renderer.exporting)
            }
            .padding()
        }
        .navigationTitle("海报预览")
        .navigationBarTitleDisplayMode(.inline)
        .alert("预览遇到问题", isPresented: Binding(
            get: { renderer.error != nil },
            set: { if !$0 { renderer.error = nil } }
        )) {
            Button("重试") { renderer.retry() }
            Button("关闭", role: .cancel) { renderer.error = nil }
        } message: { Text(renderer.error ?? "") }
        .sheet(item: $renderer.shareFile, onDismiss: { renderer.cleanExport() }) { file in
            PosterShareSheet(url: file.url)
                .presentationDetents([.medium, .large])
        }
    }
}

private struct PosterExportFile: Identifiable {
    let id = UUID()
    let url: URL
}

@MainActor
private final class PosterRenderer: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
    @Published var page = 0
    @Published var pageCount = 1
    @Published var hasPreview = false
    @Published var exporting = false
    @Published var error: String?
    @Published var shareFile: PosterExportFile?
    private weak var webView: WKWebView?
    private var resourceDirectory: URL?
    private var ready = false
    private var pendingJSON = ""
    private var submittedJSON = ""
    private var exportDirectory: URL?
    private var loadTimeout: Task<Void, Never>?

    func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.add(self, name: "picmake")
        configuration.userContentController.addUserScript(WKUserScript(source: """
            window.addEventListener('error', event => {
                window.webkit.messageHandlers.picmake.postMessage({type:'error',message:event.message || '渲染脚本加载失败'});
            });
            window.addEventListener('unhandledrejection', event => {
                window.webkit.messageHandlers.picmake.postMessage({type:'error',message:String(event.reason?.message || event.reason)});
            });
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = .secondarySystemBackground
        web.scrollView.backgroundColor = .secondarySystemBackground
        web.allowsLinkPreview = false
        webView = web
        guard let directory = Bundle.main.resourceURL?.appendingPathComponent("Renderer", isDirectory: true),
              FileManager.default.fileExists(atPath: directory.appendingPathComponent("index.html").path) else {
            error = "应用缺少海报渲染资源，请重新构建应用。"
            return web
        }
        resourceDirectory = directory.resolvingSymlinksInPath().standardizedFileURL
        web.loadFileURL(directory.appendingPathComponent("index.html"), allowingReadAccessTo: directory)
        loadTimeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(20))
            guard !Task.isCancelled, let self, !self.ready else { return }
            self.error = "海报渲染器加载超时，请重试。"
        }
        return web
    }

    func updateProject(_ json: String) {
        pendingJSON = json
        guard ready, json != submittedJSON else { return }
        submittedJSON = json
        hasPreview = false
        run("await window.picmakeRender(projectJSON)", arguments: ["projectJSON": json])
    }

    func retry() {
        error = nil
        submittedJSON = ""
        if ready { updateProject(pendingJSON) }
        else { webView?.reload() }
    }

    func selectPage(_ index: Int) {
        guard hasPreview, !exporting else { return }
        run("window.picmakeSelectPage(page)", arguments: ["page": index])
    }

    func exportPage() {
        guard hasPreview, !exporting else { return }
        exporting = true
        run("await window.picmakeExport()")
    }

    private func run(_ script: String, arguments: [String: Any] = [:]) {
        webView?.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { [weak self] result in
            if case .failure(let failure) = result {
                Task { @MainActor in
                    self?.error = failure.localizedDescription
                    self?.exporting = false
                }
            }
        }
    }

    private func isBundledURL(_ url: URL?) -> Bool {
        guard let url, url.isFileURL, let directory = resourceDirectory else { return false }
        return url.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(directory.path + "/")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "picmake", message.frameInfo.isMainFrame,
              isBundledURL(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            loadTimeout?.cancel()
            ready = true
            updateProject(pendingJSON)
        case "rendered":
            page = body["page"] as? Int ?? 0
            pageCount = max(1, body["pageCount"] as? Int ?? 1)
            hasPreview = true
            error = nil
        case "error":
            error = body["message"] as? String ?? "海报生成失败，请稍后重试。"
            exporting = false
        case "export":
            exporting = false
            receiveExport(body)
        default: break
        }
    }

    private func receiveExport(_ body: [String: Any]) {
        guard let dataURL = body["dataURL"] as? String,
              dataURL.hasPrefix("data:image/png;base64,"), dataURL.utf8.count < 100_000_000,
              let data = Data(base64Encoded: String(dataURL.dropFirst("data:image/png;base64,".count))),
              UIImage(data: data) != nil else {
            error = "导出图片无效，请重试。"
            return
        }
        do {
            cleanExport()
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("picmake-export-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            exportDirectory = directory
            let url = directory.appendingPathComponent("海报-第\(page + 1)页.png")
            try data.write(to: url, options: .atomic)
            shareFile = PosterExportFile(url: url)
        } catch { self.error = "无法保存导出图片：\(error.localizedDescription)" }
    }

    func cleanExport() {
        if let directory = exportDirectory { try? FileManager.default.removeItem(at: directory) }
        exportDirectory = nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.targetFrame?.isMainFrame == true && isBundledURL(navigationAction.request.url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        self.error = "无法加载海报预览：\(error.localizedDescription)"
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard isBundledURL(webView.url) else { return }
        // The document-start ready message can precede WK frame metadata on iOS.
        // A trusted main-frame handshake also makes initialization errors visible.
        webView.callAsyncJavaScript("return typeof window.picmakeRender === 'function'", arguments: [:], in: nil, in: .page) { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let value) where value as? Bool == true:
                    self.loadTimeout?.cancel()
                    self.ready = true
                    self.updateProject(self.pendingJSON)
                case .failure(let failure): self.error = "渲染器初始化失败：\(failure.localizedDescription)"
                default: self.error = "海报渲染脚本未能加载，请重新构建应用。"
                }
            }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false
        hasPreview = false
        exporting = false
        submittedJSON = ""
        error = "预览进程已停止，请重试；图片过多时可减少项目内容。"
    }
}

private struct PosterWebView: UIViewRepresentable {
    let renderer: PosterRenderer
    let projectJSON: String
    func makeUIView(context: Context) -> WKWebView { renderer.makeWebView() }
    func updateUIView(_ webView: WKWebView, context: Context) {
        Task { @MainActor in renderer.updateProject(projectJSON) }
    }
    static func dismantleUIView(_ webView: WKWebView, coordinator: ()) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "picmake")
        webView.stopLoading()
    }
}

private struct PosterShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
