import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AppSettings } from "../../domain/types";
import { createSpeechOutput } from "../voice/adapters";
import { minimaxSpeechModels, normalizeVoiceConfig, type VoiceConfig } from "../voice/types";

interface VoiceSettingsProps {
  settings: AppSettings;
  onSave: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}

type VoiceDraft = VoiceConfig & { api_key: string };

function draftFromSettings(settings: AppSettings): VoiceDraft {
  return { ...normalizeVoiceConfig(settings.voice_config), api_key: "" };
}

function parseNativeProfile(raw: string) {
  const payload = JSON.parse(raw) as { ok?: boolean; error?: string; profile?: Partial<VoiceConfig["minimax"]> } & Partial<VoiceConfig["minimax"]>;
  if (payload.ok === false) throw new Error(payload.error || "读取 Android 语音凭据失败");
  return payload.profile && typeof payload.profile === "object" ? payload.profile : payload;
}

export function VoiceSettings({ settings, onSave }: VoiceSettingsProps) {
  const [draft, setDraft] = useState<VoiceDraft>(() => draftFromSettings(settings));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<ReturnType<typeof createSpeechOutput> | null>(null);
  const hasNativeSpeech = Boolean(window.AtherloomNative?.startSpeechRecognition);
  const hasNativeMiniMax = Boolean(window.AtherloomNative?.saveVoiceProfile && window.AtherloomNative?.synthesizeSpeechAsync);

  useEffect(() => {
    const next = draftFromSettings(settings);
    try {
      const raw = window.AtherloomNative?.getVoiceProfile?.();
      if (raw) {
        const profile = parseNativeProfile(raw);
        next.minimax = { ...next.minimax, ...profile, has_api_key: Boolean(profile.has_api_key) } as VoiceConfig["minimax"];
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取 Android 语音设置失败");
    }
    setDraft(next);
  }, [settings.voice_config]);

  useEffect(() => () => previewRef.current?.destroy(), []);

  const update = <K extends keyof VoiceDraft>(key: K, value: VoiceDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateMiniMax = <K extends keyof VoiceConfig["minimax"]>(key: K, value: VoiceConfig["minimax"][K]) => {
    setDraft((current) => ({ ...current, minimax: { ...current.minimax, [key]: value } }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus("正在保存语音架构设置…");
    try {
      let hasApiKey = Boolean(draft.minimax.has_api_key);
      if (draft.output_provider === "minimax") {
        if (!draft.minimax.voice_id.trim()) throw new Error("请填写 MiniMax voice_id");
        if (!hasNativeMiniMax) throw new Error("MiniMax Key 不能保存在网页代码中；请使用带安全原生桥的 Android 版本");
        if (!hasApiKey && !draft.api_key.trim()) throw new Error("首次启用 MiniMax 时需要填写 API Key");
        const raw = window.AtherloomNative!.saveVoiceProfile!(JSON.stringify({ ...draft.minimax, api_key: draft.api_key.trim() }));
        const saved = parseNativeProfile(raw);
        hasApiKey = Boolean(saved.has_api_key);
        if (draft.api_key) setDraft((current) => ({ ...current, api_key: "" }));
      }
      const publicConfig = normalizeVoiceConfig({
        ...draft,
        minimax: { ...draft.minimax, has_api_key: hasApiKey },
      });
      await onSave({ voice_config: publicConfig });
      setDraft((current) => ({ ...current, ...publicConfig, api_key: "" }));
      setStatus(draft.output_provider === "minimax" ? "语音设置已保存，MiniMax Key 只保存在 Android 加密存储中。" : "语音设置已保存。当前使用系统朗读，不消耗 MiniMax 额度。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "语音设置保存失败");
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    setBusy(true);
    setStatus("正在播放试听…");
    try {
      previewRef.current?.destroy();
      const config = normalizeVoiceConfig(draft);
      const output = createSpeechOutput(config);
      previewRef.current = output;
      await output.speak("你好，这里是 Atherloom 语音通话试听。", config.language);
      setStatus("试听完成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "试听失败");
    } finally {
      previewRef.current?.destroy();
      previewRef.current = null;
      setBusy(false);
    }
  };

  return <section className="settings-section settings-feature voice-settings">
    <div className="section-heading">
      <h3>语音通话</h3>
      <p>输入、人格回复、语音合成和播放已拆成独立适配层。MiniMax 当前只负责 TTS；麦克风输入仍由 Android 原生或浏览器系统识别提供。</p>
    </div>
    <div className="settings-edit-card voice-architecture-card">
      <strong>当前链路</strong>
      <p>{draft.input_provider === "browser" ? "浏览器系统识别" : hasNativeSpeech ? "Android 原生识别" : "自动选择系统识别"} → 当前人格模型线路 → {draft.output_provider === "minimax" ? "MiniMax TTS" : "系统朗读"}</p>
      <small>每轮严格执行“听一句 → 停麦 → 等回复 → 播放”，关闭、返回、权限拒绝和播放失败都会清理资源，不再后台反复启动。</small>
    </div>
    <form className="settings-form settings-edit-card" onSubmit={save}>
      <label>语音输入
        <select value={draft.input_provider} onChange={(event) => update("input_provider", event.target.value as VoiceConfig["input_provider"])}>
          <option value="auto">自动选择（Android 优先原生）</option>
          <option value="native" disabled={!hasNativeSpeech}>Android 原生识别</option>
          <option value="browser">浏览器系统识别</option>
        </select>
      </label>
      <label>回复朗读
        <select value={draft.output_provider} onChange={(event) => update("output_provider", event.target.value as VoiceConfig["output_provider"])}>
          <option value="system">系统文字转语音</option>
          <option value="minimax">MiniMax Speech</option>
        </select>
      </label>
      <label>识别语言
        <select value={draft.language} onChange={(event) => update("language", event.target.value)}>
          <option value="zh-CN">普通话</option>
          <option value="zh-HK">粤语 / 中文（香港）</option>
          <option value="en-US">English</option>
          <option value="ja-JP">日本語</option>
        </select>
      </label>
      <label className="check-row voice-auto-continue"><input type="checkbox" checked={draft.auto_continue} onChange={(event) => update("auto_continue", event.target.checked)} /><span>朗读结束后自动继续听</span></label>

      {draft.output_provider === "minimax" ? <>
        <div className="span-all form-divider"><strong>MiniMax TTS</strong><small>使用官方 HTTP T2A v2；第一阶段优先稳定与可取消，后续再接双向文本流 TTS。</small></div>
        <label>服务区域
          <select value={draft.minimax.region} onChange={(event) => updateMiniMax("region", event.target.value as VoiceConfig["minimax"]["region"])}>
            <option value="cn">中国大陆 · api.minimaxi.com</option>
            <option value="global">海外 · api.minimax.io</option>
          </select>
        </label>
        <label>语音模型
          <select value={draft.minimax.model} onChange={(event) => updateMiniMax("model", event.target.value as VoiceConfig["minimax"]["model"])}>
            {minimaxSpeechModels.map((model) => <option value={model} key={model}>{model}</option>)}
          </select>
        </label>
        <label className="span-all">Voice ID<input value={draft.minimax.voice_id} onChange={(event) => updateMiniMax("voice_id", event.target.value)} placeholder="male-qn-qingse 或账号中的自定义音色 ID" /></label>
        <label className="span-all">MiniMax API Key<input type="password" autoComplete="off" value={draft.api_key} onChange={(event) => update("api_key", event.target.value)} placeholder={draft.minimax.has_api_key ? "已安全保存 · 留空继续使用" : "只写入 Android 加密存储"} /></label>
        <label>语速<input type="number" min="0.5" max="2" step="0.05" value={draft.minimax.speed} onChange={(event) => updateMiniMax("speed", Number(event.target.value))} /></label>
        <label>音量<input type="number" min="0" max="10" step="0.1" value={draft.minimax.volume} onChange={(event) => updateMiniMax("volume", Number(event.target.value))} /></label>
        <label>音高<input type="number" min="-12" max="12" step="1" value={draft.minimax.pitch} onChange={(event) => updateMiniMax("pitch", Number(event.target.value))} /></label>
        <p className="span-all form-hint">MiniMax 当前公开目录没有独立 ASR，旧 Realtime 已进入历史接口，所以这里不会冒充“MiniMax 实时语音识别”。Key 只在填写和保存桥接时短暂存在；保存后不进入 localStorage、日志或备份。</p>
      </> : null}

      <div className="span-all form-actions"><button className="primary-button" disabled={busy}>保存语音设置</button><button className="secondary-button" type="button" disabled={busy || (draft.output_provider === "minimax" && !draft.minimax.has_api_key)} onClick={() => void preview()}>试听</button></div>
      <p className="span-all form-status" aria-live="polite">{status}</p>
    </form>
    <p className="form-hint">架构依据 <a href="https://platform.minimaxi.com/docs/api-reference/speech-t2a-http" target="_blank" rel="noreferrer">MiniMax 官方 T2A 文档</a>。网页/FastAPI 模式的 MiniMax 安全代理仍需后端接口，本批先完成 Android 安全原生链路。</p>
  </section>;
}
