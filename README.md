# Atherloom React

Atherloom React 是现有 Atherloom 前端的组件化重建。它保留原来的 FastAPI、SQLite、模型协议、人格与记忆边界，使用 React、TypeScript 和 Vite 替换超大的手写 HTML 与原生 DOM 单体脚本。

> **源码公开可见，但不是开源软件。** 本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE.md)：允许个人及其他符合条款的非商业用途；任何商业使用、商业集成、付费服务、转售或以营利为目的的使用，必须事先取得版权所有者的单独书面授权。

默认视觉继续遵循最初确定的 Claude 风格：纸张米白、暖灰侧栏、墨黑棕文字、陶橙强调色，以及克制的桌面/手机响应式层级。Atherloom 保留自己的名称和原创图标，不冒充 Anthropic 或 Claude 官方客户端。

## 当前阶段

当前已覆盖：

- Claude 风格桌面与手机聊天壳。
- 真实 `/api/bootstrap` 初始化。
- 会话按人格隔离、切换和新建。
- API 线路与人格选择。
- 真实 `/api/chat` JSONL/SSE 流式读取，以及按线路切换流式 / 非流式；Android 完全本机模式也有真实上游 SSE 增量桥。
- Markdown、默认展开且可手动收起的 reasoning、记忆来源与 Token usage 展示。
- 停止生成。
- API 与网关完整管理：多线路、多模型、编辑/删除、保存 Key 复用、模型拉取、连接测试、视觉线路、采样参数、流式/thinking、缓存方式和自定义请求头。
- 人格指令完整编辑器：基础、提示词、记忆、快捷短语、自定义请求、正则、本地工具和 MCP 八个页面，以及专属线路、置顶、启动策略、模板预览和增删改。
- 世界书完整管理：世界书与条目增删改、启用、常驻/关键词/正则、大小写、扫描深度、注入位置/角色、优先级和 JSON 导入导出。
- 跟随系统、浅色、深色、水色、薄荷绿、丁香、腮红主题模式。
- 恢复旧版 Atherloom 交织 A 图标与首次进入/刷新/减弱动效三套开屏时序。
- 人格工作区聊天隔离：专属线路、继续/新建启动策略、每会话草稿、切换保护、重命名、置顶、星标、归档、消息搜索与会话删除。
- 五类脱敏完整备份、选择性恢复、恢复前快照，以及 Android 系统文件保存/选择器。
- Android 无需电脑后端即可使用本机模式：API Key 进入系统加密存储，设置、人格、世界书、会话和消息保存在本机，模型请求由原生网络桥直连；也可主动切换到 FastAPI 服务器模式。
- 消息复制、珍藏、修改、重新 Roll、回答版本切换、分支、删除单版本/全部版本，以及脱敏 Markdown 导出。
- 自动总结、Token/轮数压缩、主动压缩、记忆生命周期、搜索与工具权限、MCP 管理、九维动机、右上角人格状态卡和数据健康。
- 图片/PDF/文本附件、结构化问题选项卡、快捷短语、会话世界书、输入状态和系统语音通话。
- 珍藏、生活簿、联系人/信箱、用户日记、AI 独立/定时私人日记及审计、留言板、梦库、共读、共影、陪听和角色剧场。
- 可安装 PWA 离线壳，以及 Android 系统返回键浮层层级。

完整范围见 [React 迁移总表](docs/MIGRATION_INVENTORY.md)，旧 HTML 功能与历史错误逐项核对见 [功能对照审计](docs/LEGACY_PARITY_AUDIT.md)，本轮实现记录见 [工作日志](WORKLOG.md)。云芽庭院、全部游戏和 AI 会客厅按用户要求暂不迁移，不以空壳入口冒充完成。

## 本地运行

先启动现有 Atherloom FastAPI：

```powershell
cd C:\Users\26099\Desktop\claude-local-cn
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8876
```

再启动 React 开发服务器：

```powershell
cd C:\Users\26099\Desktop\Atherloom-React
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。Vite 会把 `/api` 代理到 `http://127.0.0.1:8876`。

## Android 测试版

Android 客户端使用独立包名 `app.atherloom.react`，不会覆盖旧版 Atherloom。APK 内置 React 页面，默认使用本机模式：API Key 通过 Android 加密存储保管，设置和聊天数据留在当前设备，模型请求通过原生桥直接发往所填线路。

需要共用现有 FastAPI/SQLite 时，可进入“设置 → 后端连接”填写电脑或服务器地址，例如 `http://192.168.1.20:8876`；清空地址并保存即可切回本机模式。详细说明见 [Android 构建说明](android/README.md)。

Android 长期版使用现有 Atherloom 固定发布证书，签名材料只保存在私有 GitHub Actions Secrets 中。工作流在发布前核验证书指纹；从首个固定签名版起，后续同包名 APK 可以覆盖升级。安装过早期 Debug 测试版时，需要先卸载测试版再安装固定签名版。

## 仓库边界

- 本仓库不保存 API Key、Token、私人数据库、聊天记录或未脱敏日志。
- 旧 Atherloom 在功能对齐与连续真机验证完成前保持可用。
- 本仓库是非商业源码可用项目，不使用 OSI 开源许可证。
- 个人和其他符合 [PolyForm Noncommercial License 1.0.0](LICENSE.md) 的非商业用途，可以查看、运行、修改和依照许可证分发。
- 商业使用、商业集成、付费托管、转售或其他营利用途，须事先取得版权所有者的单独书面许可。
- 仓库所依赖的第三方组件继续适用各自的许可证；本许可证只覆盖 Atherloom React 自有代码与资源。
