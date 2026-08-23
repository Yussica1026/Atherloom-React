# 语音架构

状态日期：2026-08-23

> 本文描述已随 v0.2.3 固定签名 APK 发布的语音实现。APK 哈希、包信息与证书已核验；真实 Android 手机上的麦克风、系统识别和音频播放验收仍未完成。

## 目标与边界

语音通话不另建一套聊天协议，而是在现有当前人格会话外增加可替换的语音输入和语音输出：

```text
SpeechInputAdapter
  -> VoiceSession
  -> workspace.send（当前人格、当前线路、现有会话）
  -> SpeechOutputAdapter
```

- `SpeechInputAdapter` 只负责“听一句并返回文字”。当前可自动优先选择 Android 原生 `SpeechRecognizer`，也可显式使用浏览器 Web Speech。
- `VoiceSession` 是唯一的编排层，负责阶段、单轮互斥、取消和迟到结果隔离。
- `workspace.send` 继续使用主聊天的当前人格、模型线路、会话和世界书，不复制模型请求实现；停止语音中的模型轮次时复用 `workspace.stop`。
- `SpeechOutputAdapter` 只负责朗读文字。当前可选系统 `speechSynthesis` 或 Android 原生安全桥后的 MiniMax TTS。

系统朗读和 MiniMax 输出都会先按自然标点切分长回复；MiniMax 正常链路的每段不超过 240 个字符并严格顺序播放。这样不会为了整段长回复一次性在旧设备中保留大块语音响应，停止时也只需取消当前段。

MiniMax 不是语音输入源。按当前官方公开接口目录，MiniMax 提供文字转语音（TTS），没有可作为本实现输入层的独立 ASR 接口；旧 Realtime 接口已列入历史接口。因此设置页明确显示“系统 / Android 识别 → 人格线路 → MiniMax TTS”，不把它描述成 MiniMax 端到端实时语音。参考 [MiniMax API 目录](https://platform.minimaxi.com/docs/llms.txt)、[HTTP T2A v2](https://platform.minimaxi.com/docs/api-reference/speech-t2a-http) 与 [历史接口说明](https://platform.minimaxi.com/docs/faq/history-query)。

## 严格单轮状态机

一个会话只允许一个进行中的输入、模型请求或输出：

```text
idle
  -> requesting
  -> listening
  -> thinking
  -> speaking
  -> listening（仅 auto_continue 开启且上一轮播放正常结束）

任意阶段 -> stopped / error
```

每轮固定执行以下顺序：

1. 请求权限并启动一次识别。
2. 收到最终文字后结束本次收音。
3. 等待当前人格模型返回正文；这一段不会重新开麦。
4. 完整朗读回复；播放完成前不会启动下一次识别。
5. 只有开启“朗读结束后自动继续听”时，才进入下一轮。

权限拒绝、没有识别服务、无语音、网络错误、超时、模型失败和播放失败都结束当前会话，并把明确原因交给界面。状态机不会在错误后定时自启，也不会在模型思考或 TTS 播放期间收音，因此避免旧实现的重复识别、识别器忙和把扬声器声音再次识别成用户输入。

## 生命周期与取消

`VoiceSession.stop()` 和 `destroy()` 同时处理输入、模型与输出：

- 正在听时停止 Android `SpeechRecognizer` 或浏览器识别。
- 正在等待模型时调用主聊天的停止生成，并用会话代次忽略迟到结果。
- 正在播放时取消系统 TTS，或断开 MiniMax HTTP 请求、释放 `MediaPlayer` 并清理临时音频。
- 每次新会话使用新的 callback ID；旧原生事件不能落入新会话。

下列入口都会触发清理：结束按钮、关闭通话、进入语音设置、Android 返回键、人格切换、页面隐藏、`pagehide`、React 卸载、Android `onPause` 与 `onDestroy`。原生识别有 30 秒看门狗，浏览器和桥接适配器也有超时；系统 TTS 与 MiniMax TTS 均有最长等待限制，不能无限占用资源。

## Android 原生桥

React 通过 `window.AtherloomNative` 发起动作，两个原生控制器统一通过 `window.AtherloomNativeVoice(callbackId, json)` 回传事件。

| 方法 | 方向 | 用途 |
| --- | --- | --- |
| `startSpeechRecognition(callbackId, languageTag)` | React → Android | 启动一次系统语音识别 |
| `stopSpeechRecognition(callbackId)` | React → Android | 取消对应识别会话 |
| `getVoiceProfile()` | React → Android | 读取不含 Key 的公开 MiniMax 配置与 `has_api_key` |
| `saveVoiceProfile(raw)` | React → Android | 校验并写入 MiniMax 配置和 Key |
| `synthesizeSpeechAsync(raw, callbackId)` | React → Android | 调用 MiniMax T2A 并播放结果 |
| `cancelSpeechSynthesis(callbackId)` | React → Android | 取消网络请求或播放并释放资源 |

识别事件为 `ready / result / error / end`，TTS 事件为 `started / error / end`。回调只携带文字、错误码、错误说明和可用时的 MiniMax `trace_id`，不回传 API Key。

Android 侧还包含以下约束：

- Manifest 声明 `RECORD_AUDIO`，麦克风硬件为可选，并查询系统 `RecognitionService`。
- 运行时权限拒绝会以 `permission_denied` 终止，不进入自动重试。
- WebView 只允许本地 `appassets.androidplatform.net` 来源申请音频采集，并且只授予 `RESOURCE_AUDIO_CAPTURE`，不会把请求中的全部资源一并放行。
- 原生识别器始终在主线程创建和销毁，同一时间只有一个会话；暂停、替换、超时和销毁都会取消并释放识别器。

## MiniMax TTS 与密钥边界

当前第一阶段使用官方 HTTP `POST /v1/t2a_v2`，优先可取消和可诊断；尚未接入 WebSocket 或双向文本流 TTS。区域只允许映射到两个固定 HTTPS 地址：

- 中国大陆：`https://api.minimaxi.com/v1/t2a_v2`
- 海外：`https://api.minimax.io/v1/t2a_v2`

当前允许 `speech-2.8-turbo`、`speech-2.8-hd`、`speech-2.6-turbo` 和 `speech-2.6-hd`；默认使用偏低延迟的 `speech-2.8-turbo`。原生层同时检查 HTTP 状态、`base_resp.status_code === 0`、`trace_id` 和非空 `data.audio`，再把十六进制 MP3 写入缓存并由 `MediaPlayer` 播放。

安全边界如下：

- 用户填写 Key 时，它会短暂存在于密码输入框和一次原生桥调用中；保存完成后明文只留在 Android `EncryptedSharedPreferences`，不会持久化到 React 配置、`localStorage`、日志或明文备份。
- React 公共配置只保存区域、模型、`voice_id`、语速、音量、音高和 `has_api_key`；合成 payload 不携带 Key。
- 公开语音配置另有本机覆盖层，因此连接尚不认识 `voice_config` 的旧 FastAPI 时不会被服务器响应重置；这一层仍不包含 Key。
- 原生层根据受控区域选择固定域名，不接受前端传入任意 `base_url`，并在原生网络层添加 Bearer Authorization。
- Android 应用禁用系统备份；合成音频只写入缓存，完成、失败、取消和销毁后都会尽力清理。
- MiniMax 原生入口还限制单段最多 2,000 字符、响应最多 8 MiB，并预检 `Content-Length`；正常 React 链路使用更小的 240 字符分段。
- WebView 导航只把内置 HTTPS 资产留在应用内，远程主框架链接交给外部浏览器、远程子框架直接阻止；页面 CSP 禁止 frame / object / base。现有 `addJavascriptInterface` 仍应长期迁移到按 origin 放行的消息桥。
- 浏览器 / FastAPI 模式不会把 Key 降级保存到网页；要支持 MiniMax 输出，需先实现服务端安全代理。

## 自动化覆盖

- `tests/react_voice_smoke.py`：验证“识别 → 模型 → TTS”的严格顺序、同一时间最多一个识别、手动停止不重启、权限拒绝不重试、Android 返回键清理、MiniMax 长回复分段原生调用，以及 Key 不进入任一本机网页存储值。
- `android/tests/test_voice_contract.py`：验证 Manifest 权限、WebView 只授予可信本地来源的音频采集、识别桥和生命周期清理、MiniMax 固定域名、加密存储、响应校验、播放器和取消入口。
- `tests/react_regression_contracts.py`：继续守住聊天、设置、返回键、备份脱敏和旧功能迁移的结构契约。

这些测试证明状态与桥接契约，没有替代真实设备验收。

## 发布前仍需验证

- 在至少一台真实 Android 手机上验证首次授权、拒绝后重新授权、永久拒绝、系统无可用识别服务和连续多轮。
- 验证前后台切换、锁屏、Android 返回键、来电 / 音频焦点、扬声器与蓝牙耳机切换时不会残留识别器或播放器。
- 使用真实 MiniMax 账号验证中国大陆 / 海外区域、有效与无效 Key、默认及自定义 `voice_id`、限流、余额不足、长回复和弱网，并用 `trace_id` 对照服务端问题。
- production build、Android Gradle 构建、固定签名与公开附件核验已完成，最终证据记录在工作日志中；仍需按本节清单完成真实手机语音验收。
- 后续若接 MiniMax 双向文本流 TTS，必须继续遵守单轮互斥与同一密钥边界；如需网页 / FastAPI 使用 MiniMax，应先增加服务端代理，不能把 Key 放进前端。

## 主要实现位置

- `src/features/voice/types.ts`：适配器、配置、能力与阶段类型。
- `src/features/voice/adapters.ts`：Android / 浏览器输入和系统 / MiniMax 输出适配器。
- `src/features/voice/VoiceSession.ts`：严格单轮状态机。
- `src/features/chat/VoiceCall.tsx`：通话界面与页面生命周期。
- `src/features/settings/VoiceSettings.tsx`：输入、输出和 MiniMax 公共配置。
- `android/app/src/main/java/app/atherloom/react/NativeSpeechController.java`：Android 系统识别。
- `android/app/src/main/java/app/atherloom/react/MiniMaxSpeechController.java`：安全 HTTP T2A、播放与清理。
