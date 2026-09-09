# UCAS Campus Assistant · 国科大校园助手

面向 Windows 的本地校园工作台，将课表、通知、讲座、活动、待办和邮件标题整理到同一界面。支持 DeepSeek 对话、stdio MCP 和 Chrome 页面同步。

这是个人使用的非官方工具。

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

## 运行

需要 Windows、Node.js 24 或以上、Chrome。

```text
npm ci
npm start
```

打开 [本地工作台](http://127.0.0.1:3210/)。也可以双击 `start.cmd` 后台启动，双击 `stop.cmd` 停止。

在「连接与设置」中填写自己的 DeepSeek API Key。无需密钥即可使用本地待办、课表查看、课程规划等功能。已有凭据留空保存会保留原值。

数据保存在项目下的 `data/`，账号密码与密钥使用 Windows DPAPI CurrentUser 加密。

## Chrome 校园桥接

1. 打开 Chrome 扩展管理页，开启开发者模式。
2. 选择「加载已解压的扩展程序」，选择本项目的 `extension` 文件夹。
3. 从工作台设置中复制连接码，粘贴到扩展，点击「连接并同步」。
4. 在学校网站正常登录并打开需要同步的列表或课表。可开启每 15 分钟同步已打开页面。

## 一键登录与邮箱

在设置页保存 SEP 或邮箱账号密码，再点击「保存并登录」，或使用设置 / 校园服务页的「一键登录」按钮。

## 课程导入与提醒

课程文件最多 8 MB、10000 门，先预览解析结果再保存。支持多工作表、常见中文表头、单双周与同课多行安排；未知时间会提示待核对。课程方案保存在本机，不向学校提交选退课。

DDL 和提醒可手动添加或通过对话创建。到期检查需要本地服务运行，浏览器桌面通知还需页面打开并允许通知。退出期间最多补查过去 24 小时内的提醒。

## MCP

在工作台设置页复制适合当前机器的完整配置，或参考 [mcp-config.example.json](mcp-config.example.json)。将 `ABSOLUTE_PROJECT_PATH` 替换成项目的绝对路径，保存到自己的 MCP 客户端设置中。

## 环境变量

| 名称 | 用途 |
| --- | --- |
| `PORT` | 工作台端口，默认 3210；更改后同步修改扩展本地地址 |
| `UCAS_DATA_DIR` | 自定义本机数据目录；不要放入 Git 跟踪范围 |
| `DEEPSEEK_API_KEY` | 可选，替代在保险箱中保存的 API Key |


官方参考：[DeepSeek API](https://api-docs.deepseek.com/)、[MCP](https://modelcontextprotocol.io/)、[Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[ImapFlow](https://imapflow.com/docs/api/imapflow-client/)、[SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)。
