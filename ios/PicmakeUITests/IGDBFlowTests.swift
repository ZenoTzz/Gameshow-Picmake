import XCTest

final class IGDBFlowTests: XCTestCase {
    @MainActor func testGameImageSelectionPersistsWithoutChangingCardTitle() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "--igdb-demo", "--reset-demo"]
        app.launch()

        openDemoCard(in: app)
        let title = app.descendants(matching: .any).matching(identifier: "card.title").firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        let originalTitle = title.value as? String
        XCTAssertNotNil(originalTitle)
        let source = app.staticTexts["图片资料：IGDB · Super Mario Demo"]
        XCTAssertFalse(source.exists)

        // The fixture returns Mario for any title, exercising the automatic debounced match.
        let candidate = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "查看 Super Mario Demo 的图片")).firstMatch
        XCTAssertTrue(candidate.waitForExistence(timeout: 10))
        reveal(candidate, in: app)
        candidate.tap()
        let screenshot = app.buttons["查看截图 1"]
        XCTAssertTrue(screenshot.waitForExistence(timeout: 10))
        screenshot.tap()
        let useImage = app.buttons["igdb.useImage"]
        XCTAssertTrue(useImage.waitForExistence(timeout: 5))

        // Previewing alone must not apply an image; cancel it, then explicitly select it.
        app.navigationBars.buttons["返回图库"].tap()
        XCTAssertTrue(screenshot.waitForExistence(timeout: 5))
        screenshot.tap()
        XCTAssertTrue(useImage.waitForExistence(timeout: 5))
        useImage.tap()
        XCTAssertTrue(app.navigationBars["编辑卡片"].waitForExistence(timeout: 10))
        reveal(source, in: app)
        XCTAssertTrue(source.exists)
        XCTAssertEqual(title.value as? String, originalTitle)

        app.navigationBars["编辑卡片"].buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons["完成"].tap()
        app.terminate()
        app.launchArguments = ["--demo", "--igdb-demo"]
        app.launch()
        openDemoCard(in: app)
        reveal(source, in: app)
        XCTAssertTrue(source.exists)
        XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "card.title").firstMatch.value as? String, originalTitle)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "原生搜图导入并重新打开"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor private func openDemoCard(in app: XCUIApplication) {
        let project = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Nintendo Direct 示例")).firstMatch
        XCTAssertTrue(project.waitForExistence(timeout: 15))
        project.tap()
        let card = app.buttons["editor.card.0"]
        reveal(card, in: app)
        card.tap()
        XCTAssertTrue(app.navigationBars["编辑卡片"].waitForExistence(timeout: 5))
    }

    @MainActor private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<6 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.exists && element.isHittable)
    }
}
