import { useEffect, useState, type FormEvent } from "react";
import type { AppSettings, Provider } from "../../domain/types";

const defaultPrompt = `请把较早对话整理成一份可供后续继续交流的摘要。
对话标题：{{title}}
已有摘要：{{existing_summary}}
需要整理的对话：
{{conversation}}

保留人物、约定、事实、情绪变化与未完成事项；不要添加原文没有的信息。`;

interface SummarySettingsProps {
  settings: AppSettings;
  providers: Provider[];
  onSave: (patch: Partial<AppSettings>) => Promise<unknown>;
}

export function SummarySettings({ settings, providers, onSave }: SummarySettingsProps) {
  const [draft, setDraft] = useState(() => ({
    auto_title_mode: String(settings.auto_title_mode || "local"),
    summary_enabled: settings.summary_enabled !== false,
    summary_trigger_rounds: Number(settings.summary_trigger_rounds || 24),
    summary_token_enabled: Boolean(settings.summary_token_enabled),
    summary_token_threshold: Number(settings.summary_token_threshold || 32000),
    summary_provider_id: String(settings.summary_provider_id || ""),
    summary_prompt: String(settings.summary_prompt || defaultPrompt),
  }));
  const [status, setStatus] = useState("");

  useEffect(() => {
    setDraft({
      auto_title_mode: String(settings.auto_title_mode || "local"),
      summary_enabled: settings.summary_enabled !== false,
      summary_trigger_rounds: Number(settings.summary_trigger_rounds || 24),
      summary_token_enabled: Boolean(settings.summary_token_enabled),
      summary_token_threshold: Number(settings.summary_token_threshold || 32000),
      summary_provider_id: String(settings.summary_provider_id || ""),
      summary_prompt: String(settings.summary_prompt || defaultPrompt),
    });
  }, [settings]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("正在保存自动总结设置…");
    try {
      await onSave(draft);
      setStatus("自动总结设置已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "自动总结设置保存失败");
    }
  };

  return (
    <section className="settings-section settings-feature">
      <div className="section-heading"><h3>自动总结</h3><p>长对话达到轮数或 Token 阈值后，把较早内容压缩成可继续使用的摘要。</p></div>
      <form className="settings-form one-column settings-edit-card" onSubmit={(event) => void submit(event)}>
        <label>新对话自动命名<select value={draft.auto_title_mode} onChange={(event) => setDraft((current) => ({ ...current, auto_title_mode: event.target.value }))}><option value="off">关闭</option><option value="local">本地快速命名</option><option value="model">由当前模型命名</option></select></label>
        <label className="check-row"><input type="checkbox" checked={draft.summary_enabled} onChange={(event) => setDraft((current) => ({ ...current, summary_enabled: event.target.checked }))} /><span>启用滚动摘要<small>达到设定轮数后整理较早上下文。</small></span></label>
        <label>触发轮数<input type="number" min="4" max="80" value={draft.summary_trigger_rounds} onChange={(event) => setDraft((current) => ({ ...current, summary_trigger_rounds: Number(event.target.value) || 24 }))} /></label>
        <label className="check-row"><input type="checkbox" checked={draft.summary_token_enabled} onChange={(event) => setDraft((current) => ({ ...current, summary_token_enabled: event.target.checked }))} /><span>超过 Token 阈值自动压缩<small>发送前估算热上下文，并保留最近一轮原文。</small></span></label>
        <label>自动压缩阈值（Token）<input type="number" min="1000" max="1000000" step="1000" value={draft.summary_token_threshold} onChange={(event) => setDraft((current) => ({ ...current, summary_token_threshold: Number(event.target.value) || 32000 }))} /></label>
        <label>自动压缩线路<select value={draft.summary_provider_id} onChange={(event) => setDraft((current) => ({ ...current, summary_provider_id: event.target.value }))}><option value="">跟随当前聊天线路</option>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.model}</option>)}</select></label>
        <label>自动总结提示词<textarea rows={12} value={draft.summary_prompt} onChange={(event) => setDraft((current) => ({ ...current, summary_prompt: event.target.value }))} /><small>可用变量：{"{{title}}"}、{"{{existing_summary}}"}、{"{{conversation}}"}</small></label>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setDraft((current) => ({ ...current, summary_prompt: defaultPrompt }))}>恢复默认提示词</button><button className="primary-button">保存自动总结</button></div>
        <p className="form-status" aria-live="polite">{status}</p>
      </form>
    </section>
  );
}
