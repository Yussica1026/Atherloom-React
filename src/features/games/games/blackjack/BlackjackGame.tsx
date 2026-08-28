import type {
  BlackjackCard,
  BlackjackDecision,
  BlackjackState,
  CasualGameAction,
  CasualGameActor,
} from "../../types";

const suitMarks: Record<BlackjackCard["suit"], string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

function PlayingCard({ card }: { card: BlackjackCard }) {
  const warmSuit = card.suit === "hearts" || card.suit === "diamonds";
  return <span
    className={`cg-blackjack-card${warmSuit ? " is-warm" : ""}`}
    aria-label={`${card.rank}${suitMarks[card.suit]}`}
  >
    <b>{card.rank}</b>
    <i aria-hidden="true">{suitMarks[card.suit]}</i>
  </span>;
}

interface HandProps {
  actor: CasualGameActor;
  label: string;
  cards: BlackjackCard[];
  total: number;
  stood: boolean;
  active: boolean;
}

function Hand({ actor, label, cards, total, stood, active }: HandProps) {
  return <section className={`cg-blackjack-hand is-${actor}${active ? " is-active" : ""}`} aria-label={`${label}，点数 ${total}`}>
    <header>
      <div><span>{actor === "user" ? "PLAYER" : "PERSONA"}</span><h3>{label}</h3></div>
      <strong>{total}</strong>
    </header>
    <div className="cg-blackjack-cards">
      {cards.map((card, index) => <PlayingCard key={`${card.rank}:${card.suit}:${index}`} card={card} />)}
    </div>
    <footer>{total > 21 ? "爆牌" : stood ? "已停牌" : active ? "正在选择" : "等待回合"}</footer>
  </section>;
}

interface BlackjackGameProps {
  state: BlackjackState;
  currentActor: CasualGameActor | null;
  personaName: string;
  busy: boolean;
  pendingUserAction: CasualGameAction | null;
  onDecision: (decision: BlackjackDecision) => void;
}

export function BlackjackGame({
  state,
  currentActor,
  personaName,
  busy,
  pendingUserAction,
  onDecision,
}: BlackjackGameProps) {
  const pendingDecision = pendingUserAction && "decision" in pendingUserAction ? pendingUserAction.decision : null;
  const userTurn = state.status === "active" && currentActor === "user";
  const statusCopy = state.status === "finished"
    ? "牌局已经结算"
    : currentActor === "persona"
      ? `${personaName} 正在决定要牌还是停牌`
      : state.user_stood
        ? `你已停牌，等待 ${personaName}`
        : "轮到你：继续要牌，或保留当前点数";

  return <section className="cg-blackjack" aria-labelledby="cg-blackjack-status">
    <div className="cg-blackjack-table">
      <Hand
        actor="persona"
        label={personaName}
        cards={state.persona_hand || []}
        total={state.persona_total || 0}
        stood={Boolean(state.persona_stood)}
        active={currentActor === "persona"}
      />

      <div className="cg-blackjack-knot" aria-hidden="true">
        <span>21</span>
        <small>剩 {Math.max(0, state.deck_remaining || 0)} 张</small>
      </div>

      <Hand
        actor="user"
        label="你"
        cards={state.user_hand || []}
        total={state.user_total || 0}
        stood={Boolean(state.user_stood)}
        active={currentActor === "user"}
      />
    </div>

    <h3 className="cg-blackjack-status" id="cg-blackjack-status" role="status" aria-live="polite">{statusCopy}</h3>

    {userTurn ? <div className="cg-blackjack-actions" role="group" aria-label="选择本回合动作">
      <button
        type="button"
        className={pendingDecision === "hit" ? "is-pending" : ""}
        disabled={busy || state.user_total >= 21}
        onClick={() => onDecision("hit")}
      ><span>HIT</span><strong>要牌</strong><small>再取一张牌</small></button>
      <button
        type="button"
        className={pendingDecision === "stand" ? "is-pending" : ""}
        disabled={busy}
        onClick={() => onDecision("stand")}
      ><span>STAND</span><strong>停牌</strong><small>保留 {state.user_total || 0} 点</small></button>
    </div> : <p className="cg-blackjack-rule">A 可按 1 或 11 计分；牌堆、点数、爆牌与胜负全部由规则引擎判定。</p>}
  </section>;
}
