import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { casualGameApi } from "./api";
import { listGameRegistrations } from "./GameRegistry";
import type { CasualGameId, CasualGameSession, OpenGameSessionEffect, RegisteredCasualGameState } from "./types";
import "./games.css";

interface GameHubProps {
  conversationId: string | null;
  conversationTitle: string;
  personaId: string | null;
  personaName: string;
  requestedGameId?: CasualGameId | null;
  onRequestedGameHandled?: () => void;
  onClose: () => void;
  onOpenGame: (effect: OpenGameSessionEffect) => void;
}

function requestKey(gameId: CasualGameId) {
  return `game-hub:${gameId}:${crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

function effectFrom(session: CasualGameSession<unknown>): OpenGameSessionEffect {
  return {
    type: "open_game",
    game_id: session.game_id,
    session_id: session.id,
    conversation_id: session.conversation_id,
    persona_id: session.persona_id,
  };
}

function gameMark(gameId: CasualGameId) {
  if (gameId === "tic_tac_toe") return <span className="cg-hub-board" aria-hidden="true"><i>×</i><i /><i>○</i><i /><i>○</i><i /><i>×</i><i /><i /></span>;
  if (gameId === "rock_paper_scissors") return <span className="cg-hub-hands" aria-hidden="true"><i>石</i><i>剪</i><i>布</i></span>;
  if (gameId === "bulls_and_cows") return <span className="cg-hub-digits" aria-hidden="true"><i>1</i><i>8</i><i>3</i><i>0</i><b>1A · 2B</b></span>;
  if (gameId === "blackjack") return <span className="cg-hub-blackjack" aria-hidden="true"><i>A<small>♠</small></i><i>10<small>♥</small></i><b>21</b></span>;
  return <span className="cg-hub-questions-mark" aria-hidden="true"><strong>20</strong><i>?</i><small>YES / NO</small></span>;
}

export function GameHub({
  conversationId,
  conversationTitle,
  personaId,
  personaName,
  requestedGameId = null,
  onRequestedGameHandled,
  onClose,
  onOpenGame,
}: GameHubProps) {
  const games = useMemo(listGameRegistrations, []);
  const [sessions, setSessions] = useState<Array<CasualGameSession<RegisteredCasualGameState>>>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<CasualGameId | null>(null);
  const [setupGameId, setSetupGameId] = useState<CasualGameId | null>(null);
  const [userSecret, setUserSecret] = useState("");
  const [secretTouched, setSecretTouched] = useState(false);
  const [error, setError] = useState("");
  const handledRequestRef = useRef<CasualGameId | null>(null);

  useEffect(() => {
    if (!requestedGameId) {
      handledRequestRef.current = null;
      return;
    }
    if (handledRequestRef.current === requestedGameId) return;
    handledRequestRef.current = requestedGameId;
    if (requestedGameId === "bulls_and_cows") {
      setSetupGameId("bulls_and_cows");
      setUserSecret("");
      setSecretTouched(false);
    }
    onRequestedGameHandled?.();
  }, [onRequestedGameHandled, requestedGameId]);

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

  const start = async (gameId: CasualGameId, options: Record<string, unknown> = {}) => {
    if (!conversationId || !personaId) return;
    setStarting(gameId);
    setError("");
    try {
      const session = await casualGameApi.createSession(gameId, conversationId, requestKey(gameId), options);
      setSetupGameId(null);
      setUserSecret("");
      onOpenGame(effectFrom(session));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "游戏没有创建成功");
      setStarting(null);
    }
  };

  const requestStart = (gameId: CasualGameId) => {
    setError("");
    if (gameId === "bulls_and_cows") {
      setSetupGameId(gameId);
      setUserSecret("");
      setSecretTouched(false);
      return;
    }
    void start(gameId);
  };

  const submitSecret = (event: FormEvent) => {
    event.preventDefault();
    setSecretTouched(true);
    if (!/^[0-9]{4}$/.test(userSecret) || new Set(userSecret).size !== 4) return;
    void start("bulls_and_cows", { user_secret: userSecret });
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
          <p>也可以直接在聊天里说“陪我玩井字棋”“来猜数字”“玩二十问”或“来一局 21 点”。</p>
          <span>身份、模型和记忆都沿用当前 Persona</span>
        </div>

        <div className="cg-hub-games">
          {games.map((game) => <article key={game.id} className={`is-${game.id}`}>
            {gameMark(game.id)}
            <div><small>{game.eyebrow}</small><h3>{game.label}</h3><p>{game.description}</p></div>
            {setupGameId === game.id && game.id === "bulls_and_cows" ? <form className="cg-hub-secret-setup" onSubmit={submitSecret}>
              <div><span>先藏好你的数字</span><button type="button" aria-label="取消设置秘密数字" onClick={() => setSetupGameId(null)}>×</button></div>
              <label htmlFor="cg-secret-number">四位数字不能重复，允许以 0 开头</label>
              <input
                id="cg-secret-number"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                pattern="[0-9]{4}"
                value={userSecret}
                disabled={starting !== null}
                aria-invalid={secretTouched && (!/^[0-9]{4}$/.test(userSecret) || new Set(userSecret).size !== 4)}
                onChange={(event) => {
                  setUserSecret(event.target.value.replace(/[^0-9]/g, "").slice(0, 4));
                  setSecretTouched(false);
                }}
              />
              <small className={secretTouched && (!/^[0-9]{4}$/.test(userSecret) || new Set(userSecret).size !== 4) ? "is-error" : ""}>
                {userSecret.length === 4 && new Set(userSecret).size !== 4 ? "数字有重复，请换一个" : "这个数字只用于本局规则判定，不会交给 Persona 猜答案时查看。"}
              </small>
              <button type="submit" disabled={!conversationId || !personaId || starting !== null || !/^[0-9]{4}$/.test(userSecret) || new Set(userSecret).size !== 4}>{starting === game.id ? "正在封存…" : "封存并开始"}</button>
            </form> : <button type="button" disabled={!conversationId || !personaId || starting !== null} onClick={() => requestStart(game.id)}>{starting === game.id ? "正在开局…" : game.id === "bulls_and_cows" ? "设置数字并开始" : "开始新一局"}</button>}
          </article>)}
        </div>

        {error ? <p className="cg-hub-error" role="alert">{error}</p> : null}

        <section className="cg-hub-sessions" aria-label="未完成的游戏">
          <header><h3>未完成的对局</h3><small>{loading ? "正在读取…" : `${sessions.length} 局`}</small></header>
          {!loading && !sessions.length ? <p>当前对话没有收起的游戏。开始一局后，随时可以回到这里继续。</p> : null}
          {sessions.map((session) => {
            const game = games.find((item) => item.id === session.game_id);
            return <button type="button" key={session.id} onClick={() => onOpenGame(effectFrom(session))}>
              <span>{game?.resumeMark || "继续"}</span>
              <strong>{game?.label || session.game_id}</strong>
              <small>第 {session.revision + 1} 回合 · 继续</small>
            </button>;
          })}
        </section>
      </main>
    </section>
  </div>;
}
