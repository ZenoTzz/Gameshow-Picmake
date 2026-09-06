# 展会制图 for iPhone

SwiftUI 原生项目与卡片编辑器，连接现有 `https://pic.zenohy.uk`。登录、素材、项目版本和模板库沿用网站 API，不需要重新创建账号或迁移数据库。海报排版由 App 内附的 React/CSS 渲染组件生成，编辑界面不加载网站。

## 第一版功能

- 本机新建与自动保存草稿；登录后查看、创建及更新云端项目。
- 原生编辑卡片标题、日期、平台和说明；独立关闭日期/平台；新增、排序和删除卡片。
- 系统相册选图，ImageIO 直接生成最长边 2400 的 JPEG，处理照片方向；不申请整个相册的读取权限。
- 切换内置/项目自定义主题，复制主题再修改颜色、边框和遮罩；支持应用云端共享模板。
- 读取历史版本为独立草稿，保留当前项目；云保存使用 baseRevision，409 时保留手机修改，不自动覆盖云端。
- 离线分页海报预览、双指缩放和当前页 PNG 系统分享，可以保存到文件或相册。

手机的“修改自动保存在本机”不代表已同步。点击“保存到云端”成功后，电脑或其他手机再载入云端最新版本。发生网络超时应先核对云端列表；相同内容的创建重试有幂等标识，不会重复创建。手机本机草稿不会随退出登录自动删除。

第一版暂不包含将外观发布到共享模板库、网站的批量文字导入、ZIP 项目导入/导出、全部页面打包/长图导出、精细裁图、Logo 拖动与字体配置，以及后台自动同步。网站设置会作为原始 JSON 保留，手机编辑不会丢弃这些未提供编辑控件的字段。预览要求图像已下载为内嵌素材；旧版外链图片需先在网站导入保存。字体取自系统，跨系统缺少同名字体时会使用回退字体。

## 构建与测试

需要完整 Xcode、Node 22.12+、项目依赖及 XcodeGen。工程部署目标 iOS 17，面向 iPhone。

仓库根目录运行：

```sh
npm ci
npm run build:ios-renderer
xcodegen generate --spec ios/project.yml
xcodebuild -project ios/Picmake.xcodeproj -scheme Picmake \
  -destination 'platform=iOS Simulator,name=iPhone Air' \
  -derivedDataPath /tmp/picmake-ios-derived CODE_SIGNING_ALLOWED=NO test
```

`ios/project.yml` 是工程源配置。`Picmake/Renderer` 是预构建本地资源，作为 folder reference 整体加入 App；修改网页排版或内置主题后需要重新执行 `build:ios-renderer`，该命令也同步原生主题目录。工程已提交生成资源，可直接打开 `Picmake.xcodeproj` 构建。

Debug scheme 的 Run Arguments 可加 `--demo`，使用单独本机演示目录，不连接真实服务器；`--reset-demo` 清空的仅是演示目录。正式运行不要添加演示参数。

## 会话和保存

会话 Cookie 保存在专用 Keychain 项，限定本机解锁访问；密码不落盘。原生 URLSession 禁用 Cookie 自动共享和 API 响应缓存，不跟随重定向，写请求携带固定网站 Origin 和服务器 CSRF。只有确切的 CSRF 失效 403 才刷新后重试一次，401、409 和网络失败不自动重试写入。

项目按动态 JSON 保留未知字段，素材使用与网站相同的 `SHA256(MIME + NUL + bytes)` 校验。本机草稿原子写入 Application Support，并使用文件保护。预览 WebView 使用非持久存储，只接受本地包主框架消息，禁用外部导航；导出资源不包含登录凭据。

## 真机安装

选择已连接 iPhone Air 作为 Xcode destination，使用已有 Personal Team 自动签名。系统为 iOS 27.0；本机 Xcode 26.6 使用 iOS 26.5 SDK，具体兼容性由真机构建/启动验证。

```sh
xcodebuild -project ios/Picmake.xcodeproj -scheme Picmake \
  -destination 'platform=iOS,id=你的设备UDID' \
  -derivedDataPath /tmp/picmake-ios-device \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
```

免费 Personal Team 签名通常约七天后需重装。发布 TestFlight/App Store 需要另行配置分发；当前是个人设备开发安装。

## 本次验证记录（2026-09-06）

- Xcode 26.6 / iOS 26.5 / iPhone Air 模拟器：23 项核心测试与 2 条 UI 流程全部通过。
- UI 实测覆盖新增编辑、日期/平台独立开关、重启后草稿保留、离线海报预览与 PNG 系统分享。
- Swift 客户端对隔离 Node 后端完成登录、图片去重、幂等创建、版本保存、跨客户端读取、409 冲突与历史版本联调。
- 现有网站 48 项测试与生产构建通过，网站和后端无需部署修改。
- WebKit 的首次 foreignObject 位图资源遗漏通过预热渲染处理，含真实图片的导出已目视检查；预览传入 JSON 使用稳定键顺序，避免 SwiftUI 状态更新触发反复渲染。
- 已为用户已配对的 iPhone Air（iOS 27.0）成功签名并安装。此次 Personal Team 描述文件有效期至北京时间 2026-09-13 22:51，后续需通过 Xcode 重新签名安装。
- 用户真实账户的完整读写尚需登录后验收；自动测试未使用真实账户或修改生产项目。
