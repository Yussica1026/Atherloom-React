# Atherloom React 工作日志

## 2026-08-25 · v0.2.4 固定签名发布候选

> 本版合并已经完成的 Direct Provider 明文误配防护、长期世界 React 客户端，以及 Casual Games 的井字棋与猜拳同 Persona 链路。发布范围只包含 `Atherloom-React`；旧 HTML / FastAPI 仓库、本地数据库和私人日记均不进入 GitHub 或 APK。

### 本版边界

- Direct Provider 继续允许 localhost / LAN HTTP；其他 HTTP 线路必须逐线路明确确认，并且携密请求不跟随重定向、Key 不跨目标自动复用。
- 长期世界使用独立 `src/features/longworld/` 和 `/api/game-worlds`、`/api/game-sessions` 客户端命名空间。GM 只能提出候选，前端显示服务器已提交的领域事件、revision、replay、存档与分支；不复用旧 `/api/games` 或 Casual Games 领域对象。
- Casual Games 使用独立 `src/features/games/` 和 `/api/casual-games`；当前同一 Conversation 的 Persona 通过实时 `open_game` tool effect 进入井字棋或猜拳，每个 AI 回合、赛后回复和可选记忆仍属于原 Persona。记忆默认 `ask`。
- 长期世界与 Casual Games 当前都需要连接支持相应 API 的 FastAPI。Android 完全离线 Standalone 尚未接入，界面不会伪造离线可用；本次也没有把新领域继续塞进 `standalone/store.ts`。
- 生产代码与公开测试数据不内置任何具体用户或 Persona 名称；空玩家名使用中性“玩家”。内容型提示仍来自用户配置，代码只保留协议与规则约束。

### 发布前验证

- TypeScript typecheck 与 production build 通过（328 modules）；长期世界和游戏 Overlay 均为独立懒加载 chunk，只有既存主 bundle 超过 500 kB 的分包建议。
- Android Provider 安全、语音、Casual Games、LongWorld、React 回归与版本契约共 `55/55` 通过。
- 同一静态服务下连续通过三个 Edge Playwright smoke：`LONGWORLD_GM_SMOKE_OK`、`CASUAL_TTT_SMOKE_OK`、`CASUAL_RPS_SMOKE_OK`；控制台、页面和 HTTP 错误均为 0，三张最终截图已经人工核对。
- 发布前尚未创建 `v0.2.4` 标签或 Release；固定签名 APK、公开附件哈希、包信息与证书将在 GitHub Actions 完成后回填。

## 2026-08-24 · Casual Games 猜拳同人格链路（并入 v0.2.4 发布候选）

> 在井字棋 vertical slice 的既有边界上新增第二个 Registry 插件“猜拳”。仍由当前 Conversation 的同一 Persona 参与，每一个 AI 游戏回合复用该 Persona 当前的 Provider/model、Persona 配置、相关长期记忆与用户游戏行为配置；没有创建 Game Persona，也没有把 Casual Games 并入旧小游戏或 LongWorld。发布状态见顶部 v0.2.4 节。

### 公平提交与同一 Persona

- 聊天工具现在允许 `rock_paper_scissors`，自然语言“陪我玩猜拳”会产生本轮可信 `open_game` effect，并在原聊天上方打开独立游戏 Overlay。
- 用户手势提交后，公开 session 只显示 `user_choice_committed=true`；Persona 作出自己的选择前拿不到用户的石头、剪刀或布。双方都提交后，服务器才把两手同时揭示并由确定性规则判胜。
- 前端不计算胜负、不随机替 Persona 出拳，也没有本地作弊兜底。Persona 回合失败时保留原 session 和 revision，允许用户明确重试。
- 可信 `result_id` 仍幂等回写原 Conversation 的赛后回复；记忆默认 `ask`，确认后只把已验证的双方手势与结果摘要写入同一 Persona 的真实互动记忆。

### 界面与验证

- 猜拳界面沿用当前主题 token、`color-mix()` 与楷体体系，没有固定颜色；手机端包含键盘标签、ARIA live 状态、焦点隔离与 reduced-motion 支持。
- TypeScript typecheck、production build 通过（328 modules）；仅有原有主 bundle 超过 500 kB 的分包提示。
- React contract / regression 共 `39/39` 通过；后端全量回归 `250/250` 通过，仅有既存 Starlette/httpx 弃用提示。
- 390×844 Edge Playwright smoke 输出 `CASUAL_RPS_SMOKE_OK`，覆盖自然语言开局、揭示前封存、服务端 Persona 回合、同时揭示、可信胜负、原聊天赛后回复与记忆确认；控制台、页面和 HTTP 错误均为 0。
- 人工核对截图 `artifacts/casual-rock-paper-scissors-smoke.png` 通过；临时静态服务已关闭。

### 仍未做

- 猜数字和二十问尚未实现；Android 完全离线 Standalone 也尚未接入 Casual Games。
- 猜拳已经纳入 v0.2.4 发布候选；固定签名与公开附件验证见顶部发布记录。

## 2026-08-24 · Casual Games 井字棋同人格链路（并入 v0.2.4 发布候选）

> 本轮完成 Casual Games 的第一个最小 vertical slice：从原聊天由当前 Persona 主动打开井字棋，完成对局后把可信结果送回同一聊天，并按用户选择写入同一 Persona 的长期记忆。旧 `/api/games` 与 LongWorld 均未并入本模块；发布状态见顶部 v0.2.4 节。

### 同一 Persona 完整链路

- 聊天模型通过 `atherloom_open_game({ game_id: "tic_tac_toe" })` 明确发起游戏；前端只消费本轮实时 `tool_event.effect`，不会扫描历史消息或在刷新后重复打开。
- 游戏 session 继续绑定原 `conversation_id`、`persona_id` 与 `player_id`。Persona 的每一个游戏回合都重新读取当前 Persona、Provider/model、相关记忆、游戏行为配置和必要聊天上下文，不创建 `GamePersona`、匿名机器人或第二套人格记忆。
- Persona 只提出合法落子位置，回合顺序、空格校验、胜负和平局由确定性规则引擎裁定；前端没有 minimax、随机兜底或可绕过服务端的 Persona 落子入口。
- 对局结束后，前端只提交可信 `result_id`。服务端校验结果后在原 Conversation 中幂等生成一次赛后回复，不伪造新的用户消息，也不会把结果写到另一个会话。
- 记忆默认使用 `ask`：用户可选择“记住这局”或“这次不记”。用户明确把某 Persona 的游戏配置设为 `auto` 时才自动写入；长期记忆只保存程序根据已验证结果生成的中性摘要，不保存每一步棋。

### 独立模块与界面边界

- 新增独立 `src/features/games/`，包含 Registry、API、session hook、主题化 Overlay 和井字棋插件；没有把 Casual Games 塞进 `standalone/store.ts`、旧小游戏或 LongWorld 的领域对象。
- Overlay 沿用现有主题变量与楷体体系，不固定颜色；手机端使用全屏布局，并补齐焦点圈定、Escape / Android 返回键、焦点恢复、`inert`、ARIA 状态与减少动画偏好。
- 棋盘使用“织线成局”的细线视觉作为模块识别元素；水色与丁香等主题切换已用真实计算样式验证，颜色会跟随主题变化。
- 当前 vertical slice 面向 Web / Android 连接 FastAPI 的模式。Android 完全离线 Standalone 尚未实现 Casual Games 持久化，后续也不能直接把它塞进现有超大 store。

### 本轮验证

- `npm run typecheck` 通过；production build 通过（327 modules），GameOverlay 保持独立懒加载 chunk。仅有原有主 bundle 超过 500 kB 的提示，没有新增构建错误。
- React contract / regression 共 `38/38` 通过。
- 390×844 真实浏览器 smoke 通过：自然语言工具事件、同一 Persona/session、用户与 Persona 回合、可信结果、原聊天赛后回复一次、记忆询问与批准、主题变化、减少动画、焦点管理和 Android 返回键均已覆盖，输出 `CASUAL_TTT_SMOKE_OK`。
- 本地烟测截图保存在 `artifacts/casual-tic-tac-toe-smoke.png`；临时测试服务均已关闭。

### 明确留到下一轮

- 猜数字和二十问尚未扩展为完整插件；先不扩游戏数量。
- Android 完全离线 Standalone、游戏行为配置 UI 的完整导入/导出，以及更广的真机验收尚未实现。
- 井字棋已经纳入 v0.2.4 发布候选；固定签名与公开附件验证见顶部发布记录。

## 2026-08-24 · v0.2.4 Direct Provider 明文误配防护（本地发布候选）

> 本轮按个人自托管应用的实际威胁模型收口：继续支持 localhost、局域网与 FastAPI 后端 HTTP，只防止 Direct Provider 的明显明文误配和凭据跨目标发送，不引入 SaaS 级证书固定或复杂网络策略。本节尚未代表 APK 已发布。

### 修复范围

- Android Direct Provider 的模型列表、非流式聊天和流式聊天统一经过原生 `ProviderEndpointPolicy`；HTTPS 正常放行，常见 loopback、RFC1918、link-local、CGNAT、IPv6 ULA/link-local 与 `.local` / `.lan` / `home.arpa` HTTP 保持可用。
- 其他 HTTP Direct Provider 必须携带逐线路的明确确认标记；React 仅在 Android 本机直连模式显示主题化风险提示，并在保存、测试或拉取模型前确认，不影响 FastAPI 后端地址。
- 三条携密请求均关闭实例级自动重定向，任何 3xx 都作为安全错误返回，要求用户填写最终 Base URL；不会把 API Key 或自定义请求头带往重定向目标。
- 已保存 Key 只能在 Provider 协议和规范化 Base URL 完全相同时复用。编辑线路改变 scheme、host、port、path 或协议后，必须重新填写 Key，避免旧密钥被自动继承到新目标。
- `usesCleartextTraffic=true` 保留，因为动态本机与 LAN 后端是产品能力；未新增无法覆盖任意局域网地址的静态 Network Security Config。

### 当前验证

- 纯 Java 策略测试覆盖 HTTPS、常见 LAN/loopback HTTP、公网 HTTP 明确确认、近似私网反例、凭据 scope，以及 301/302/303/307/308 双服务器不跟随验证。
- React 浏览器回归已验证 HTTP 警告、取消时零原生调用、确认标记、HTTPS 无弹窗及既有桌面/移动流程；production build 仍为 312 个模块。
- 发布门禁新增 `0.2.4` / versionCode `10` / Service Worker 一致性检查，GitHub Actions 在签名构建前运行 Android 安全、语音、React 回归与版本契约，并在 APK badging 中核对版本。
- 当前改动仅在本地工作树中；未提交、未推送、未创建 `v0.2.4` 标签或 Release，真实 Android Direct Provider 仍待固定签名 APK 真机验证。

## 2026-08-23 · v0.2.3 语音、字体、写作与自主能力（已发布，待真机）

> 本版只发布已经完成并通过自动化回归的 React / Android 功能。长期世界第二阶段仍在旧后端工作树中单独开发，不进入本次 APK，也不推送旧 HTML / FastAPI 仓库；旧 `/api/games` 的代码和公开行为不因本次 React 发布而改变。

### 本版收录

- 语音链路拆为 Android 原生 / 浏览器系统识别输入、严格单轮 `VoiceSession`、现有人格模型回复和系统 / MiniMax TTS 输出；权限拒绝、停止、切后台、返回键和人格切换统一清理。
- 随包加入 LXGW WenKai GB Lite v1.522 并设为默认正文，另提供书卷宋、清爽黑、仿宋和系统默认；日记、留言板、梦库、备忘样式均使用主题变量与派生色，不固定套用水色。
- 日记、留言板和梦库重新对照旧 HTML / FastAPI 契约：区分用户、共享、AI 空间与可见性，密封正文不进入普通聊天；Standalone 写作工具使用结构化调用、按次授权、人格绑定、幂等和预算限制。
- 自动唤醒采用用户可见任务账本、AI 提案待批准、租约、失败重试、次数上限和投递去重；仅在应用前台执行，关闭后下次打开补做，不声称拥有 Android 系统后台常驻能力。
- 子代理按人格配置，拥有独立提示与线路选择，只接收当前委托，不继承聊天历史、私人空间或工具；默认按次询问，每轮最多两次。工具开放与授权共用同一意图判定，避免“能调用却没有批准”的权限缝隙。
- 文楷字体的 OFL-1.1 文本与分发说明已经放入 `public/licenses/`，会随 Web 构建进入 APK；顶层 `NOTICE` 同步记录第三方字体来源与许可。

### 长期世界 Review 钉子

- [x] 本次 `v0.2.3` 只推 React / Android 仓库；旧 HTML / FastAPI 仓库与 `/api/games` 不修改、不发布，因此不会由本次 APK 偷偷改变旧角色剧场契约。
- [ ] 后续 LongWorld 即使使用独立 schema，也必须保持 repository / service 领域依赖真正隔离；只共享基础设施，不共享旧剧场领域事实，旧模块应可独立移除。
- [ ] 后续 replay 测试必须覆盖移动、物品转移、关系变化、任务推进、存档与 branch，并以 canonical serialization / hash 对初始 snapshot 重放后的 `WorldState` 做逐字节比较。

后两项属于未进入本 APK 的 LongWorld 后续验收条件，不是 `v0.2.3` React 功能的完成声明。

### 发布验证

- `npm run typecheck` 通过；`tests/react_regression_contracts.py` 34 项、`android/tests/test_voice_contract.py` 4 项契约通过。
- `tests/react_ui_smoke.py` 真浏览器移动端流程通过，覆盖自动唤醒、人格子代理配置、按次授权、委托执行、写作空间及关键浮层层级；`tests/react_voice_smoke.py`、Android Standalone 与 bridge 冒烟均通过。
- production build 通过（312 个模块）；`dist` 中已核对 v0.2.3 Service Worker、文楷字体及随包 OFL / NOTICE。`git diff --check` 通过，发布文件敏感信息扫描只命中测试假 Key，没有密钥、数据库或签名材料。
- 功能提交 `b136ec4` 已推送至 `feat/android-apk`；分支构建 `32641101991` 与 `v0.2.3` 标签固定签名构建 `32641269448` 均成功，公开 Release 为 <https://github.com/Yussica1026/Atherloom-React/releases/tag/v0.2.3>。
- 已从公开 Release 重新下载四个附件并复核：APK `11,687,725` 字节，包名 `app.atherloom.react`，versionCode `9`，versionName `0.2.3-react-release`；APK SHA-256 为 `3f40b575ebc234991563843cc8603fe400f4a0877bf2f53e219c4a04f1d1f3b2`，与公开 `.sha256` 一致。
- APK v2 签名验证通过，固定证书 SHA-256 为 `c31ec8be3956258e35b852545d43607ea87cbeefa805593633fa0e522033940a`；压缩包内已确认文楷字体、OFL-1.1 与 NOTICE。免登录直链：<https://github.com/Yussica1026/Atherloom-React/releases/download/v0.2.3/Atherloom-React-Android-release.apk>。
- 上述自动化与签名证据不替代真实设备验收；Android 权限弹窗、厂商识别、音频焦点 / 耳机、连续多轮和真实 MiniMax Key 仍必须在手机上测试。

## 2026-08-23 · AI 文字游戏 / 长期世界架构调研（第一阶段，仅分析）

> 本阶段按要求只检查现有 Atherloom React、配套 FastAPI 后端及三个参考项目，没有编写或迁移游戏功能代码。本节是用户要求补写的工作日志；除本日志外，本阶段未修改任何项目文件。

### 现有架构结论

- 前端继续保留 React 19 + TypeScript + Vite、`App / Sidebar / useWorkspace` 外壳、现有身份与 Persona、聊天、主题、世界书、语音和 Android Native Bridge，不重写已有页面或部署结构。
- 配套后端仍由 `claude-local-cn/backend/app.py` 中的 FastAPI + SQLite 提供 Provider、Persona、会话、记忆、世界书和流式聊天。现有角色剧场只有文本回合、角色 Provider 编排和简单状态，不具备严格 WorldState、规则校验、事件重放或长期一致性，因此保留为“轻量角色剧场”，不继续向其中堆叠长期世界逻辑。
- 新功能建议独立建立 `src/features/longworld/`、`src/adapters/longworld/` 与 `backend/game/`，只在 `App.tsx`、`Sidebar.tsx` 和后端 router 注册处做最小接入。
- 第一版使用 FastAPI 作为权威规则端；Android 离线实现留作独立里程碑，通过同一 Transport、Schema 和规则契约实现，不把长期世界状态继续塞进现有 `standalone/store.ts`。

### 主体与状态边界

- `Player` 是真人玩家，不绑定 Persona 或 Provider。
- `AICharacter` 是独立 AI 居民，拥有独立 Persona 快照、Provider / Model、游戏内状态、记忆和自主行动策略；主动行动仍必须走统一游戏回合服务。
- `NPC` 属于世界模板和运行实例，没有 Persona 或独立 Provider，由 Game Master / world engine 管理。
- 世界卡采用不可变的 `WorldTemplateVersion`，运行进度采用独立的 `WorldSession / Branch / Revision`。权威历史由追加式事件组成，快照只用于加速加载；存档指向确定 revision，恢复时创建分支而不是覆盖原进度。
- 物品只保存一个权威位置或所有者，库存与地点清单由该字段派生；关系、任务、条件、已发现事实、开放线索、地点图、电话线程和游戏时间均是一等 WorldState 字段。
- 游戏记忆使用独立 `game_memories`，按 AICharacter / NPC 的 owner、可见性和来源事件隔离，不能自动进入现实 Persona 记忆。只有已提交事件才能生成长期记忆。

### 权威回合流程

```text
Player action / AICharacter ActionIntent
→ 加载带 revision 的 WorldState
→ 按行动者视角裁剪可见事实并召回独立记忆
→ Story Director 规划节奏与允许揭露范围
→ Game Master 输出严格 TurnProposal
→ JSON Schema / Pydantic 校验
→ 服务端领域规则与全局不变量校验
→ 原子提交 WorldEvents 与新 revision
→ 根据已提交事件保存重要记忆
→ Narrator 读取 committed snapshot / diff 生成正文
→ 渲染 narration、dialogue 与状态变化
```

- LLM 不获得数据库、SQLite、文件写入或任意状态修改工具，只能提出严格判别的领域事件，例如移动、转移物品、更新关系、推进任务、发现事实、打开/解决线索和发送游戏内短信。
- 每次行动必须携带 `expected_revision` 与幂等键；全部候选事件先在状态副本中验证，通过后再整体提交。失败最多允许一次结构化修复，再失败则整回合不提交。
- 提交前只显示加载、规划、校验等进度；最终正文必须在状态提交后生成。Narrator 失败时使用已提交事件生成确定性简述，不能出现“正文已发生但事实提交失败”。

### 三个参考项目的只读结论

- **AI Sandbox Game**：可学习世界卡定义态/运行态分离、NPC `card/state`、存档交互、分层地点、探索和手机/SMS；其权威状态主要在浏览器端，校验与自动批准机制不满足本项目的服务器规则要求。框架为 AGPL-3.0，`prompts/` 另为 CC BY-NC-SA 4.0，因此只学习架构并 clean-room 重写，不复制代码、prompt、默认世界、素材或预构建 UI。
- **Quilltale**：可学习“LLM 负责叙事、程序负责事实”、结构化 WorldState、场景内 NPC 独立情景记忆和候选状态更新；其当前实现缺少严格 Schema、事务、revision 和提交后叙事。仓库当前没有 LICENSE，不能视为可复用开源代码，只采用抽象思想，不复制源码、GM prompt 或 `default.json`。
- **RPGForge**：可学习 Story Director、批准 delta 重放、任务 / 条件 / open threads / discovered facts、turn / chapter / long-term / narrative 多层压缩和上下文投影。仓库为 MIT；如后续实际复制实质代码或 prompt，必须保留版权和 MIT 文本并在 `NOTICE` 中记录固定提交。架构上仍需补齐独立 AICharacter、严格领域 Schema、库存与知识隔离，并改为 commit 后再展示正文。

### 第一阶段产物与下一步边界

- 已完成当前前后端架构、可复用组件、独立目录、数据模型、API、WorldState、Memory、AI 调用流程、UI 页面、文件清单、来源映射与许可证风险分析。
- 尚未新增数据库表、API、前端入口、世界卡、提示词、测试、构建产物或 APK，也没有执行代码迁移。
- 等用户确认进入第二阶段后，优先实现版本化 Schema、领域事件、规则不变量、事件重放、视角脱敏和并发/幂等测试，再接入模型编排与 UI。

## 2026-08-23 · 楷体默认与日记 / 留言板 / 梦库语义补齐（已并入 v0.2.3，待真机）

> 本节是 v0.2.2 发布后的开发过程记录；当前发布状态与最终验证以顶部 `v0.2.3` 节为准，真实 Android 手机验收仍未完成。

### 字体与主题

- 随包加入 LXGW WenKai GB Lite v1.522，并将文楷设为默认正文字体；无需联网拉取字体，也不会因 CDN 不可用退回不一致的字形。
- 外观设置提供文楷、书卷宋、清爽黑、仿宋和系统默认共 5 种正文方案，选择会本机持久化，并在页面首次绘制前恢复，避免启动时先闪过系统字体。
- 字体只改变字形，不建立一套独立固定配色。正文、卡片、输入、提示和选中态继续使用现有主题变量及派生色，跟随浅色、深色、水色、薄荷、丁香、腮红与系统主题统一套色。

### 日记

- React 日记改为调用统一 `fastApi` 日记接口；连接旧 FastAPI 时使用服务端 CRUD，Android Standalone 由本机适配层实现同一请求与返回语义，不再把本机列表冒充已同步的服务器内容。
- 恢复 `user / shared / ai` 空间，以及“用户可见 / AI 可见”两个互相独立的字段。密封 AI 日记只返回数量；普通主聊天只注入同时对用户和人格可见的日记 / 留言，密封正文只在隔离的私人日记生成模式中提供给所属人格，生成结果直接密封保存，不进入聊天回复。
- Android Standalone 生成允许用户阅读的 AI 日记时，会关闭写作空间的隐式上下文，只传入已显式筛选为用户可见的旧页，密封旧页不会经标题、摘要或中间步骤进入公开生成。旧 FastAPI 的 `/api/chat` 没有“只生成草稿、不产生服务端副作用”的模式，还会自动注入全部 `visible_to_ai` 日记且不回传可见性元数据；因此连接旧服务器时，React 的立即与定时 AI 日记生成全部禁用，避免临时会话先写入一次、React 再保存一次，或在生成阶段泄露密封内容。用户手写 CRUD 和旧 FastAPI 主聊天自带的受控工具写入不受影响。
- 新增、修改、删除均带正文长度限制、状态和失败反馈；归档删除会二次确认，并保留 AI 定时日记计划与运行审计，避免一次普通列表写入覆盖这些本机附加状态。

### 留言板

- 留言板改为统一 `fastApi` 读取、发布和删除，保留旧版 `reply_to` 回复关系、对 AI 的独立可见字段、密封数量和按人格隔离；留言只删除目标记录，不把回复或其他本机字段一并误删。
- Android Standalone 发布一条对 AI 可见的用户留言后，会持久化约 10 分钟后的唤醒任务；任务带租约、失败重试与最多 3 次限制，由所属人格读取可见线程后写回 AI 回复。WebView 存活时到点执行，应用被关闭时在下次打开后补做。
- AI 在其他人格留言板留下的新便笺进入跨人格未读便笺队列；工作区未打开时可显示便笺，用户可稍后查看、前往所属人格留言板或直接回复。已读集合和队列均设上限，避免无限增长。

### Standalone 主聊天写作工具循环

- Android Standalone 主聊天已接入日记 / 留言板工具循环：读取留言板、写 AI 日记和贴留言均使用严格 `input_schema` 与运行时类型、枚举、长度校验；工具始终绑定当前会话人格，模型参数不能改写 `persona_key`。写权限默认 `ask`，只在本轮用户确认后放行；设为 `deny` 时写工具不开放，留言读取仍只返回同时对用户与人格可见的记录。
- OpenAI 兼容与 Anthropic 线路优先执行原生结构化 `tool_calls / tool_use`。文本 DSML 仅作为只读留言查询的兼容入口，绝不触发写入；所有写操作必须来自原生结构化调用，避免引用文本或提示注入制造副作用。
- 工具循环最多 12 轮、总计 12 次调用、每轮最多执行 4 次，并服从用户设置的总超时；停止或超时会取消原生请求。相同用户消息、工具调用 ID 或相同内容会复用既有写入，同一轮最多写 4 篇日记或留言，避免重试造成重复记录。执行、复用、拒绝和错误均作为工具事件进入当前助手消息。
- 一旦本轮成功写入密封日记或密封留言，最终聊天只返回固定完成说明并清空推理文本；模型不能借后续回答复述、概括或暗示密封正文。

### 梦库

- “让 TA 做梦”改为读取目标人格全部会话中的最近 80 条真实消息，而不是借用当前会话最后几条或制造一个临时主聊天；没有可用片段时明确报错。
- 生成只把 `summary / raw_text / necropsy` 回填到可编辑草稿，不会自动入库。用户确认后才保存为普通梦境或隔离梦境；保存后的梦仍需通过单独操作显式认领，并可填写认领备注。
- 梦库按旧版设计不属于主聊天工具：没有梦境读取、生成、保存或认领工具。它继续走独立的“生成草稿 → 用户编辑 → 显式保存 → 隔离梦显式认领”流程，认领也不代表自动注入主聊天上下文。

### 数据安全与恢复

- Android Standalone 首次读取写作库时会按人格合并旧 HTML 的 `atherloom:journals:*`、`atherloom:board:*`、`atherloom:dreams:*` 与 `atherloom:board_wakes`，兼容旧作者、可见性、认领和唤醒字段；迁移按记录 ID 去重且不删除旧键，持久化失败会明确报错，不以空库冒充迁移成功。
- 旧唤醒记录中 `attempts >= 3` 的任务统一迁为 `error` 终态；Standalone 主状态与 React 镜像同时存在同一任务时，`done` 作为不可逆成功状态永远优先，其余终态再按新鲜度合并，避免未来时间的旧重试镜像把已完成任务改回错误或待执行。
- 日记、留言、梦境和唤醒任务由 API / Standalone 存储拥有；React 功能空间只持久化定时日记计划、审计和未读便笺等附加状态，不再把缓存列表回写覆盖 API 数据。连接 FastAPI 且首次加载尚未完成时隐藏本机缓存，以载入状态代替旧内容，防止把另一运行模式的数据误认成服务器结果。
- 选择性备份按勾选范围导出和恢复：外观包含主题与字体，聊天数据、世界书、记忆、游戏/生活簿等本机空间不再因选择其中一项而被整块混入。恢复完成后不会删除刚恢复的 Standalone 状态或恢复前快照。
- AI 私人日记使用的临时会话加入持久化清理队列：正常结束会删除，删除失败会在下次载入继续重试，同时这些会话始终从用户可见会话列表中过滤，避免异常退出后泄漏。

### 当时验证（后续结果见顶部 v0.2.3）

- 这一子阶段结束时 `npm run typecheck`、33 项回归契约和 4 项 Android 语音契约已通过；随后发布收尾扩展为顶部记录的 34 项，并重跑真浏览器、Standalone、bridge 与 production build。
- 这一节保留开发过程事实；最终工具链与发布证据统一记录在顶部 v0.2.3 节，不拿更早版本结果冒充本次验证。

### 当时边界

- 写下本节时尚未生成 APK 或推送 Release；当前发布进度见顶部 v0.2.3 节。真实 Android 手机验收仍未完成。
- 留言提醒会按运行方式给出不同事实：Standalone 且已有可用线路时说明约 10 分钟唤醒及应用关闭后下次打开补做；没有线路时明确要求先配置；连接旧 FastAPI 时只显示服务器返回，不声称存在本机定时任务。
- Android Standalone 主聊天的日记 / 留言板工具循环已经完成；梦库刻意不提供聊天工具，继续使用独立生成与归档流程。
- 旧 FastAPI 在普通聊天请求中会自动附带所有对 AI 可见日记，也没有无副作用草稿接口。React 因此在服务器模式禁用全部立即 / 定时 AI 日记生成；用户手写日记 CRUD 和旧 FastAPI 主聊天中已有的受权限控制日记 / 留言工具写入仍可用。待后端提供显式、安全、无副作用的草稿能力后再恢复 React AI 日记生成。
- 往来的联系人和信件继续使用既有 FastAPI 路径；完全本机的会客厅不能创建或读取真实服务器归档，需要连接后端后申请。真实 Relay 房间、提题、投票、计时、人格唤醒与归档状态机仍待迁移。

## 2026-08-23 · Android 语音稳定架构与 MiniMax TTS（已并入 v0.2.3，待真机）

> 本节是 v0.2.2 发布后的开发过程记录；当前发布状态与最终验证以顶部 `v0.2.3` 节为准，真实 Android 手机验收仍未完成。

### 问题定位与会话架构

- 用户真机截图中的“无法开始：Permission denied”来自旧语音页直接调用 WebView `getUserMedia` / Web Speech，而当时 Android Manifest 未声明录音权限，`WebChromeClient` 也未处理音频权限请求。旧 HTML 的 Android 测试版曾直接阻止通话页，并没有一条可作为稳定实现沿用的原生通话链。
- 语音现已拆为 `SpeechInputAdapter -> VoiceSession -> workspace.send -> SpeechOutputAdapter`。输入可自动优先 Android 原生识别或使用浏览器系统识别；模型轮次继续走当前人格、当前线路与现有会话；输出可选系统朗读或 MiniMax TTS。
- `VoiceSession` 严格串行执行“听一句 → 停麦 → 等人格回复 → 播放”。同一时刻只允许一个识别、一个模型轮次或一个播放；朗读完成后才可按设置继续下一轮。权限拒绝、无语音、超时和播放失败都会终止，不再靠 `onend` 无限重启。
- 结束、关闭、进入语音设置、Android 返回键、人格切换、页面隐藏、卸载和 Activity 暂停/销毁都会取消识别、停止在途模型请求、停止播放并使迟到回调失效，避免隐藏通话页仍占麦克风或把 TTS 再识别为用户输入。

### Android 原生输入与权限

- Manifest 增加 `RECORD_AUDIO`、可选麦克风声明和系统 `RecognitionService` 查询；运行时权限拒绝会回传明确中文错误并停止，不自动重试。
- 新增单会话 `NativeSpeechController`，在 Android 主线程管理 `SpeechRecognizer`，包含 30 秒看门狗、会话代次隔离和 `onPause / onResume / onDestroy` 清理。React 通过 `startSpeechRecognition / stopSpeechRecognition` 调用，并由 `window.AtherloomNativeVoice` 接收 `ready / result / error / end`。
- WebView 权限路径仅信任内置 `appassets.androidplatform.net` 来源，并且只授予 `RESOURCE_AUDIO_CAPTURE`；不会把网页请求的其他资源一起放行。

### MiniMax TTS 与密钥边界

- 按 MiniMax 当前官方公开目录，MiniMax 在本实现中只承担 TTS，不承担 ASR；旧 Realtime 已属于历史接口。当前第一阶段使用 HTTP `POST /v1/t2a_v2`，后续才考虑双向文本流 TTS。
- Android 原生 `MiniMaxSpeechController` 只允许中国大陆 `api.minimaxi.com` 或海外 `api.minimax.io` 两个固定 HTTPS 主机，不接受前端传入任意基础地址。请求检查 HTTP 状态、`base_resp.status_code`、`trace_id` 与非空音频，再写入临时 MP3 并通过 `MediaPlayer` 播放；完成、失败、替换、取消和退后台都会断开连接、释放播放器并清理缓存。
- MiniMax API Key 在密码输入和保存桥接时短暂经过页面内存，保存后明文只留在 Android `EncryptedSharedPreferences`。React 持久化配置、`localStorage`、日志和明文备份只保留公开参数与 `has_api_key`，合成请求的 JavaScript payload 不含 Key。浏览器 / FastAPI 模式不会降级保存 Key，需另建服务端安全代理后才能启用 MiniMax 输出。
- 系统与 MiniMax 输出会按标点分段顺序播放；MiniMax 正常链路每段不超过 240 字符，原生层另有 2,000 字符、8 MiB 响应和 `Content-Length` 硬上限。连接不认识新设置字段的旧 FastAPI 时，React 本机公开配置覆盖层会保住所选语音链路，但仍不会保存 Key。
- 语音设置新增输入来源、输出来源、语言、自动继续、MiniMax 区域、模型、`voice_id`、语速、音量、音高、Key 保存与试听；界面明确展示实际链路和平台限制。完整设计见 [`docs/VOICE_ARCHITECTURE.md`](docs/VOICE_ARCHITECTURE.md)。

### 当前验证与发布边界

- `npm run typecheck` 与 production `npm run build` 通过；发布收尾时 `tests/react_regression_contracts.py` 已扩展为 34 项通过。
- `tests/react_voice_smoke.py` 通过，覆盖严格识别/模型/TTS 顺序、识别互斥、停止不重启、权限拒绝不重试、Android 返回键清理、MiniMax 长回复分段原生调用和 Key 不进入任一本机网页存储值。
- `android/tests/test_voice_contract.py` 覆盖 Manifest、可信来源音频授权、识别控制器生命周期、MiniMax 加密存储、固定域名、响应校验、播放器和取消契约。
- 既有 `tests/react_ui_smoke.py`、`scripts/android_standalone_test.py` 与 `scripts/android_bridge_test.py` 均通过。UI 回归同时发现并修复会客厅本机配置保存成功提示会被配置同步 effect 立即清空的问题；邀请码仍会在配置变更后失效。
- 上述是浏览器与静态契约验证，不等同于真机。仍需真实 Android 验证权限首次授予/拒绝/永久拒绝、厂商识别服务、连续多轮、前后台、音频焦点/耳机，以及真实 MiniMax Key、音色、限流、弱网和余额错误。
- v0.2.3 已完成 Android Gradle 固定签名构建与公开附件、包信息、哈希和证书核验；真实手机回归继续作为发布后的明确待验边界。

## 2026-08-23 · v0.2.2 截图复原、主题套色与真实往来边界（已发布，待真机）

> 8 个唯一原图继续保存在本机并排除在 Git 之外；逐图结构与隐私说明见 [`docs/SCREENSHOT_REFERENCE_2026-08-21.md`](docs/SCREENSHOT_REFERENCE_2026-08-21.md)。本节记录 v0.2.2 的实现、自动化验证与公开发布；旧 FastAPI 后端没有修改或推送，真实 Android 手机仍待验收。

### 用户名与设置入口

- 点击侧栏账号区会关闭侧栏并直达“外观”，当前设置标签会自动滚入可见区，用户名输入获得初始焦点；输入、保存、成功和后端未实际保存时的失败原因均可见。
- 新安装继续保持空用户名和中性头像；账号按钮的读屏名称包含已设置用户名。设置与功能工作区均增加焦点圈定、背景 `inert`、Esc 关闭和关闭后焦点恢复。

### 往来

- 恢复独立全屏 `AI CORRESPONDENCE / 往来`，包含“信箱 / 会客厅 / 通信记录”三页签；信纸折角、联系人区、完整知情卡、会客厅规则卡和设置表单按旧截图层级复原。
- FastAPI 模式真实连接旧后端概览、联系人申请、用户批准/撤回、封禁和寄信接口。寄信后检查服务器 `delivered / blocked` 状态与安全原因，不能把 HTTP 200 或本地保存冒充已送达；旧后端不支持解除封禁，因此前端不提供假按钮。
- Android 纯本机模式尚无往来服务：审批和投递按钮禁用，明确引导连接后端；旧 `localStorage` 模拟记录只读标为“旧版本机记录”，通信记录也不会伪装成服务器审计。
- 会客厅当前是明确标注的规则预览，可保存本机偏好，并在 FastAPI 支持时请求一次性邀请码；固定 `05:00` 和席位不再伪装成运行中状态。真实 Relay 席位、提题、投票、计时、唤醒与归档状态机仍未迁入 React，不能判定完整会谈已完成。

### 日记、留言板与梦库

- 三个入口合并为同一 `LOCAL WORKSPACE / 设置` 全屏工作区，保留设置横向导航、当前人格标签和“日记 / 留言板 / 梦库”内页签；切页同步回到顶部。
- 日记恢复标题、空间、正文、可见标记以及现有 AI 私人/定时日记与审计；留言板恢复大编辑区、卡片、回复和移除；梦库恢复“让 TA 做梦”、梦名、正文和归档方式。
- AI 梦境使用所属人格的隐藏临时会话和近期真实对话片段，结束后删除临时会话，不污染主聊天；异步生成使用函数式追加，避免覆盖生成期间的新梦境。
- Android Standalone 会把标记共享的本机空间注入所属人格上下文；FastAPI 聊天尚未接入这份本机空间，因此界面会明确显示“已标记共享 · FastAPI 暂不读取”，不伪称当前人格可读。

### 主题、侧栏与移动端

- 主题数量复核：外观界面共 7 个选项——跟随系统、浅色、深色、水色、薄荷绿、丁香、腮红。严格按独立配色计算是 6 套；“跟随系统”只是根据系统状态在浅色/深色间自动选择，不是额外的固定配色。代码高亮的“跟随主题/浅色/深色/高对比度”属于另一组显示设置，不计入应用主题数量。
- 新工作区没有写死 `#hex`、`rgb()` 或 `hsl()`：背景、表面、边线、文字和强调状态全部来自当前主题变量及 `color-mix()` 派生色。水色截图只用于结构对照，浅色、深色、薄荷、丁香、腮红会整体同步套色。
- 新增可读强调色与次要文字派生 token，避免暗色和薄荷主题的小字/席位对比度过低；输入控件恢复明确键盘焦点环，移动端关键按钮至少 44px。
- 侧栏恢复旧版纵向节奏并改用 `currentColor` SVG 图标；游戏库和云芽庭院仍按既定范围不恢复。手机关闭侧栏会退出可见/可聚焦树。

### 当前验证

- TypeScript typecheck、25 项回归契约均已通过；桌面与 390×844 手机真实 Playwright 流程在最终状态连续 3 轮通过。UI 流程覆盖空用户名直达与保存、工作区计算色随水色→丁香→水色真实变化、Standalone 往来禁用态、FastAPI 联系人双重批准/寄信/审计、会客厅配置、日记、留言板、AI 梦境、浮层头部视口边界和逐页截图，控制台与页面错误为 0。
- production build 通过（304 个模块）；现有主包约 597 kB，Vite 仅给出分包建议，不影响本轮功能验证。
- Android Standalone 与 FastAPI 桥接脚本均通过；真实旧 FastAPI 的 Provider、人格、世界书、备份、会话、七种主题、手机宽度和流式聊天完整流程通过，测试产生的临时记录已精确清理，未触碰用户数据。
- 功能提交 `a61442c` 已推送至 `feat/android-apk`，分支构建 `32613300597` 与 `v0.2.2` 标签构建 `32613718762` 均成功；公开 Release 已生成固定签名 APK。
- APK 大小 `3,075,952` 字节，包名 `app.atherloom.react`，versionCode `8`，versionName `0.2.2-react-release`；APK SHA-256 为 `cde3fca69b77615de5166c33a443f899a588bc7865b709ce484a34d63c970b1d`，固定证书 SHA-256 仍为 `c31ec8be3956258e35b852545d43607ea87cbeefa805593633fa0e522033940a`，v2 签名验证通过。
- 已从公开 Release 重新下载 APK、校验声明哈希、包信息、签名和内置 React 资源；免登录直链：<https://github.com/Yussica1026/Atherloom-React/releases/download/v0.2.2/Atherloom-React-Android-release.apk>。
- 自动化截图位于 `artifacts/react-mobile-*.png`，已人工核对水色主题的侧栏、用户名、往来三页及日记/留言板/梦库。真实 Android 手机安装与真实 Relay 会谈仍未验证。

## 2026-08-21 · v0.2.1 私人日记、输出方式与旧界面复原

### AI 私人日记补全

- 日记不再只有用户手写 CRUD。当前人格可以通过独立临时会话自行写日记，生成内容直接写入人格隔离的日记空间；临时会话完成后立即删除，不进入主聊天列表、当前消息或回答版本。
- 增加“立即写一篇”、定时间隔、每日上限、可选写作线索和“允许用户阅读 / 密封只显示数量”。AI 日记始终对所属人格可读，密封内容不在日记界面展示正文。
- 增加持久化运行审计：手动、定时、重新打开后的补写分别记录开始、完成、失败和达到每日上限后的跳过；审计只保存状态与日记 ID，不复制正文。
- WebView 完全关闭时 JavaScript 无法常驻，界面已明确说明：应用打开时到点执行；关闭期间错过的计划在下次打开后补写。失败任务 15 分钟后再试，避免一分钟一次重复请求。

### 输出、思考与欲望状态

- API 线路的输出方式改为明确的“流式 / 非流式”二选一；聊天右上角新增旧 HTML 的人格状态入口，可以查看九维欲望高位项、心跳、模型、输出和思考状态，也能直接切换当前线路输出方式。
- Android Standalone 新增真实上游 SSE 流式桥，不再把本机模式的“流式”伪装成整段返回；非流式仍等待完整结果后一次显示。OpenAI 兼容与 Anthropic 流均分别解析正文和 reasoning。
- 主聊天显式传递当前线路的 thinking 开关。历史消息和流式消息的思考过程默认展开，标题提示“点击收起”，用户收起后不会被普通 React 重绘强制再次展开。

### 旧 HTML 界面与交互复原

- 对照 `frontend/index.html` 和旧工作日志，把珍藏、生活簿、往来、共创空间、日记与留言重新放回侧栏左上区域；共创空间与日记组恢复可展开子项。按既定范围不加入游戏库、云芽庭院和 AI 会客厅。
- 聊天页右上角仍没有重复设置按钮；新增的是旧版“聊天状态 / 欲望”入口。完整备份导出继续只放在“设置 → 备份与恢复”，顶部向下箭头仅导出当前对话的脱敏 Markdown。
- 修复 Android 取消文件保存后错误提示一直压在聊天界面：提示现在 6 秒自动消失，并提供立即关闭按钮。
- 修复外观页用户名无法可靠输入/保存：改为受控输入与独立“保存用户名”按钮，显示保存中、成功或失败结果，不再依赖输入框失焦。
- 面向分发清理用户身份默认值：新安装的 `display_name` 保持空字符串，未设置时侧栏只显示“设置用户名”和中性圆点头像；测试夹具也不再使用个人名字。

### 本轮验证（发布前）

- TypeScript typecheck、Vite production build：通过（304 个模块）。
- 旧版错误结构契约：20 项通过，新增私人日记隐藏临时会话、审计、Android 本机流式、默认展开思考、旧侧栏顺序、临时导出提示与用户名保存契约。
- 真实 Playwright 桌面与 390×844 手机回归：通过；覆盖线路创建/拉模型/测试/保存、人格与主动提问、用户名、欲望状态、流式切换、思考展开、消息版本/分支、日记生成与审计、侧栏布局和取消导出提示，控制台与页面错误为 0。
- Android Standalone 回归：通过；系统剪贴板、加密线路、模型拉取/测试、Key 留空复用、备份脱敏、本机持久化与原生模型请求均无 FastAPI 网络回退。
- Android FastAPI 原生桥回归：通过；异步保存、人格隔离、会话状态、搜索/删除、备份导出与选择性恢复均未回退到浏览器网络。
- 版本为 `0.2.1-react-release` / versionCode `7`；GitHub Actions `32460238293` 已完成 React、Gradle、包名和固定签名全流程检查并成功发布。
- `v0.2.1` Release 已公开：APK 3,046,884 字节，包名 `app.atherloom.react`；固定证书 SHA-256 指纹仍为 `c31ec8be3956258e35b852545d43607ea87cbeefa805593633fa0e522033940a`。
- APK SHA-256 为 `fcbeeea4a48ea98ad0031dfb8f1b12bd846fa17358ed235ff64190191903a459`；免登录直链实测 HTTP 200 且返回字节数一致：<https://github.com/Yussica1026/Atherloom-React/releases/download/v0.2.1/Atherloom-React-Android-release.apk>。

## 2026-08-21 · v0.2.0 旧版功能迁移与稳定性复核

### 用户问题修复

- 修复设置“保存无效”：所有设置在 React 状态中先乐观更新，再按顺序持久化；迟到响应不会覆盖新值。修正字体缩放单位与旧 FastAPI 校验不一致造成的 422。
- 修复 Android API Key 粘贴无效：调用系统剪贴板；已保存 Key 留空时由加密存储复用，不会被空值擦除。
- 修复模型拉取与测试：Android 原生桥真实请求上游模型列表和当前模型，显示 HTTP 状态与上游详情；测试请求关闭无关 thinking，避免探测被推理协议拖垮。
- 恢复“允许助手主动提问”的可点击保存，并实现正文结构化问题选项卡、选中态和输入框回填。
- 删除聊天页右上角重复设置入口；设置只从侧栏用户区域进入。

### 聊天与人格

- 完成消息复制、珍藏、修改、重新 Roll、回答版本切换、创建分支、删除当前版本和删除全部版本。
- 完成会话重命名、置顶、星标、归档、搜索、逐条删除和清空当前人格全部对话。
- 会话、最近窗口、草稿、专属线路、记忆、共同空间和九维状态按人格隔离；打开/切换请求使用代次守卫，避免迟到响应串线。
- 长按删除改为旧版华为真机最终验证过的 320ms：长按只展开全宽删除区，第二次点击才删除；移动超过 12px 取消。
- 增加附件、视觉线路、快捷短语、世界书选择、主动压缩、语音通话和脱敏 Markdown 导出。

### 设置、记忆与空间

- 加入自动总结、记忆生命周期、MCP 管理、工具权限/搜索/向量线路、九维动机、数据健康及完整外观设置。
- MCP 支持测试、工具刷新、逐工具权限与脱敏导入导出；Android 本机模式明确提示执行需 FastAPI。
- 加入珍藏、生活簿、联系人/信箱、日记、留言板、梦库、本地 PDF/TXT 共读、本地影片字幕陪看、本地音频歌词陪听、角色剧场与 TXT 导出。
- 角色剧场模型回复写回当前剧本；读取室修复 PDF.js Worker/销毁、中文旧编码和书签跳转。
- 备份覆盖 React 本机空间数据并排除 API Key、搜索 Key、MCP Token/头/环境变量及原始本机状态块。
- 新增 PWA 离线壳；更新只在下次打开时接管，不刷新正在进行的聊天或共读。

### 旧版错误结构复核

- 将失败回答排除出版本时间线；修改/删版本同步作废摘要与归档 ID。
- 消息模板只处理发给模型的副本，界面与本地保存保留用户原文。
- 生成状态先绘制两帧，再运行自动压缩和网络前置逻辑。
- Android 返回键先关闭语音、压缩、功能空间、设置和侧栏；HTTP 错误保留状态码。
- 详细逐项对照见 `docs/LEGACY_PARITY_AUDIT.md`，结构契约见 `tests/react_regression_contracts.py`。

### 明确暂缓

- 云芽庭院、全部游戏、AI 会客厅按用户要求暂不加入 React 0.2.0。

### 验证记录

- TypeScript typecheck 与 production build：通过（304 个模块）。
- 旧版错误结构契约：17 项通过。
- 开发服务器与 production preview 各完成一轮真实 Playwright smoke；桌面与 390×844 手机视口均通过，浏览器控制台与页面错误为 0。
- Android 本机没有 Gradle CLI，固定签名 APK 由 GitHub Actions `32449259994` 构建成功。
- `v0.2.0` Release 已公开：APK 3,025,788 字节，包名 `app.atherloom.react`，versionCode `6`，versionName `0.2.0-react-release`。
- 固定证书 SHA-256 指纹核对通过；APK SHA-256 为 `21db7f38396007940286eac63273427671363c04ecf2dc0f1d8f4b9da6b5b697`。
- 免登录直链已实测 HTTP 200：<https://github.com/Yussica1026/Atherloom-React/releases/download/v0.2.0/Atherloom-React-Android-release.apk>。
