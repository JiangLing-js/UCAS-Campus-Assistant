# UCAS Campus Assistant · 国科大校园助手

面向 Windows 的本地校园工作台，将课表、通知、讲座、活动、待办和邮件标题整理到同一界面。支持 DeepSeek 对话、stdio MCP 和 Chrome 页面同步。

这是个人使用的非官方工具。仓库只包含程序、通用配置示例和虚构测试数据，首次运行从空数据库开始。

## 功能

| 模块 | 能力 |
| --- | --- |
| 对话与 MCP | DeepSeek 工具调用、13 个 MCP 工具、对话记录 |
| 校园信息 | 同步已打开的课表、SEP 通知、讲座、常用系统、二课动态和校园网用量 |
| 待办与提醒 | 创建 DDL / 提醒、完成状态、桌面通知、ICS 导出 |
| 选课规划 | XLSX / XLS / CSV / JSON 导入、手动添加、备选方案、学分合计与时间冲突检查 |
| 邮箱 | 浏览器同步邮件标题；可选只读 IMAP，最近 100 封信封信息 |
| 登录 | 通过本机加密凭据填写 SEP / 邮箱登录页，验证步骤留在官方页面完成 |
| 显示 | 对话工作台、90%–160% 字体大小调整 |

**SEP 一键登录仍在适配验证中。** 当前包含加载等待、文档检查和失败诊断；不能保证所有页面和验证流程都能自动完成。邮箱 IMAP 取决于账号是否启用服务。详见 [已知限制](docs/known-limitations.md)。

## 运行

需要 Windows、Node.js 24 或以上、Chrome。

```text
npm ci
npm start
```

打开 [本地工作台](http://127.0.0.1:3210/)。也可以双击 `start.cmd` 后台启动，双击 `stop.cmd` 停止。

在「连接与设置」中填写自己的 DeepSeek API Key。无需密钥即可使用本地待办、课表查看、课程规划等功能。已有凭据留空保存会保留原值。

数据保存在项目下的 `data/`，账号密码与密钥使用 Windows DPAPI CurrentUser 加密。仓库不提供预设账号、密码、API Key、Cookie 或校园数据。

## Chrome 校园桥接

1. 打开 Chrome 扩展管理页，开启开发者模式。
2. 选择「加载已解压的扩展程序」，选择本项目的 `extension` 文件夹。
3. 从工作台设置中复制连接码，粘贴到扩展，点击「连接并同步」。
4. 在学校网站正常登录并打开需要同步的列表或课表。可开启每 15 分钟同步已打开页面。

扩展更新后需要重新加载并刷新工作台。SEP 登录入口要求扩展 0.3.1 或以上。同步功能不读取输入框值、浏览器密码库或 Cookie；登录功能只在点击后填写本机主动保存的凭据。

同步范围为 `*.ucas.ac.cn`、`*.ucas.edu.cn` 和 `mail.cstnet.cn` 的 HTTPS 页面，目标仅为本机 `127.0.0.1`。连接码只授权导入，不能读取登录凭据。

## 一键登录与邮箱

在设置页保存 SEP 或邮箱账号密码，再点击「保存并登录」，或使用设置 / 校园服务页的「一键登录」按钮。扩展优先复用已登录标签页；否则检查官方表单后填写并点击原站按钮。遇到验证码或二次验证时手动完成，只提交一次，不循环尝试。

每次登录使用短期、一次性的凭据领取票据，绑定扩展 ID。密码不会返回工作台页面或发送给模型，也不会写入扩展存储。页面结构或登录策略变化时可能需要手动登录。

后台邮箱读取固定连接 `mail.cstnet.cn:993`，校验 TLS 证书，使用只读 INBOX；不读正文和附件，不发送或删除邮件，不改变已读状态。网页登录密码和客户端专用密码可能不同。默认不向 DeepSeek / MCP 提供邮件，需单独开启邮件标题查询权限。

## 课程导入与提醒

课程文件最多 8 MB、10000 门，先预览解析结果再保存。支持多工作表、常见中文表头、单双周与同课多行安排；未知时间会提示待核对。课程方案保存在本机，不向学校提交选退课。

DDL 和提醒可手动添加或通过对话创建。到期检查需要本地服务运行，浏览器桌面通知还需页面打开并允许通知。退出期间最多补查过去 24 小时内的提醒。

## MCP

在工作台设置页复制适合当前机器的完整配置，或参考 [mcp-config.example.json](mcp-config.example.json)。将 `ABSOLUTE_PROJECT_PATH` 替换成项目的绝对路径，保存到自己的 MCP 客户端设置中。

本机生成的 `mcp-config.json` 被 Git 忽略。MCP 与 Web 后端共用 SQLite；定时提醒由 Web 后端处理。

工具：`search_campus`、`get_agenda`、`create_item`、`complete_item`、`list_sources`、`sync_source`、`search_course_catalog`、`get_course_plans`、`create_course_plan`、`update_course_plan`、`get_campus_services`、`get_campus_activities`、`search_mail`。

## 环境变量

| 名称 | 用途 |
| --- | --- |
| `PORT` | 工作台端口，默认 3210；更改后同步修改扩展本地地址 |
| `UCAS_DATA_DIR` | 自定义本机数据目录；不要放入 Git 跟踪范围 |
| `DEEPSEEK_API_KEY` | 可选，替代在保险箱中保存的 API Key |

环境变量由启动程序的进程提供；本项目不会自动读取 `.env` 文件。

## 隐私与开发

运行 `npm run check:public` 检查 Git 已跟踪的文件；提交前运行 `npm run check:staged` 检查真正暂存的内容。检查会拒绝常见运行数据、凭据文件、个人路径及疑似密钥；它不能替代人工审阅。详见 [发布与隐私](docs/publishing.md)。

```text
npm test
npm run check:public
```

测试使用临时数据库和虚构凭据，不需要真实学校账号或 API Key。GitHub Actions 在 Windows / Node.js 24 上运行检查。

目录：`src/` 后端与 MCP，`public/` 前端，`extension/` Chrome 扩展，`test/` 自动检查，`scripts/` 启停与发布检查。

官方参考：[DeepSeek API](https://api-docs.deepseek.com/)、[MCP](https://modelcontextprotocol.io/)、[Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[ImapFlow](https://imapflow.com/docs/api/imapflow-client/)、[SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)。
