import { useMemo, useState, type FormEvent } from "react";
import type { Provider } from "../../domain/types";
import type { NarrativeTurnRecord, PlayerIntent } from "./types";
import "./narrative-turn.css";

const RULES_MODE = "__longworld_rules__";

interface NarrativeTurnPanelProps {
  turns: NarrativeTurnRecord[];
  providers: Provider[];
  selectedProviderId: string | null;
  playerName: string;
  busy: boolean;
  onProviderChange: (providerId: string | null) => void;
  onFreeformAction: (content: string) => Promise<boolean>;
}

function timeLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fallbackActionLabel(intent: PlayerIntent) {
  if (intent.type === "move") return "前往另一个地点";
  if (intent.type === "take_item") return "收起一件物品";
  if (intent.type === "drop_item") return "放下一件物品";
  if (intent.type === "wait") return `等待 ${intent.minutes} 分钟`;
  if (intent.type === "accept_quest") return "接下一项任务";
  if (intent.type === "help_actor") return "帮助在场角色";
  return "采取一次自由行动";
}

export function NarrativeTurnPanel({
  turns,
  providers,
  selectedProviderId,
  playerName,
  busy,
  onProviderChange,
  onFreeformAction,
}: NarrativeTurnPanelProps) {
  const [draft, setDraft] = useState("");
  const visibleTurns = useMemo(() => [...turns]
    .sort((left, right) => left.revision - right.revision || left.created_at.localeCompare(right.created_at))
    .slice(-8), [turns]);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) || null;
  const freeformDisabled = !selectedProviderId;

  const submitFreeform = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || freeformDisabled || busy) return;
    const confirmed = await onFreeformAction(content);
    if (confirmed) setDraft("");
  };

  return <section className="lw-narrative-panel" aria-labelledby="lw-narrative-title">
    <header>
      <div><span>WORLD VOICE</span><h4 id="lw-narrative-title">世界回应</h4></div>
      <strong>{selectedProvider ? `GM · ${selectedProvider.name}` : "规则模式"}</strong>
    </header>

    <label className="lw-gm-route">
      <span>本轮行动线路</span>
      <select
        value={selectedProviderId || RULES_MODE}
        disabled={busy}
        onChange={(event) => onProviderChange(event.target.value === RULES_MODE ? null : event.target.value)}
        aria-describedby="lw-gm-route-note"
      >
        <option value={RULES_MODE}>规则模式（不调用模型）</option>
        {providers.map((provider) => <option value={provider.id} key={provider.id}>
          GM 线路 · {provider.name}{provider.model ? ` · ${provider.model}` : ""}
        </option>)}
      </select>
      <small id="lw-gm-route-note">GM 只能提出候选变化；程序校验通过后，事实才会写入 revision。</small>
    </label>

    <form className="lw-unwritten-action" onSubmit={(event) => void submitFreeform(event)}>
      <label htmlFor="lw-freeform-action">
        <span>未写行动</span>
        <small>例如：我把车票翻到背面，对着灯光寻找被藏起来的字。</small>
      </label>
      <textarea
        id="lw-freeform-action"
        maxLength={4000}
        rows={4}
        value={draft}
        disabled={freeformDisabled || busy}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={freeformDisabled ? "先在上方选择一条 GM 线路" : "写下这一次具体要做什么……"}
        aria-describedby="lw-freeform-boundary"
      />
      <div>
        <small id="lw-freeform-boundary">{freeformDisabled
          ? "自由行动需要 GM 线路；下方明确动作仍可直接使用。"
          : "GM 会解释原稿并提出候选变化；只有 rules 通过后才会写入事实。"}</small>
        <button type="submit" disabled={freeformDisabled || busy || !draft.trim()}>采取行动</button>
      </div>
    </form>

    <ol className="lw-narrative-thread" aria-label="叙事回合">
      {visibleTurns.map((turn) => <li key={turn.id}>
        <span className="lw-narrative-knot" aria-hidden="true">r{turn.revision}</span>
        <article>
          <header><strong>{turn.actor.kind === "player" ? playerName : "世界居民"}</strong><time dateTime={turn.created_at}>{timeLabel(turn.created_at)}</time></header>
          <p className="lw-turn-action">{turn.content.trim() || fallbackActionLabel(turn.intent)}</p>
          {turn.narration?.text ? <div className="lw-narrator-copy"><span>NARRATOR</span><p>{turn.narration.text}</p></div> : <p className="lw-narration-empty">本回合没有叙事文本；权威事实仍以提交标记为准。</p>}
          <footer><b>已提交 {turn.event_count} 个 event</b><span>revision {turn.revision}</span></footer>
        </article>
      </li>)}
      {!visibleTurns.length ? <li className="lw-narrative-first">
        <span className="lw-narrative-knot" aria-hidden="true">r0</span>
        <p>世界还没有回应。选择一条 GM 线路后，下一次明确动作会同时留下叙事；规则模式只提交事实。</p>
      </li> : null}
    </ol>

    <p className="lw-narrative-boundary"><strong>边界：</strong>叙事不是权威事实。地图、物品、关系与任务只认已提交的领域事件和 revision。</p>
  </section>;
}
