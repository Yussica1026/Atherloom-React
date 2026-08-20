# Atherloom React

Atherloom React 是现有 Atherloom 前端的组件化重建。它保留原来的 FastAPI、SQLite、模型协议、人格与记忆边界，使用 React、TypeScript 和 Vite 替换超大的手写 HTML 与原生 DOM 单体脚本。

默认视觉继续遵循最初确定的 Claude 风格：纸张米白、暖灰侧栏、墨黑棕文字、陶橙强调色，以及克制的桌面/手机响应式层级。Atherloom 保留自己的名称和原创图标，不冒充 Anthropic 或 Claude 官方客户端。

## 当前阶段

第一阶段已覆盖：

- Claude 风格桌面与手机聊天壳。
- 真实 `/api/bootstrap` 初始化。
- 会话按人格隔离、切换和新建。
- API 线路与人格选择。
- 真实 `/api/chat` JSONL/SSE 流式读取。
- Markdown、reasoning、记忆来源与 Token usage 基础展示。
- 停止生成。
- 新增 API 线路与人格的基础表单。
- 跟随系统、浅色、深色、水色、薄荷绿、丁香、腮红主题模式。

其余模块的完整范围见 [React 迁移总表](docs/MIGRATION_INVENTORY.md)。未列为已完成的功能仍使用旧 Atherloom，不以空壳或假数据冒充迁移完成。

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

首个可下载 APK 使用 Android Debug 签名，适合安装测试。固定签名正式版将在 React 功能迁移和真机验证继续完成后发布。

## 仓库边界

- 本仓库不保存 API Key、Token、私人数据库、聊天记录或未脱敏日志。
- 旧 Atherloom 在功能对齐与连续真机验证完成前保持可用。
- 本仓库未授予开源许可；未经授权不得复制、修改、再分发或另行托管。
