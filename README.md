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
- 真实 `/api/chat` JSONL/SSE 流式读取。
- Markdown、reasoning、记忆来源与 Token usage 基础展示。
- 停止生成。
- API 与网关完整管理：多线路、多模型、编辑/删除、保存 Key 复用、模型拉取、连接测试、视觉线路、采样参数、流式/thinking、缓存方式和自定义请求头。
- 人格指令完整编辑器：基础、提示词、记忆、快捷短语、自定义请求、正则、本地工具和 MCP 八个页面，以及专属线路、置顶、启动策略、模板预览和增删改。
- 世界书完整管理：世界书与条目增删改、启用、常驻/关键词/正则、大小写、扫描深度、注入位置/角色、优先级和 JSON 导入导出。
- 跟随系统、浅色、深色、水色、薄荷绿、丁香、腮红主题模式。
- 恢复旧版 Atherloom 交织 A 图标与首次进入/刷新/减弱动效三套开屏时序。

其余模块的完整范围与当前状态见 [React 迁移总表](docs/MIGRATION_INVENTORY.md)。未列为已完成的功能仍使用旧 Atherloom，不以空壳或假数据冒充迁移完成。

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

Android 客户端使用独立包名 `app.atherloom.react`，不会覆盖旧版 Atherloom。APK 内置 React 页面，通过原生网络桥连接现有 FastAPI 后端，不把 API Key、数据库或聊天记录打进安装包。

首次打开 APK 后，进入“设置 → 后端连接”，填写电脑或服务器地址，例如 `http://192.168.1.20:8876`。局域网使用时 FastAPI 需要监听 `0.0.0.0`，手机与电脑处于可互访网络；公网使用应配置 HTTPS。详细说明见 [Android 构建说明](android/README.md)。

Android 长期版使用现有 Atherloom 固定发布证书，签名材料只保存在私有 GitHub Actions Secrets 中。工作流在发布前核验证书指纹；从首个固定签名版起，后续同包名 APK 可以覆盖升级。安装过早期 Debug 测试版时，需要先卸载测试版再安装固定签名版。

## 仓库边界

- 本仓库不保存 API Key、Token、私人数据库、聊天记录或未脱敏日志。
- 旧 Atherloom 在功能对齐与连续真机验证完成前保持可用。
- 本仓库是非商业源码可用项目，不使用 OSI 开源许可证。
- 个人和其他符合 [PolyForm Noncommercial License 1.0.0](LICENSE.md) 的非商业用途，可以查看、运行、修改和依照许可证分发。
- 商业使用、商业集成、付费托管、转售或其他营利用途，须事先取得版权所有者的单独书面许可。
- 仓库所依赖的第三方组件继续适用各自的许可证；本许可证只覆盖 Atherloom React 自有代码与资源。
