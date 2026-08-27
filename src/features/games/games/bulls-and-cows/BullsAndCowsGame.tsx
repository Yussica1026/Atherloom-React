import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  BullsAndCowsHistoryEntry,
  BullsAndCowsState,
  CasualGameAction,
  CasualGameActor,
} from "../../types";

interface RoundEntries {
  round: number;
  user?: BullsAndCowsHistoryEntry;
  persona?: BullsAndCowsHistoryEntry;
}

function validNumber(value: string) {
  return /^[0-9]{4}$/.test(value) && new Set(value).size === 4;
}

function inputHint(value: string) {
  if (!value) return "输入 4 位数字，可用 0 开头";
  if (value.length < 4) return "还需要输入 4 位数字";
  if (new Set(value).size !== 4) return "四位数字不能重复";
  return "数字符合规则，可以提交";
}

function Feedback({ entry }: { entry?: BullsAndCowsHistoryEntry }) {
  if (!entry) return <span className="cg-bac-waiting">等待这一方猜测</span>;
  return <span className="cg-bac-score" aria-label={`${entry.bulls} 个位置和数字都正确，${entry.cows} 个数字正确但位置不对`}>
    <b>{entry.bulls}<i>A</i></b>
    <b>{entry.cows}<i>B</i></b>
  </span>;
}

interface GuessCardProps {
  owner: string;
  entry?: BullsAndCowsHistoryEntry;
  side: "user" | "persona";
}

function GuessCard({ owner, entry, side }: GuessCardProps) {
  return <div className={`cg-bac-guess is-${side}${entry?.bulls === 4 ? " is-solved" : ""}`}>
    <span className="cg-bac-owner">{owner}</span>
    <strong>{entry?.guess || "····"}</strong>
    <Feedback entry={entry} />
  </div>;
}

interface BullsAndCowsGameProps {
  state: BullsAndCowsState;
  currentActor: CasualGameActor | null;
  personaName: string;
  busy: boolean;
  pendingUserAction: CasualGameAction | null;
  onGuess: (guess: string) => void;
}

export function BullsAndCowsGame({
  state,
  currentActor,
  personaName,
  busy,
  pendingUserAction,
  onGuess,
}: BullsAndCowsGameProps) {
  const history = Array.isArray(state.history) ? state.history : [];
  const [guess, setGuess] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const pendingGuess = pendingUserAction && "guess" in pendingUserAction ? pendingUserAction.guess : null;

  useEffect(() => {
    setGuess("");
    setSubmitted(false);
  }, [history.length]);

  const rounds = useMemo(() => {
    const indexed = new Map<number, RoundEntries>();
    for (const entry of history) {
      const round = Number.isInteger(entry.round) && entry.round > 0 ? entry.round : 1;
      const grouped = indexed.get(round) || { round };
      grouped[entry.actor] = entry;
      indexed.set(round, grouped);
    }
    return Array.from(indexed.values()).sort((left, right) => right.round - left.round);
  }, [history]);

  const finished = state.status === "finished";
  const winner = [...history].reverse().find((entry) => entry.bulls === 4);
  const statusCopy = finished
    ? winner?.actor === "user" ? "你先找到了对方的秘密数字" : `${personaName} 先找到了你的秘密数字`
    : currentActor === "user"
      ? "轮到你猜对方的四位数字"
      : `${personaName} 正在猜你的四位数字`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!validNumber(guess) || busy || currentActor !== "user") return;
    onGuess(guess);
  };

  return <section className="cg-bac" aria-labelledby="cg-bac-status">
    <header className="cg-bac-heading">
      <div>
        <span>第 {Math.max(1, state.round || 1)} 轮</span>
        <h3 id="cg-bac-status" role="status" aria-live="polite">{statusCopy}</h3>
      </div>
      <p><b>A</b> 数字与位置都正确 <i>·</i> <b>B</b> 数字正确、位置不同</p>
    </header>

    {state.status === "active" && currentActor === "user" ? <form className="cg-bac-entry" onSubmit={submit}>
      <label htmlFor="cg-bac-guess">输入你的猜测</label>
      <div>
        <input
          id="cg-bac-guess"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          pattern="[0-9]{4}"
          value={pendingGuess || guess}
          disabled={busy}
          aria-invalid={submitted && !validNumber(guess)}
          aria-describedby="cg-bac-guess-hint"
          onChange={(event) => {
            setGuess(event.target.value.replace(/[^0-9]/g, "").slice(0, 4));
            setSubmitted(false);
          }}
        />
        <button type="submit" disabled={busy || !validNumber(guess)}>{busy ? "正在确认…" : "提交猜测"}</button>
      </div>
      <small id="cg-bac-guess-hint" className={submitted && !validNumber(guess) ? "is-error" : ""}>{inputHint(guess)}</small>
    </form> : <div className="cg-bac-turn-wait" aria-live="polite">
      <span aria-hidden="true">{busy ? "···" : "↔"}</span>
      <p>{finished ? "本局猜测记录已由规则引擎确认" : `${personaName} 的行动完成后会自动回到你的回合`}</p>
    </div>}

    <section className="cg-bac-history" aria-label="猜测历史">
      <header><h4>猜测记录</h4><small>{history.length ? `${history.length} 次猜测` : "等待第一次猜测"}</small></header>
      {!rounds.length ? <div className="cg-bac-empty"><span>0A · 0B</span><p>每次猜测的反馈会留在这里。</p></div> : <div className="cg-bac-rounds">
        {rounds.map((round) => <article key={round.round}>
          <span className="cg-bac-round-number">{String(round.round).padStart(2, "0")}</span>
          <GuessCard owner="你猜" entry={round.user} side="user" />
          <GuessCard owner={`${personaName} 猜`} entry={round.persona} side="persona" />
        </article>)}
      </div>}
    </section>
  </section>;
}
