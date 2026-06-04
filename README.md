# 游戏展会一图流模板

一个本地运行的 1440 x 1920 竖版游戏发布会信息图生成器。

## 使用

```bash
npm install
npm run dev
```

打开终端显示的本地地址，默认通常是：

```text
http://127.0.0.1:5173
```

左侧编辑标题、注释、游戏信息、平台和图片；右侧实时预览。点击“导出当前页”会下载当前页 PNG。

可开启“自动补齐当前页空白”，让当前画布里的卡片平均填满剩余高度。也可以上传左上角 Logo，每个主题会保存自己的 Logo。

## 已有主题

- State of Play
- Summer Game Fest
- Xbox Showcase

主题配置在 `src/data/themes.js`，默认示例内容在 `src/data/sampleData.js`。

## Logo 图标库

内置 Logo 文件放在 `public/logos/`。

如需新增 Logo：

1. 把透明背景 PNG 或 SVG 放进 `public/logos/`。
2. 在 `src/data/logoLibrary.js` 里添加一条记录。
3. 页面左侧“选择内置 Logo”会出现新的选项。

## GitHub Pages

仓库推送到 `main` 分支后，GitHub Actions 会自动构建并部署到 GitHub Pages。

## 排版规则

- 画布固定为 1440 x 1920。
- 每页最多 6 个游戏。
- 游戏编号自动生成。
- 图片区域固定为 16:9，并自动裁切。
- 文本会自然换行；内容过长时会估算高度并拆到下一页。
