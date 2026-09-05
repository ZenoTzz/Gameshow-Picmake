# 私人同步服务

需要 Node.js 24，无第三方服务端依赖。由反向代理提供 HTTPS；应用默认仅监听回环地址。前端 dist 与 API 必须同源。

配置环境变量后运行 `node server/index.js`：

- `PUBLIC_ORIGIN`：完整网站来源，例如 `https://pic.example.com`，不带尾部斜杠。
- `DATA_DIR`：持久化私有目录，保存 SQLite（包含账号、会话及每个项目最近 20 份自动版本和命名恢复点）和 assets 图片。
- `PUBLIC_DIR`：构建输出目录，默认 `./dist`。
- `HOST` / `PORT`：默认 `127.0.0.1` / `8790`。
- `BOOTSTRAP_TOKEN`：首次注册需要的高熵随机一次性令牌，通过安全环境文件配置；账号建立后不能再次注册，可移除此变量。
- `ALLOW_INSECURE_COOKIES=true`：仅本机 HTTP 测试使用，生产不得启用。

首次设置账号时密码至少 12 字符。密码使用随机盐 scrypt；会话有效 7 天。Cookie 为 HttpOnly、Secure、SameSite=Lax。写请求必须发送准确 Origin，JSON 请求使用 application/json；除登录和首次注册外，还须发送 X-CSRF-Token。代理应限制请求速率及连接数，限制上传请求体约 21MB，并仅向应用转发受信来源的请求。应用按直连 IP 与全局限制认证尝试（15 分钟内 15 / 100 次），共享反向代理 IP 的个人使用场景适用，不信任客户端 X-Forwarded-For。

接口均以 `/api` 开头，错误为 `{error}`，版本冲突返回 HTTP 409 `{error,revision}`：

- `GET /session` → `{authenticated,setupRequired,username?,csrfToken?}`。
- `POST /setup` `{username,password,setupToken}`；`POST /login` `{username,password}` → 已登录 session 响应。
- `POST /logout` `{}` → 注销。
- `GET /project` → `{revision,project,updatedAt}`；空项目 revision=0，其余字段 null。
- `PUT /project` `{baseRevision,project}` → `{revision,updatedAt}`。project 使用共享 projectAssets.js 的打包格式，以 `{$asset:sha256}` 引用已上传素材；禁止内嵌图片和临时 blob 地址。
- `GET /history` → `{versions:[{revision,updatedAt}]}`，新版本在前。
- `GET /history/:revision` → 项目 envelope。恢复历史需重新 PUT 当前版本号。
- `POST /assets/check` `{ids}` → `{missing:[ids]}`。
- `PUT /assets/:sha256` → `{id}`；请求体为图片原始字节，Content-Type 为受支持的 image MIME；SHA-256 计算内容为 MIME + NUL + 图片字节。
- `GET /assets/:sha256` → 已认证可读图片，SVG 使用 sandbox CSP。

单图最多 20MB，每个项目最多 1000 张 / 100MB 素材，manifest 最多 5MB。磁盘中已登记素材总量最多 2GB；不会自动删除旧素材，避免破坏历史。达到限制可由管理员使用下方 GC 工具预览并清理无引用素材。数据库与素材目录需一起备份到异机：停服务后复制整个 DATA_DIR，或者用 SQLite 在线备份并包含素材目录；不能仅复制正在写入的 SQLite 主文件而遗漏 WAL。禁止把 DATA_DIR 配到静态公开目录或提交 Git。

## VPS 部署与备份

`picmake.service` 为参考 systemd 单元：使用独立 picmake 系统用户、只写 `/var/lib/picmake`、默认站点 `https://pic.zenohy.uk`，反向代理到 `127.0.0.1:8790`。运行时放在 `/opt/picmake/runtime/node`（Node 24+），应是服务用户可执行且不位于 root 家目录的独立二进制；根据实际安装路径调整 ExecStart。`/opt/picmake/current` 应包含 dist、server、src/utils/projectAssets.js 及 package.json（ESM 类型配置）。首次注册令牌放在仅 root 可读的 `/etc/picmake.env`，不要放在仓库、构建输出或公开日志中。服务端初始化账号后移除令牌并重启不会删除账号。

`sudo sh server/backup.sh /var/backups/picmake` 会短暂停止服务，打包整个数据目录并验证压缩包，随后恢复原先正在运行的服务。脚本不删除旧备份。备份含私人图片、账号和会话，应限制访问，并另行复制到异机；同一 VPS 上的副本不能应对磁盘损坏。恢复时先停止服务，备份当前数据，把压缩包中的 picmake 目录恢复到 `/var/lib`，将权限归属设回 picmake 用户，再启动服务。


## 多项目接口与旧站迁移

云端项目是包含文字、卡片、图片引用和主题设置的完整工作成果；项目名称独立于内部主题模板。以下接口沿用同源认证、CSRF 与素材限制：

- `GET /api/projects` → `{projects:[{id,name,createdAt,updatedAt,revision,cardCount,theme}]}`，按最新保存时间排列。
- `POST /api/projects` `{name,project}` → HTTP 201 `{id,name,revision,project,updatedAt,createdAt}`，UUID 标识，初始 revision=1。
- `GET /api/projects/:id` → 同上项目 envelope。
- `PUT /api/projects/:id` `{baseRevision,project,name?}` → 更新后的完整 envelope。名称可选，修改名称也参与版本冲突校验。
- `GET /api/projects/:id/history` → `{versions:[{revision,updatedAt}]}`。
- `GET /api/projects/:id/history/:revision` → 历史项目 envelope；name 是当前项目名称。

名称去除首尾空白后长度应为 1–100。每个项目独立维护版本号、最近 20 个未命名历史版本及全部命名恢复点；一个项目的保存和历史清理不会影响其他项目。素材继续按内容哈希共享，并保持私有读取。

启动时在一个事务中把旧 versions 表迁移为固定 id=`legacy`、名称“State of Play（旧站导入）”的项目，保留已有版本号、时间、账户和图片。迁移标记防止重启重新导入已清理历史；原 versions 表保留为升级前数据快照，不再写入。旧 `/api/project` 和 `/api/history` 永久只指向 legacy，不跟随新界面选中的项目，因此旧标签页不能覆盖其他项目。无旧数据时不创建空 legacy；首次旧接口保存会按需建立它。升级前仍应备份整个数据目录。

## 模板库、命名恢复点与可靠重试

- `GET /api/templates` → `{templates:[{id,name,revision,updatedAt}]}`。
- `GET /api/templates/:id` → `{id,name,revision,project,updatedAt}`。
- `POST /api/templates` `{name,project,requestId?}` → HTTP 201 模板 envelope。
- `PUT /api/templates/:id` `{name,project,baseRevision}` → HTTP 200 模板 envelope；冲突 HTTP 409 `{error,revision}`。

模板 project 使用同样的打包格式，`games` 必须为空数组。保存的是外观快照；更新模板库不会自动改动已保存项目。首次升级会从每个项目最新版本提取各自 customThemes，保留该主题的独立外观、Logo、字体配置，使用稳定 UUID。即使不同项目复用了同一 customTheme ID，也分别保留。迁移仅运行一次。

`POST /api/projects/:id/checkpoints` `{revision,name}` → `{revision,name}`，把仍存在的版本命名并保留；对同一版本再次调用修改名称。history 列表增加 `name`（未命名为 null）和 `pinned`（boolean）。每个项目保留最近 20 个未命名版本及全部命名版本，命名版本不会因自动同步被清理。

新建项目和模板支持可选 `requestId`：8–128 个字母、数字、下划线或连字符。客户端应为同一次新建生成稳定 ID，网络失败重试沿用该 ID 和相同载荷。重复请求返回原始创建结果；同 ID 改变内容返回 409。记录包含初始快照且不会自动删除，GC 会保留其图片，确保稍后重试仍能恢复原结果。

`GET /api/storage` → `{usedBytes,limitBytes}`，显示登记的素材占用及 2GB 素材限制；不含数据库、备份和未登记临时文件大小。

## 素材清理

`DATA_DIR=/var/lib/picmake node server/gc.js` 默认仅检查，输出可回收文件数量和字节数，不删除文件。检查覆盖所有项目当前与历史版本、命名版本、模板、升级前 versions 快照及幂等请求记录，任何仍被引用的素材均保留。

实际清理前备份数据，然后停止 `picmake.service`，以 root 运行 `DATA_DIR=/var/lib/picmake node server/gc.js --apply`，成功后启动服务。脚本检查 systemd 服务处于 inactive/failed，否则拒绝；不支持在其他手动 Node 进程仍访问同一数据目录时运行。清理完成后可重新执行 dry-run 核验。脚本不删项目或恢复点。

## 忘记密码

无需删除账号或项目数据库。先备份并停止 `picmake.service`，在 VPS 管理员终端通过 stdin 提供新密码给 `server/reset-password.js`；该命令要求 root 且服务停止，拒绝密码命令行参数，不输出密码。可在 root 的 Bash 中运行：

```bash
systemctl stop picmake
read -r -s -p 'New password (12+ characters): ' picmake_new_password
printf '%s' "$picmake_new_password" | DATA_DIR=/var/lib/picmake /opt/picmake/runtime/node /opt/picmake/current/server/reset-password.js
unset picmake_new_password
systemctl start picmake
```

成功后保留用户名、所有项目与图片，撤销全部设备会话。用新密码重新登录即可。若命令失败，原密码和会话保持原状。
