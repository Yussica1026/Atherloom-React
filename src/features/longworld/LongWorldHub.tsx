import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Persona, Provider } from "../../domain/types";
import { cloneTemplateDefinition, worldTemplates } from "./templates";
import { NarrativeTurnPanel } from "./NarrativeTurnPanel";
import type {
  ActorRef,
  EventRecord,
  ItemState,
  PlayerIntent,
  QuestState,
  RelationshipState,
  SaveSummary,
  SessionDetail,
  WorldDetail,
  WorldState,
} from "./types";
import { useLongWorld } from "./useLongWorld";
import "./longworld.css";

interface LongWorldHubProps {
  personas: Persona[];
  providers: Provider[];
  playerDisplayName: string;
  onClose: () => void;
  onOpenConnectionSettings: () => void;
}

type SetupTarget =
  | { kind: "template"; id: string }
  | { kind: "world"; id: string };

function timestampLabel(value: string) {
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return value;
  }
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 7)}…${value.slice(-5)}` : "—";
}

function worldTime(totalMinutes: number) {
  const day = Math.floor(totalMinutes / 1440) + 1;
  const hour = Math.floor((totalMinutes % 1440) / 60);
  const minute = totalMinutes % 60;
  return `第 ${day} 日 · ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function statusLabel(status: QuestState["status"]) {
  return ({ available: "可接取", active: "进行中", completed: "已完成", failed: "已失败", hidden: "未发现" } as const)[status];
}

function actorName(state: WorldState, actor: ActorRef) {
  if (actor.kind === "player") return state.player.display_name;
  if (actor.kind === "ai_character") return state.ai_characters[actor.id]?.display_name || "AI 居民";
  return state.npcs[actor.id]?.name || "NPC";
}

function locationName(state: WorldState, id: unknown) {
  return typeof id === "string" ? state.locations[id]?.name || id : "未知地点";
}

function itemName(state: WorldState, id: unknown) {
  return typeof id === "string" ? state.items[id]?.name || id : "未知物品";
}

function eventSentence(record: EventRecord, state: WorldState) {
  const event = record.event;
  const actor = event.actor && typeof event.actor === "object" ? actorName(state, event.actor as ActorRef) : "世界";
  if (record.type === "move_actor") return `${actor} 从「${locationName(state, event.from_location_id)}」前往「${locationName(state, event.to_location_id)}」。`;
  if (record.type === "transfer_item") {
    const to = event.to_position as { kind?: string; location_id?: string } | undefined;
    return to?.kind === "actor"
      ? `${actor} 收起了「${itemName(state, event.item_id)}」。`
      : `${actor} 把「${itemName(state, event.item_id)}」留在「${locationName(state, to?.location_id)}」。`;
  }
  if (record.type === "advance_time") return `${actor} 让世界向前走了 ${String(event.minutes || 0)} 分钟。`;
  if (record.type === "adjust_relationship") return `${actor} 帮助了 ${actorName(state, event.object as ActorRef)}，关系发生了变化。`;
  if (record.type === "advance_quest") return `${actor} 接下任务「${state.quests[String(event.quest_id)]?.title || String(event.quest_id)}」。`;
  if (record.type === "discover_fact") return `${actor} 发现了一条新的世界事实。`;
  return `世界记录了 ${record.type} 事件。`;
}

function intentCopy(intent: PlayerIntent, state: WorldState) {
  if (intent.type === "move") return `前往${locationName(state, intent.destination_id)}`;
  if (intent.type === "take_item") return `拿起${itemName(state, intent.item_id)}`;
  if (intent.type === "drop_item") return `放下${itemName(state, intent.item_id)}`;
  if (intent.type === "wait") return `在这里等待${intent.minutes}分钟`;
  if (intent.type === "accept_quest") return `接下${state.quests[intent.quest_id]?.title || "任务"}`;
  if (intent.type === "help_actor") return `帮助${actorName(state, intent.target)}`;
  return "采取一次自由行动";
}

function actorSeal(kind: ActorRef["kind"], name: string) {
  return <span className={`lw-actor-seal ${kind}`} title={`${kind === "player" ? "Player" : kind === "ai_character" ? "AICharacter" : "NPC"} · ${name}`}><i>{name.slice(0, 1)}</i><small>{name}</small></span>;
}

function WorldThreadMap({ state, busy, onMove }: { state: WorldState; busy: boolean; onMove: (locationId: string) => void }) {
  const current = state.locations[state.player.location_id];
  const visibleIds = new Set([state.player.location_id, ...current.exits, ...Object.values(state.locations).filter((item) => item.visited).map((item) => item.id)]);
  return (
    <section className="lw-map-panel" aria-labelledby="lw-map-title">
      <header><div><span>WORLD THREAD</span><h3 id="lw-map-title">世界线地图</h3></div><p>相邻地点可直接抵达；未探明的地方只留下一枚空印。</p></header>
      <div className="lw-map-rail">
        {Object.values(state.locations).map((location, index) => {
          const currentLocation = location.id === state.player.location_id;
          const adjacent = current.exits.includes(location.id);
          const revealed = visibleIds.has(location.id);
          const localAi = currentLocation ? Object.values(state.ai_characters).filter((actor) => actor.active && actor.location_id === location.id) : [];
          const localNpcs = currentLocation ? Object.values(state.npcs).filter((actor) => actor.alive && actor.location_id === location.id) : [];
          return (
            <button
              type="button"
              className={`lw-map-node${currentLocation ? " current" : ""}${location.visited ? " visited" : ""}${adjacent ? " adjacent" : ""}${revealed ? "" : " concealed"}`}
              disabled={busy || !adjacent}
              onClick={() => adjacent && onMove(location.id)}
              aria-current={currentLocation ? "location" : undefined}
              aria-label={revealed ? `${location.name}${currentLocation ? "，当前位置" : adjacent ? "，可前往" : ""}` : `未探明地点 ${index + 1}`}
              key={location.id}
            >
              <span className="lw-node-index">{String(index + 1).padStart(2, "0")}</span>
              <strong>{revealed ? location.name : "未探明"}</strong>
              <small>{currentLocation ? "你在这里" : adjacent ? "沿线可达" : location.visited ? "留下过足迹" : "尚无足迹"}</small>
              {currentLocation ? <span className="lw-node-actors">
                {actorSeal("player", state.player.display_name)}
                {localAi.map((actor) => <span key={actor.id}>{actorSeal("ai_character", actor.display_name)}</span>)}
                {localNpcs.map((actor) => <span key={actor.id}>{actorSeal("npc", actor.name)}</span>)}
              </span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function InventoryItem({ item, busy, onDrop }: { item: ItemState; busy: boolean; onDrop: () => void }) {
  return <article className="lw-inventory-item"><div><strong>{item.name}</strong><p>{item.description || "没有留下说明。"}</p></div><button type="button" disabled={busy} onClick={onDrop}>放下</button></article>;
}

function RelationshipRow({ relationship, state }: { relationship: RelationshipState; state: WorldState }) {
  return <article className="lw-relationship-row">
    <header><strong>{actorName(state, relationship.subject)} → {actorName(state, relationship.object)}</strong><span>关系事实</span></header>
    <div><span>亲近 <b>{relationship.affinity}</b></span><span>信任 <b>{relationship.trust}</b></span><span>敬意 <b>{relationship.respect}</b></span><span>畏惧 <b>{relationship.fear}</b></span></div>
  </article>;
}

function SaveLedger({ saves, busy, onSave, onBranch }: {
  saves: SaveSummary[];
  busy: boolean;
  onSave: (name: string) => Promise<void>;
  onBranch: (saveId: string, name: string) => Promise<void>;
}) {
  const [saveName, setSaveName] = useState("手动存档");
  const [branchingId, setBranchingId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("新的世界线");
  return <section className="lw-ledger-block">
    <header><div><span>SAVE & BRANCH</span><h3>存档枝</h3></div></header>
    <form className="lw-inline-form" onSubmit={(event) => { event.preventDefault(); void onSave(saveName.trim() || "手动存档"); }}>
      <input maxLength={120} value={saveName} onChange={(event) => setSaveName(event.target.value)} aria-label="存档名称" />
      <button type="submit" className="lw-primary" disabled={busy}>钉住此刻</button>
    </form>
    <div className="lw-save-list">
      {saves.map((save) => <article key={save.id}>
        <div><strong>{save.name}</strong><small>rev {save.revision} · {timestampLabel(save.created_at)}</small></div>
        <button type="button" disabled={busy} onClick={() => setBranchingId((current) => current === save.id ? null : save.id)}>从这里分支</button>
        {branchingId === save.id ? <form onSubmit={(event) => { event.preventDefault(); void onBranch(save.id, branchName.trim() || "新的世界线"); }}>
          <input maxLength={120} value={branchName} onChange={(event) => setBranchName(event.target.value)} aria-label="分支名称" />
          <button type="submit" className="lw-primary" disabled={busy}>建立分支</button>
        </form> : null}
      </article>)}
      {!saves.length ? <p className="lw-empty">还没有手动存档。事件仍会按 revision 持续记录。</p> : null}
    </div>
  </section>;
}

function SessionPlay({ engine, providers }: { engine: ReturnType<typeof useLongWorld>; providers: Provider[] }) {
  const { session, world, events, turns, saves, replay, busy, error, notice, hasPendingAction } = engine;
  const [tab, setTab] = useState<"scene" | "facts" | "chronicle">("scene");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(providers[0]?.id || null);
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selectedProviderId && !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0]?.id || null);
    }
  }, [providers, selectedProviderId]);

  useEffect(() => {
    setTab("scene");
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [session?.id]);

  if (!session || !world) return null;
  const state = session.state;
  const current = state.locations[state.player.location_id];
  const localItems = Object.values(state.items).filter((item) => item.position.kind === "location" && item.position.location_id === current.id);
  const inventory = Object.values(state.items).filter((item) => item.position.kind === "actor" && item.position.actor.kind === "player" && item.position.actor.id === state.player.id);
  const localNpcs = Object.values(state.npcs).filter((actor) => actor.alive && actor.location_id === current.id);
  const localAi = Object.values(state.ai_characters).filter((actor) => actor.active && actor.location_id === current.id);
  const discoveredNpcs = Object.values(state.npcs).filter((actor) => state.locations[actor.location_id]?.visited);
  const knownFacts = Object.values(state.facts).filter((fact) => fact.known_by.some((actor) => actor.kind === "player" && actor.id === state.player.id));
  const visibleQuests = Object.values(state.quests).filter((quest) => quest.status !== "hidden");
  const act = (intent: PlayerIntent) => void engine.commitAction(intent, intentCopy(intent, state), selectedProviderId);

  return <>
    <header className="lw-play-header">
      <button type="button" className="lw-back" onClick={engine.closeSession}>← 世界库</button>
      <div><span>{world.name} · {session.branch_name}</span><h2>{current.name}</h2><p>{worldTime(state.clock.total_minutes)} · turn {state.turn}</p></div>
      <div className="lw-revision-stamp"><span>REVISION</span><strong>{session.current_revision}</strong><small title={session.state_hash}>{shortHash(session.state_hash)}</small></div>
    </header>

    <main className="lw-play-scroll" ref={scrollRef}>
      <button type="button" className="lw-mobile-session-back" onClick={engine.closeSession}>← 返回世界库</button>
      {(error || notice) ? <aside className={`lw-engine-note${error ? " error" : ""}`} role={error ? "alert" : "status"}><span>{error ? "提交未确认" : "ENGINE"}</span><p>{error || notice}</p>{hasPendingAction ? <button type="button" disabled={busy} onClick={() => void engine.retryPendingAction()}>安全重试上一步</button> : null}</aside> : null}
      <WorldThreadMap state={state} busy={busy} onMove={(locationId) => act({ type: "move", destination_id: locationId })} />

      <nav className="lw-mobile-tabs" aria-label="游戏信息页">
        <button type="button" className={tab === "scene" ? "active" : ""} onClick={() => setTab("scene")}>现场</button>
        <button type="button" className={tab === "facts" ? "active" : ""} onClick={() => setTab("facts")}>事实</button>
        <button type="button" className={tab === "chronicle" ? "active" : ""} onClick={() => setTab("chronicle")}>纪事</button>
      </nav>

      <div className="lw-play-grid">
        <section className={`lw-scene-column${tab === "scene" ? " mobile-active" : ""}`}>
          <article className="lw-scene-card">
            <header><span>CURRENT SCENE</span><h3>{current.name}</h3></header>
            <p className="lw-scene-copy">{current.description || "这里还没有被写下更多细节。"}</p>
            <NarrativeTurnPanel
              turns={turns}
              providers={providers}
              selectedProviderId={selectedProviderId}
              playerName={state.player.display_name}
              busy={busy}
              onProviderChange={setSelectedProviderId}
              onFreeformAction={(content) => engine.commitAction({ type: "freeform" }, content, selectedProviderId)}
            />
            <div className="lw-explicit-actions-heading"><h4>明确动作</h4><small>{selectedProviderId ? "GM 提出候选，rules 决定能否提交" : "不调用模型，直接执行已定义规则"}</small></div>
            <div className="lw-action-group"><h4>沿路前往</h4><div>{current.exits.map((id) => <button type="button" disabled={busy} onClick={() => act({ type: "move", destination_id: id })} key={id}>↗ {state.locations[id]?.name || id}</button>)}</div></div>
            <div className="lw-action-group"><h4>此地物品</h4><div>{localItems.map((item) => <button type="button" disabled={busy} onClick={() => act({ type: "take_item", item_id: item.id })} key={item.id}>＋ 收起 {item.name}</button>)}{!localItems.length ? <small>没有可以拾取的物品</small> : null}</div></div>
            <div className="lw-action-group"><h4>在场角色</h4><div>
              {localNpcs.map((actor) => <button type="button" disabled={busy} onClick={() => act({ type: "help_actor", target: { kind: "npc", id: actor.id } })} key={actor.id}>帮一把 · {actor.name}</button>)}
              {localAi.map((actor) => <button type="button" disabled={busy} onClick={() => act({ type: "help_actor", target: { kind: "ai_character", id: actor.id } })} key={actor.id}>帮一把 · {actor.display_name}</button>)}
              {!localNpcs.length && !localAi.length ? <small>这里只有你</small> : null}
            </div></div>
            <div className="lw-action-group"><h4>让时间经过</h4><div>{[5, 15, 30].map((minutes) => <button type="button" disabled={busy} onClick={() => act({ type: "wait", minutes })} key={minutes}>等待 {minutes} 分钟</button>)}</div></div>
          </article>

          <article className="lw-inventory-card">
            <header><span>INVENTORY</span><h3>随身物品</h3><b>{inventory.length}</b></header>
            <div>{inventory.map((item) => <InventoryItem item={item} busy={busy} onDrop={() => act({ type: "drop_item", item_id: item.id })} key={item.id} />)}{!inventory.length ? <p className="lw-empty">背包还是空的。</p> : null}</div>
          </article>
        </section>

        <aside className={`lw-fact-column${tab === "facts" ? " mobile-active" : ""}`}>
          <section className="lw-ledger-block"><header><div><span>RESIDENTS</span><h3>世界居民</h3></div><b>{Object.keys(state.ai_characters).length} AI</b></header>
            <div className="lw-resident-list">
              {Object.values(state.ai_characters).map((actor) => <article key={actor.id}>{actorSeal("ai_character", actor.display_name)}<div><strong>{actor.display_name}</strong><small>{actor.active ? "独立居民 · 等待 AI 回合接入" : "已暂停"}</small></div></article>)}
              {discoveredNpcs.map((actor) => <article key={actor.id}>{actorSeal("npc", actor.name)}<div><strong>{actor.name}</strong><small>世界 NPC · 由规则引擎管理</small></div></article>)}
            </div>
          </section>
          <section className="lw-ledger-block"><header><div><span>QUESTS</span><h3>任务线</h3></div></header>
            <div className="lw-quest-list">{visibleQuests.map((quest) => <article key={quest.id}><header><strong>{quest.title}</strong><span>{statusLabel(quest.status)}</span></header><p>{quest.description}</p>{quest.status === "available" ? <button type="button" disabled={busy} onClick={() => act({ type: "accept_quest", quest_id: quest.id })}>接下任务</button> : null}</article>)}</div>
          </section>
          <section className="lw-ledger-block"><header><div><span>DISCOVERED FACTS</span><h3>已知事实</h3></div><b>{knownFacts.length}</b></header>
            <ol className="lw-fact-list">{knownFacts.map((fact) => <li key={fact.id}>{fact.text}</li>)}{!knownFacts.length ? <li>还没有亲自发现的事实。</li> : null}</ol>
          </section>
          {Object.values(state.relationships).length ? <section className="lw-ledger-block"><header><div><span>RELATIONSHIPS</span><h3>关系状态</h3></div></header>{Object.values(state.relationships).map((relationship) => <RelationshipRow relationship={relationship} state={state} key={relationship.id} />)}</section> : null}
        </aside>

        <aside className={`lw-chronicle-column${tab === "chronicle" ? " mobile-active" : ""}`}>
          <section className="lw-ledger-block"><header><div><span>DOMAIN EVENTS</span><h3>事实纪事</h3></div><b>{events.length}</b></header>
            <ol className="lw-event-list">{[...events].reverse().map((record) => <li key={record.id}><span>r{record.revision}.{record.sequence}</span><p>{eventSentence(record, state)}</p></li>)}{!events.length ? <li className="lw-empty">世界刚刚建立，第一件事还没有发生。</li> : null}</ol>
            <div className="lw-replay-check"><div><strong>{replay ? replay.matches_current ? "重放一致" : "重放异常" : "尚未校验重放"}</strong><small>{replay ? shortHash(replay.state_hash) : "从初始快照重建所有 committed events"}</small></div><button type="button" disabled={busy} onClick={() => void engine.verifyReplay()}>校验 replay</button></div>
          </section>
          <SaveLedger saves={saves} busy={busy} onSave={engine.createSave} onBranch={engine.branchFromSave} />
        </aside>
      </div>
    </main>
  </>;
}

function SessionSetup({ target, personas, providers, playerDisplayName, busy, error, onBack, onStart }: {
  target: SetupTarget;
  personas: Persona[];
  providers: Provider[];
  playerDisplayName: string;
  busy: boolean;
  error: string;
  onBack: () => void;
  onStart: (options: { definition?: ReturnType<typeof cloneTemplateDefinition>; worldId?: string; playerName: string; branchName: string; resident?: { display_name: string; persona_id: string; provider_id: string } }) => Promise<void>;
}) {
  const template = target.kind === "template" ? worldTemplates.find((item) => item.id === target.id) : undefined;
  const [worldName, setWorldName] = useState(template?.definition.name || "");
  const [premise, setPremise] = useState(template?.definition.description || "");
  const [playerName, setPlayerName] = useState(playerDisplayName.trim() || "玩家");
  const [branchName, setBranchName] = useState("主线");
  const availableProviders = useMemo(() => providers.filter((item) => item.enabled !== false), [providers]);
  const [residentEnabled, setResidentEnabled] = useState(Boolean(personas.length && availableProviders.length));
  const [personaId, setPersonaId] = useState(personas[0]?.id || "");
  const [providerId, setProviderId] = useState(() => {
    const preferred = personas[0]?.config?.provider_id || personas[0]?.provider_id;
    return availableProviders.some((item) => item.id === preferred) ? String(preferred) : availableProviders[0]?.id || "";
  });

  useEffect(() => {
    if (!personaId && personas[0]) setPersonaId(personas[0].id);
    if (!providerId && availableProviders[0]) {
      const persona = personas.find((item) => item.id === (personaId || personas[0]?.id));
      const preferred = persona?.config?.provider_id || persona?.provider_id;
      setProviderId(availableProviders.some((item) => item.id === preferred) ? String(preferred) : availableProviders[0].id);
    }
  }, [availableProviders, personaId, personas, providerId]);

  const choosePersona = (id: string) => {
    setPersonaId(id);
    const persona = personas.find((item) => item.id === id);
    const preferred = persona?.config?.provider_id || persona?.provider_id;
    if (preferred && availableProviders.some((item) => item.id === preferred)) setProviderId(preferred);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!playerName.trim() || !branchName.trim()) return;
    const definition = template ? cloneTemplateDefinition(template) : undefined;
    if (definition && template) {
      definition.name = worldName.trim() || template.name;
      definition.description = premise.trim() || template.definition.description;
    }
    const persona = personas.find((item) => item.id === personaId);
    const resident = residentEnabled && persona && providerId ? {
      display_name: persona.name,
      persona_id: persona.id,
      provider_id: providerId,
    } : undefined;
    void onStart({ definition, worldId: target.kind === "world" ? target.id : undefined, playerName, branchName, resident });
  };

  return <main className="lw-library-scroll">
    <button type="button" className="lw-back" onClick={onBack}>← 返回世界库</button>
    <section className="lw-setup-sheet">
      <header><span>NEW SESSION</span><h2>{template ? `从「${template.name}」开始` : "在已有世界建立新档"}</h2><p>真人玩家、独立 AI 居民与世界 NPC 会以不同身份写入 Session。</p></header>
      <form onSubmit={submit}>
        {template ? <fieldset><legend>世界卡</legend><label>世界名称<input required maxLength={160} value={worldName} onChange={(event) => setWorldName(event.target.value)} /></label><label className="wide">开场设定<textarea required maxLength={8000} rows={4} value={premise} onChange={(event) => setPremise(event.target.value)} /></label></fieldset> : null}
        <fieldset><legend>这条世界线</legend><label>玩家名字<input required maxLength={120} value={playerName} onChange={(event) => setPlayerName(event.target.value)} /></label><label>分支名称<input required maxLength={120} value={branchName} onChange={(event) => setBranchName(event.target.value)} /></label></fieldset>
        <fieldset><legend>AI 居民（可选）</legend>
          <label className="lw-check-row"><input type="checkbox" checked={residentEnabled} disabled={!personas.length || !availableProviders.length} onChange={(event) => setResidentEnabled(event.target.checked)} /><span><strong>让一位现有人格住进世界</strong><small>只发送 Persona/Provider ID；密钥和 Prompt 由服务器解析并冻结安全快照。</small></span></label>
          {residentEnabled ? <><label>居民身份<select value={personaId} onChange={(event) => choosePersona(event.target.value)}>{personas.map((persona) => <option value={persona.id} key={persona.id}>{persona.name}</option>)}</select></label><label>独立模型线路<select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{availableProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.model}</option>)}</select></label></> : null}
          {!personas.length || !availableProviders.length ? <p className="lw-field-note">还没有同时可用的人格与模型线路；可以先以 Player 单独开始。</p> : <p className="lw-field-note">这一版居民拥有独立身份和运行时快照，但不会伪装成已经接入自主 AI 回合。</p>}
        </fieldset>
        {error ? <p className="lw-form-error" role="alert">{error}</p> : null}
        <footer><button type="button" onClick={onBack}>取消</button><button type="submit" className="lw-primary" disabled={busy || !playerName.trim() || !branchName.trim()}>{busy ? "正在建立世界线…" : "进入长期世界"}</button></footer>
      </form>
    </section>
  </main>;
}

function WorldLibrary({ engine, onSetup, onOpenConnectionSettings }: { engine: ReturnType<typeof useLongWorld>; onSetup: (target: SetupTarget) => void; onOpenConnectionSettings: () => void }) {
  const needsBackend = engine.error.includes("Android 本机模式尚不支持");
  return <main className="lw-library-scroll">
    {engine.loading ? <div className="lw-loading-state" role="status"><span /><p>正在读取世界与 Session…</p></div> : null}
    {(engine.error || engine.notice) ? <aside className={`lw-engine-note${engine.error ? " error" : ""}`} role={engine.error ? "alert" : "status"}><span>{engine.error ? "连接提示" : "ENGINE"}</span><p>{needsBackend ? "长期世界需要后端规则引擎保存权威事实；请先给 APK 配置本机或局域网后端地址。" : engine.error || engine.notice}</p><button type="button" disabled={engine.loading} onClick={needsBackend ? onOpenConnectionSettings : () => void engine.refreshLibrary()}>{needsBackend ? "设置后端地址" : engine.loading ? "正在重试…" : "重新读取"}</button></aside> : null}
    <section className="lw-library-intro"><span>LONG-RUN TEXT WORLD</span><h2>世界不是一段提示词，<br />是一串可以重放的事实。</h2><p>选择一张原创起始世界卡，或回到已经发生过的世界线。每个行动都会经过 schema 与 rules，再成为 committed event。</p></section>

    <section className="lw-template-section"><header><div><span>STARTER WORLD CARDS</span><h3>选择一个世界入口</h3></div><p>原创内容 · 不复制开源项目 prompt 或素材</p></header><div className="lw-template-grid">{worldTemplates.map((template, index) => <article key={template.id}><span>{String(index + 1).padStart(2, "0")} · {template.eyebrow}</span><h4>{template.name}</h4><p>{template.summary}</p><footer><small>{template.definition.locations.length} 地点 · {template.definition.npcs.length} NPC · {template.definition.quests.length} 任务线</small><button type="button" onClick={() => onSetup({ kind: "template", id: template.id })}>从这里开始 ↗</button></footer></article>)}</div></section>

    <div className="lw-library-columns">
      <section><header><div><span>CONTINUE</span><h3>继续世界线</h3></div><b>{engine.sessions.length}</b></header><div className="lw-session-list">{engine.sessions.map((session) => <button type="button" disabled={engine.busy} onClick={() => void engine.openSession(session.id)} key={session.id}><span className="lw-session-rev">r{session.current_revision}</span><div><strong>{session.world_name}</strong><small>{session.branch_name} · {session.player.display_name} · {session.ai_character_count} 位 AI 居民</small><time>{timestampLabel(session.updated_at)}</time></div><i>→</i></button>)}{!engine.loading && !engine.sessions.length ? <p className="lw-empty">还没有世界线。上面三张世界卡都可以成为第一条。</p> : null}</div></section>
      <section><header><div><span>WORLD LIBRARY</span><h3>已有世界</h3></div><b>{engine.worlds.length}</b></header><div className="lw-world-list">{engine.worlds.map((world) => <article key={world.id}><div><strong>{world.name}</strong><small>版本 {world.current_version} · {world.session_count} 条世界线</small><p>{world.description || "还没有世界说明。"}</p></div><button type="button" onClick={() => onSetup({ kind: "world", id: world.id })}>新建 Session</button></article>)}{!engine.loading && !engine.worlds.length ? <p className="lw-empty">世界库是空的。</p> : null}</div></section>
    </div>
  </main>;
}

export function LongWorldHub({ personas, providers, playerDisplayName, onClose, onOpenConnectionSettings }: LongWorldHubProps) {
  const engine = useLongWorld();
  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled !== false), [providers]);
  const [setupTarget, setSetupTarget] = useState<SetupTarget | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current;
    const siblings = layer?.parentElement ? Array.from(layer.parentElement.children).filter((item) => item !== layer) as HTMLElement[] : [];
    const inertState = siblings.map((item) => [item, item.hasAttribute("inert")] as const);
    siblings.forEach((item) => item.setAttribute("inert", ""));
    const frame = window.requestAnimationFrame(() => hubRef.current?.querySelector<HTMLElement>("button")?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !hubRef.current) return;
      const focusable = Array.from(hubRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKey);
      inertState.forEach(([item, wasInert]) => { if (!wasInert) item.removeAttribute("inert"); });
      previousFocus?.focus();
    };
  }, []);

  const chosenWorld = useMemo(() => setupTarget?.kind === "world" ? engine.worlds.find((item) => item.id === setupTarget.id) : null, [engine.worlds, setupTarget]);

  return <div className="lw-layer" ref={layerRef}>
    <section className="lw-hub" role="dialog" aria-modal="true" aria-label="长期世界" ref={hubRef}>
      {!engine.session ? <header className="lw-hub-header"><div><span>ATHERLOOM · WORLD ENGINE</span><h1>长期世界</h1><p>{chosenWorld ? chosenWorld.name : "LLM 负责叙事，程序负责事实"}</p></div><button type="button" aria-label="关闭长期世界" onClick={onClose}>×</button></header> : <button type="button" className="lw-close-floating" aria-label="关闭长期世界" onClick={onClose}>×</button>}
      {engine.session ? <SessionPlay key={engine.session.id} engine={engine} providers={enabledProviders} /> : setupTarget ? <SessionSetup key={`${setupTarget.kind}-${setupTarget.id}`} target={setupTarget} personas={personas} providers={providers} playerDisplayName={playerDisplayName} busy={engine.busy} error={engine.error} onBack={() => setSetupTarget(null)} onStart={engine.startSession} /> : <WorldLibrary engine={engine} onSetup={setSetupTarget} onOpenConnectionSettings={onOpenConnectionSettings} />}
    </section>
  </div>;
}
