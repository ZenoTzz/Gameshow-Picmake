import Foundation

indirect enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    var object: [String: JSONValue] { if case .object(let v) = self { return v }; return [:] }
    var array: [JSONValue] { if case .array(let v) = self { return v }; return [] }
    var string: String? { if case .string(let v) = self { return v }; return nil }
    var bool: Bool? { if case .bool(let v) = self { return v }; return nil }
    var number: Double? { if case .number(let v) = self { return v }; return nil }
    subscript(_ key: String) -> JSONValue { get { object[key] ?? .null } set { var o = object; o[key] = newValue; self = .object(o) } }
}

struct GameCard: Codable, Identifiable, Equatable, Sendable {
    var raw: [String: JSONValue]
    init() { raw = ["id": .string(UUID().uuidString.lowercased()), "title": .string("新卡片"), "date": .string("待公布"), "platforms": .array([]), "info": .string(""), "image": .string(""), "showDate": .bool(true), "showPlatforms": .bool(true)] }
    init(raw: [String: JSONValue]) { self.raw = raw; if raw["id"]?.string?.isEmpty != false { self.raw["id"] = .string(UUID().uuidString.lowercased()) } }
    init(from decoder: Decoder) throws { self.init(raw: try [String: JSONValue](from: decoder)) }
    func encode(to encoder: Encoder) throws { try raw.encode(to: encoder) }
    var id: String { get { raw["id"]?.string ?? "" } set { raw["id"] = .string(newValue) } }
    var title: String { get { raw["title"]?.string ?? "" } set { raw["title"] = .string(newValue) } }
    var date: String { get { raw["date"]?.string ?? "" } set { raw["date"] = .string(newValue) } }
    var info: String { get { raw["info"]?.string ?? "" } set { raw["info"] = .string(newValue) } }
    var image: String { get { raw["image"]?.string ?? "" } set { raw["image"] = .string(newValue) } }
    var platforms: [String] { get { raw["platforms"]?.array.compactMap(\.string) ?? [] } set { raw["platforms"] = .array(newValue.map(JSONValue.string)) } }
    var showDate: Bool { get { raw["showDate"]?.bool ?? true } set { raw["showDate"] = .bool(newValue) } }
    var showPlatforms: Bool { get { raw["showPlatforms"]?.bool ?? true } set { raw["showPlatforms"] = .bool(newValue) } }
}

struct ThemeOption: Identifiable, Hashable { let id: String; let label: String }
enum ThemeCatalog {
    static let definitions: [String: JSONValue] = {
        guard let url = Bundle.main.url(forResource: "themes", withExtension: "json"), let data = try? Data(contentsOf: url), let values = try? JSONDecoder().decode([String: JSONValue].self, from: data) else { return [:] }
        return values
    }()
    static var items: [ThemeOption] { definitions.map { ThemeOption(id: $0.key, label: $0.value["label"].string ?? $0.key) }.sorted { $0.label < $1.label } }
    static func text(_ theme: String) -> [String: JSONValue] {
        let event: String; let title: String
        switch theme {
        case "nintendoDirect", "nintendoDirectWarm": event = "Nintendo Direct"; title = "发布会重磅直面会"
        case "nintendoDirectSoft": event = "Nintendo Direct"; title = "发布会重点内容"
        case "summerGameFest": event = "Summer Game Fest"; title = "发布会重磅大作"
        case "gamescom2026": event = "gamescom 2026"; title = "ONL 重磅大作"
        case "xbox": event = "Xbox Showcase"; title = "发布会重磅首曝"
        default: event = "State of Play"; title = "发布会重磅大作"
        }
        return ["eventLabel": .string(event), "title": .string(title), "subtitle": .string("发售日期 / 登陆平台 / 关键信息速览")]
    }
}

struct ProjectDocument: Codable, Equatable, Sendable {
    var raw: [String: JSONValue]
    init(raw: [String: JSONValue]) throws {
        guard raw["theme"]?.string != nil, case .array(let games) = raw["games"], games.count <= 1000,
              raw["schemaVersion"]?.number ?? 2 <= 2 else { throw CloudError(status: 0, message: "项目格式或版本不受支持，请更新 App。") }
        self.raw = raw
        var seen = Set<String>()
        self.games = games.map { value in
            var card = GameCard(raw: value.object)
            if seen.contains(card.id) { card.id = UUID().uuidString.lowercased() }; seen.insert(card.id)
            return card
        }
        if raw["themeText"] == nil {
            var legacy = ThemeCatalog.text(theme)
            for field in ["eventLabel", "title", "subtitle"] { if let value = raw[field]?.string { legacy[field] = .string(value) } }
            self.raw["themeText"] = .object([theme: .object(legacy)])
        }
    }
    init(from decoder: Decoder) throws { try self.init(raw: [String: JSONValue](from: decoder)) }
    func encode(to encoder: Encoder) throws { try raw.encode(to: encoder) }
    static func blank() -> Self { try! Self(raw: ["schemaVersion": .number(2), "theme": .string("nintendoDirectSoft"), "games": .array([]), "fillEmptySpace": .bool(true)]) }
    func jsonValue() -> JSONValue { .object(raw) }
    var games: [GameCard] { get { raw["games"]?.array.map { GameCard(raw: $0.object) } ?? [] } set { raw["games"] = .array(newValue.map { .object($0.raw) }) } }
    var theme: String { get { raw["theme"]?.string ?? "stateOfPlay" } set { raw["theme"] = .string(newValue) } }
    private func text(_ key: String) -> String { raw["themeText"]?[theme][key].string ?? ThemeCatalog.text(theme)[key]?.string ?? "" }
    private mutating func setText(_ key: String, _ value: String) { var all = raw["themeText"] ?? .object([:]); var current = all[theme]; current[key] = .string(value); all[theme] = current; raw["themeText"] = all }
    var eventLabel: String { get { text("eventLabel") } set { setText("eventLabel", newValue) } }
    var title: String { get { text("title") } set { setText("title", newValue) } }
    var subtitle: String { get { text("subtitle") } set { setText("subtitle", newValue) } }
    var footerCreditText: String { get { raw["footerCreditText"]?.string ?? "信息整理" } set { raw["footerCreditText"] = .string(newValue) } }
    var fillEmptySpace: Bool { get { raw["fillEmptySpace"]?.bool ?? true } set { raw["fillEmptySpace"] = .bool(newValue) } }
    var compactFollowupPages: Bool { get { raw["compactFollowupPages"]?.bool ?? false } set { raw["compactFollowupPages"] = .bool(newValue) } }
    var showGameInfo: Bool { get { raw["showGameInfo"]?.bool ?? true } set { raw["showGameInfo"] = .bool(newValue) } }
    var themeOptions: [ThemeOption] { ThemeCatalog.items + (raw["customThemes"]?.object ?? [:]).map { ThemeOption(id: $0.key, label: $0.value["label"].string ?? "自定义模板") }.sorted { $0.label < $1.label } }
}

struct ProjectSummary: Decodable, Identifiable { let id: String; let name: String; let revision: Int; let cardCount: Int; let updatedAt: String }
struct ProjectDraft: Codable, Identifiable, Equatable {
    var id: String; var cloudID: String?; var name: String; var revision: Int; var project: ProjectDocument
    var creationRequestID: String? = nil
}
struct ProjectEnvelope: Decodable { let id: String?; let name: String?; let revision: Int; let project: JSONValue; let updatedAt: String? }
struct HistoryVersion: Decodable, Identifiable { var id: Int { revision }; let revision: Int; let updatedAt: String; let name: String?; let pinned: Bool }
struct TemplateSummary: Decodable, Identifiable { let id: String; let name: String; let revision: Int; let updatedAt: String }
struct CloudError: LocalizedError { let status: Int; let message: String; var errorDescription: String? { message } }
