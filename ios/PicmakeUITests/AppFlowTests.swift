import XCTest

final class AppFlowTests: XCTestCase {
    @MainActor func testNativeEditingPersistsAfterRelaunch() throws {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--reset-demo"]; app.launch()
        let newProject = app.buttons["workspace.newProject"]
        XCTAssertTrue(newProject.waitForExistence(timeout: 15)); newProject.tap()
        let name = app.textFields["editor.projectName"]
        XCTAssertTrue(name.waitForExistence(timeout: 5)); name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 20) + "手机测试项目")
        app.swipeUp()
        let add = app.buttons["editor.addCard"]; XCTAssertTrue(add.waitForExistence(timeout: 5)); add.tap()
        let date = app.switches["card.showDate"]
        XCTAssertTrue(date.waitForExistence(timeout: 5))
        date.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        let platform = app.switches["card.showPlatforms"]
        platform.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertEqual(date.value as? String, "0"); XCTAssertEqual(platform.value as? String, "0")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons["完成"].tap()
        app.terminate(); app.launchArguments = ["--demo"]; app.launch()
        let saved = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "手机测试项目")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 10)); saved.tap()
        app.swipeUp(); app.buttons["editor.card.0"].tap()
        XCTAssertEqual(app.switches["card.showDate"].value as? String, "0")
        XCTAssertEqual(app.switches["card.showPlatforms"].value as? String, "0")
    }
    @MainActor func testBundledPreviewAndSystemShare() throws {
        let app = XCUIApplication(); app.launchArguments = ["--demo", "--reset-demo"]; app.launch()
        let demo = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Nintendo Direct 示例")).firstMatch
        XCTAssertTrue(demo.waitForExistence(timeout: 15)); demo.tap()
        app.buttons["editor.preview"].tap()
        let share = app.buttons["分享当前页"]
        XCTAssertTrue(share.waitForExistence(timeout: 20))
        let enabled = NSPredicate(format: "enabled == true")
        expectation(for: enabled, evaluatedWith: share)
        waitForExpectations(timeout: 30)
        let preview = XCTAttachment(screenshot: app.screenshot()); preview.name = "iPhone Air 海报预览"; preview.lifetime = .keepAlways; add(preview)
        share.tap()
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 45) || app.buttons["Copy"].exists || app.buttons["拷贝"].exists || app.staticTexts["海报-第1页"].exists)
    }
}
