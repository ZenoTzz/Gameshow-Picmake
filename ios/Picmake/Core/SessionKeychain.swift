import Foundation
import Security

enum SessionKeychain {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "uk.zenohy.picmake.session", kSecAttrAccount as String: "session-cookie"]
    static func load() throws -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }; try check(status)
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else { throw CloudError(status: 0, message: "登录凭据损坏，请重新登录。") }; return value
    }
    static func save(_ value: String?) throws {
        guard let value else { let status = SecItemDelete(query as CFDictionary); if status != errSecItemNotFound { try check(status) }; return }
        let fields: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, fields as CFDictionary)
        if status == errSecItemNotFound { try check(SecItemAdd(query.merging(fields) { _, b in b } as CFDictionary, nil)) } else { try check(status) }
    }
    private static func check(_ status: OSStatus) throws { if status != errSecSuccess { throw CloudError(status: 0, message: "无法访问安全登录凭据（\(status)），请解锁设备后重试。") } }
}
