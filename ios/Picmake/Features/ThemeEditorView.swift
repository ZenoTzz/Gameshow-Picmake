import SwiftUI
import UIKit

@MainActor
struct ThemeEditorView: View {
    @Binding var project: ProjectDocument
    @Environment(\.dismiss) private var dismiss
    @State private var editing: ProjectDocument
    @State private var original: ProjectDocument
    @State private var initializationError: String?
    @State private var saveError: String?
    @State private var showsPreview = false
    @FocusState private var editingName: Bool

    init(project: Binding<ProjectDocument>) {
        _project = project
        let source = project.wrappedValue
        _original = State(initialValue: source)
        var copy = source
        var failure: String?
        do { try copy.copyTheme() }
        catch { failure = error.localizedDescription }
        _editing = State(initialValue: copy)
        _initializationError = State(initialValue: failure)
    }

    private var definition: JSONValue {
        editing.raw["customThemes"]?[editing.theme] ?? ThemeCatalog.definitions[editing.theme] ?? .object([:])
    }

    private var trimmedName: String {
        (definition["label"].string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var validName: Bool { !trimmedName.isEmpty && trimmedName.count <= 100 }

    var body: some View {
        NavigationStack {
            Form {
                if let initializationError {
                    Section {
                        Label(initializationError, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                } else {
                    Section {
                        TextField("模板名称", text: Binding(
                            get: { definition["label"].string ?? "" },
                            set: { setField("label", .string($0), marksOverride: false) }
                        ))
                        .focused($editingName)
                        .accessibilityIdentifier("themeEditor.name")
                        if !validName {
                            Text(trimmedName.isEmpty ? "请填写模板名称。" : "模板名称最多 100 个字符。")
                                .font(.footnote).foregroundStyle(.red)
                        }
                    } header: {
                        Text("新模板名称")
                    } footer: {
                        Text("保存后切换到这个模板副本，原模板会保留。取消将放弃本次修改。")
                    }

                    Section("海报底色") {
                        colorRow("背景颜色", field: "bg", fallback: .black)
                    }

                    Section("卡片颜色") {
                        colorRow("卡片底色", field: "card", fallback: Color(white: 0.95))
                        colorRow("标题文字", field: "cardTitle", fallback: .white)
                        colorRow("正文文字", field: "cardText", fallback: .white)
                        colorRow("边框颜色", field: "cardBorder", fallback: .gray)
                        colorRow("编号底色", field: "cardNumberBg", fallback: .blue)
                    }

                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("边框宽度")
                                Spacer()
                                Text("\(Int(number("cardBorderWidth", fallback: 2))) px")
                                    .foregroundStyle(.secondary).monospacedDigit()
                            }
                            Slider(value: numberBinding("cardBorderWidth", fallback: 2, range: 0...8), in: 0...8, step: 1)
                                .accessibilityLabel("边框宽度")
                                .accessibilityValue("\(Int(number("cardBorderWidth", fallback: 2))) 像素")
                        }
                        .padding(.vertical, 4)
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("卡片暗色遮罩")
                                Spacer()
                                Text(number("cardOverlay", fallback: 0).formatted(.percent.precision(.fractionLength(0))))
                                    .foregroundStyle(.secondary).monospacedDigit()
                            }
                            Slider(value: numberBinding("cardOverlay", fallback: 0, range: 0...0.8), in: 0...0.8, step: 0.01)
                                .accessibilityLabel("卡片暗色遮罩")
                                .accessibilityValue(number("cardOverlay", fallback: 0).formatted(.percent.precision(.fractionLength(0))))
                        }
                        .padding(.vertical, 4)
                    } header: {
                        Text("边框与遮罩")
                    } footer: {
                        Text("遮罩会压暗卡片底色；0% 表示不添加遮罩。")
                    }

                    Section {
                        Button {
                            editingName = false
                            showsPreview = true
                        } label: {
                            Label("预览模板副本", systemImage: "eye")
                        }
                        .accessibilityIdentifier("themeEditor.preview")
                    } footer: {
                        Text("预览使用当前项目的文字与图片，可以检查整张海报效果。")
                    }
                }

                if let saveError {
                    Section {
                        Label(saveError, systemImage: "exclamationmark.triangle")
                            .font(.subheadline).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("复制并修改模板")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存", action: save)
                        .disabled(initializationError != nil || !validName)
                        .accessibilityIdentifier("themeEditor.save")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { editingName = false }
                }
            }
            .sheet(isPresented: $showsPreview) {
                NavigationStack {
                    PosterPreviewView(project: editing.jsonValue())
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("关闭") { showsPreview = false }
                            }
                        }
                }
            }
        }
    }

    private func colorRow(_ title: String, field: String, fallback: Color) -> some View {
        let raw = definition[field].string
        let solidColor = raw.flatMap(Self.parseColor)
        return VStack(alignment: .leading, spacing: 5) {
            ColorPicker(title, selection: Binding(
                get: { solidColor ?? fallback },
                set: { setField(field, .string(Self.cssColor($0))) }
            ), supportsOpacity: true)
            .accessibilityIdentifier("themeEditor.\(field)")
            if solidColor == nil {
                Text(raw == nil ? "当前沿用模板样式，选色后会替换。" : "当前样式原样保留，选色后会替换为单色。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
    }

    private func number(_ field: String, fallback: Double) -> Double {
        let value = definition[field].number ?? fallback
        return value.isFinite ? value : fallback
    }

    private func numberBinding(_ field: String, fallback: Double, range: ClosedRange<Double>) -> Binding<Double> {
        Binding(
            get: { min(range.upperBound, max(range.lowerBound, number(field, fallback: fallback))) },
            set: { setField(field, .number(min(range.upperBound, max(range.lowerBound, $0)))) }
        )
    }

    private func setField(_ field: String, _ value: JSONValue, marksOverride: Bool = true) {
        var updated = definition
        updated[field] = value
        if marksOverride {
            var overrides = updated["styleOverrides"].array.compactMap(\.string)
            if !overrides.contains(field) { overrides.append(field) }
            updated["styleOverrides"] = .array(overrides.map(JSONValue.string))
        }
        var themes = editing.raw["customThemes"] ?? .object([:])
        themes[editing.theme] = updated
        editing.raw["customThemes"] = themes
        saveError = nil
    }

    private func save() {
        guard initializationError == nil, validName else { return }
        guard project == original else {
            saveError = "当前项目已发生变化。请取消后重新打开模板编辑，避免覆盖新的修改。"
            return
        }
        setField("label", .string(trimmedName), marksOverride: false)
        project = editing
        dismiss()
    }

    // Reading a CSS value never writes back to the theme, so gradients remain intact.
    private static func parseColor(_ value: String) -> Color? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if text == "transparent" { return .clear }
        if text == "white" { return .white }
        if text == "black" { return .black }
        if text.hasPrefix("#") {
            var hex = String(text.dropFirst())
            if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard hex.count == 6 || hex.count == 8, let bits = UInt64(hex, radix: 16) else { return nil }
            let includesAlpha = hex.count == 8
            let red = Double((bits >> (includesAlpha ? 24 : 16)) & 255) / 255
            let green = Double((bits >> (includesAlpha ? 16 : 8)) & 255) / 255
            let blue = Double((bits >> (includesAlpha ? 8 : 0)) & 255) / 255
            let alpha = includesAlpha ? Double(bits & 255) / 255 : 1
            return Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
        }
        if (text.hasPrefix("rgb(") || text.hasPrefix("rgba(")), text.hasSuffix(")"), let start = text.firstIndex(of: "(") {
            let values = text[text.index(after: start)..<text.index(before: text.endIndex)]
                .split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            guard values.count == 3 || values.count == 4, values.allSatisfy(\.isFinite) else { return nil }
            return Color(.sRGB, red: min(255, max(0, values[0])) / 255,
                         green: min(255, max(0, values[1])) / 255,
                         blue: min(255, max(0, values[2])) / 255,
                         opacity: values.count == 4 ? min(1, max(0, values[3])) : 1)
        }
        return nil
    }

    private static func cssColor(_ color: Color) -> String {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 1
        UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        func byte(_ value: CGFloat) -> Int { Int((min(1, max(0, value)) * 255).rounded()) }
        if alpha < 0.999 {
            return String(format: "#%02X%02X%02X%02X", byte(red), byte(green), byte(blue), byte(alpha))
        }
        return String(format: "#%02X%02X%02X", byte(red), byte(green), byte(blue))
    }
}
