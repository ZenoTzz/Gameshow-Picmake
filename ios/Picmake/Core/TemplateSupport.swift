import Foundation

extension ProjectDocument {
    private static let appearanceFields = ["fillEmptySpace", "compactFollowupPages", "infoFontSize", "infoFontWeight", "posterFontFamily", "headerFontFamily", "gameTitleFontFamily", "metadataFontFamily", "infoFontFamily", "creditFontFamily", "footerLogoImage"]
    mutating func copyTheme(name: String? = nil) throws {
        guard let source = raw["customThemes"]?.object[theme] ?? ThemeCatalog.definitions[theme] else { throw CloudError(status: 0, message: "找不到当前模板定义。") }
        let previous = theme, id = "custom_" + UUID().uuidString.lowercased()
        var definition = source
        definition["id"] = .string(id)
        definition["label"] = .string(name ?? ((source["label"].string ?? "模板") + " 副本"))
        if !previous.hasPrefix("custom_") { definition["baseThemeId"] = .string(previous) }
        var custom = raw["customThemes"] ?? .object([:]); custom[id] = definition; raw["customThemes"] = custom
        let text: JSONValue = .object(["eventLabel": .string(eventLabel), "title": .string(title), "subtitle": .string(subtitle)])
        for (field, fallback) in [("themeText", text), ("logoImages", .string("")), ("logoPositions", .object(["x": .number(72), "y": .number(72)])), ("logoScales", .number(100))] {
            var all = raw[field] ?? .object([:]); all[id] = all.object[previous] ?? fallback; raw[field] = all
        }
        theme = id
    }
    func applyingTemplate(_ template: ProjectDocument) throws -> ProjectDocument {
        var copied = template; try copied.copyTheme(name: template.themeOptions.first { $0.id == template.theme }?.label)
        var result = self
        let id = copied.theme
        for field in Self.appearanceFields { if let value = copied.raw[field] { result.raw[field] = value } }
        for field in ["customThemes", "logoImages", "logoPositions", "logoScales"] {
            var all = result.raw[field] ?? .object([:]); all[id] = copied.raw[field]?[id] ?? .null; result.raw[field] = all
        }
        let text: JSONValue = .object(["eventLabel": .string(eventLabel), "title": .string(title), "subtitle": .string(subtitle)])
        var texts = result.raw["themeText"] ?? .object([:]); texts[id] = text; result.raw["themeText"] = texts; result.theme = id
        return result
    }
    func templateSnapshot(name: String) throws -> ProjectDocument {
        var copy = self; try copy.copyTheme(name: name)
        var result = ProjectDocument.blank(); result.theme = copy.theme
        for field in Self.appearanceFields { if let value = copy.raw[field] { result.raw[field] = value } }
        for field in ["customThemes", "themeText", "logoImages", "logoPositions", "logoScales"] { result.raw[field] = .object([copy.theme: copy.raw[field]?[copy.theme] ?? .null]) }
        result.games = []; return result
    }
}
