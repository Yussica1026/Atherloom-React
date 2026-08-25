import { useEffect, useMemo, useState } from "react";
import { casualGameApi } from "./api";
import { listGameRegistrations } from "./GameRegistry";
import type { CasualGameId, CasualGameSession, OpenGameEffect, RegisteredCasualGameState } from "./types";
import "./games.css";

interface GameHubProps {
  conversationId: string | null;
  conversationTitle: string;
  personaId: string | null;
  personaName: string;
  onClose: () => void;
  onOpenGame: (effect: OpenGameEffect) => void;
}

function requestKey(gameId: CasualGameId) {
  return `game-hub:${gameId}:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

function effectFrom(session: CasualGameSession<unknown>): OpenGameEffect {
  return {
    type: "open_game",
    game_id: session.game_id,
    session_id: session.id,
    conversation_id: session.conversation_id,
    persona_id: session.persona_id,
  };
}

function gameMark(gameId: CasualGameId) {
  return gameId === "tic_tac_toe" ? <span className="cg-hub-board" aria-hidden="true"><i>×</i><i /><i>○</i><i /><i>○</i><i /><i>×</i><i /><i /></span> : <span className="cg-hub-hands" aria-hidden="true"><i>石</i><i>剪</i><i>布</i></span>;
}

export function GameHub({ conversationId, conversationTitle, personaId, personaName, onClose, onOpenGame }: GameHubProps) {
  const games = useMemo(listGameRegistrations, []);
  const [sessions, setSessions] = useState<Array<CasualGameSession<RegisteredCasualGameState>>>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<CasualGameId | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setError("");
    if (!conversationId || !personaId) {
      setSessions([]);
      return () => { active = false; };
    }
    setLoading(true);
    void casualGameApi.listSessions(conversationId).then((payload) => {
      if (active) setSessions(payload.sessions.filter((session) => session.persona_id === personaId));
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "读取对局失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [conversationId, personaId]);

  const start = async (gameId: CasualGameId) => {
    if (!conversationId || !personaId) return;
    setStarting(gameId);
    setError("");
    try {
      const session = await casualGameApi.createSession(gameId, conversationId, requestKey(gameId));
      onOpenGame(effectFrom(session));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "游戏没有创建成功");
      setStarting(null);
    }
  };

  return <div className="cg-hub-layer">
    <section className="cg-hub" role="dialog" aria-modal="true" aria-labelledby="cg-hub-title">
      <header className="cg-hub-header">
        <div>
          <span>同一个人，换一种玩法</span>
          <h2 id="cg-hub-title">休闲游戏</h2>
          <p>{personaId ? <><strong>{personaName}</strong> 会从「{conversationTitle || "当前对话"}」和你一起进入游戏。</> : "先在侧栏选择一个 Persona，并打开或新建它的对话。"}</p>
        </div>
        <button type="button" aria-label="关闭休闲游戏" onClick={onClose}>×</button>
      </header>

      <main className="cg-hub-main">
        <div className="cg-hub-intro">
          <p>也可以直接在聊天里说“陪我玩井字棋”或“我们来猜拳”。</p>
          <span>身份、模型和记忆都沿用当前 Persona</span>
        </div>

        <div className="cg-hub-games">
          {games.map((game) => <article key={game.id} className={`is-${game.id}`}>
            {gameMark(game.id)}
            <div><small>{game.id === "tic_tac_toe" ? "THREE IN A ROW" : "HIDDEN CHOICE"}</small><h3>{game.label}</h3><p>{game.id === "tic_tac_toe" ? "你执 X，Persona 执 O；每一步由程序判定是否合法。" : "你的选择会先封住，等 Persona 出手后一起揭晓。"}</p></div>
            <button type="button" disabled={!conversationId || !personaId || starting !== null} onClick={() => void start(game.id)}>{starting === game.id ? "正在开局…" : "开始新一局"}</button>
          </article>)}
        </div>

        {error ? <p className="cg-hub-error" role="alert">{error}</p> : null}

        <section className="cg-hub-sessions" aria-label="未完成的游戏">
          <header><h3>未完成的对局</h3><small>{loading ? "正在读取…" : `${sessions.length} 局`}</small></header>
          {!loading && !sessions.length ? <p>当前对话没有收起的游戏。开始一局后，随时可以回到这里继续。</p> : null}
          {sessions.map((session) => {
            const game = games.find((item) => item.id === session.game_id);
            return <button type="button" key={session.id} onClick={() => onOpenGame(effectFrom(session))}>
              <span>{session.game_id === "tic_tac_toe" ? "× ○" : "石 · 剪 · 布"}</span>
              <strong>{game?.label || session.game_id}</strong>
              <small>第 {session.revision + 1} 回合 · 继续</small>
            </button>;
          })}
        </section>
      </main>
    </section>
  </div>;
}
