import XCTest
@testable import Picmake

final class TemplateTests: XCTestCase {
    func testCopyAndApplyingTemplateKeepPrivateContentSeparate() throws {
        let original = try ProjectDocument(raw: [
            "theme": .string("custom_source"),
            "games": .array([.object(["id": .string("one"), "title": .string("私有游戏"), "info": .string("未发布内容")])]),
            "customThemes": .object([
                "custom_source": .object(["id": .string("custom_source"), "label": .string("我的设计"), "baseThemeId": .string("nintendoDirectSoft"), "card": .string("#f2f2f2"), "styleOverrides": .array([.string("card")])]),
                "custom_other": .object(["id": .string("custom_other"), "label": .string("另一私有设计")])
            ]),
            "themeText": .object(["custom_source": .object(["title": .string("原始主标题")])]),
            "futureSetting": .string("preserve")
        ])
        let snapshot = try original.templateSnapshot(name: "共享外观")
        XCTAssertEqual(snapshot.games, [])
        XCTAssertEqual(snapshot.raw["customThemes"]?.object.count, 1)
        XCTAssertNil(snapshot.raw["futureSetting"])
        XCTAssertEqual(snapshot.raw["customThemes"]?[snapshot.theme]["baseThemeId"], .string("nintendoDirectSoft"))
        var other = ProjectDocument.blank(); var card = GameCard(); card.title = "另一项目"; other.games = [card]; other.title = "另一标题"
        let applied = try other.applyingTemplate(snapshot)
        XCTAssertEqual(applied.games, other.games)
        XCTAssertEqual(applied.title, "另一标题")
        XCTAssertNotEqual(applied.theme, snapshot.theme)
        XCTAssertEqual(original.theme, "custom_source")
        XCTAssertEqual(original.title, "原始主标题")
    }
    @MainActor func testDraftAtomicRoundTripKeepsAssetAndRevision() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let store = AppStore(directory: folder)
        var document = ProjectDocument.blank(); var card = GameCard()
        card.showDate = false; card.showPlatforms = false; card.image = "data:image/png;base64,aGVsbG8="; document.games = [card]
        let draft = ProjectDraft(id: UUID().uuidString, cloudID: "legacy", name: "手机草稿", revision: 8, project: document)
        try store.persistDraft(draft)
        let reopened = AppStore(directory: folder).loadDrafts()
        XCTAssertEqual(reopened, [draft])
        XCTAssertThrowsError(try store.removeDraft("../outside"))
        XCTAssertEqual(store.loadDrafts().count, 1)
        try store.removeDraft(draft.id)
        XCTAssertEqual(store.loadDrafts().count, 0)
    }
}
