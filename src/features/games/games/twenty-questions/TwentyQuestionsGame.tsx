import type {
  CasualGameAction,
  CasualGameActor,
  TwentyQuestionsAnswer,
  TwentyQuestionsState,
  TwentyQuestionsTranscriptEntry,
  TwentyQuestionsVerdict,
} from "../../types";

const answers: Array<{ id: TwentyQuestionsAnswer; label: string; mark: string }> = [
  { id: "yes", label: "是", mark: "是" },
  { id: "no", label: "不是", mark: "否" },
  { id: "unknown", label: "不确定", mark: "?" },
];

const verdicts: Array<{ id: TwentyQuestionsVerdict; label: string; mark: string }> = [
  { id: "correct", label: "猜对了", mark: "✓" },
  { id: "incorrect", label: "没猜对", mark: "×" },
];

function responseCopy(entry: TwentyQuestionsTranscriptEntry) {
  if (entry.answer === "yes") return "是";
  if (entry.answer === "no") return "不是";
  if (entry.answer === "unknown") return "不确定";
  if (entry.verdict === "correct") return "猜对了";
  if (entry.verdict === "incorrect") return "没猜对";
  return "等待回答";
}

interface TwentyQuestionsGameProps {
  state: TwentyQuestionsState;
  currentActor: CasualGameActor | null;
  personaName: string;
  busy: boolean;
  pendingUserAction: CasualGameAction | null;
  onAnswer: (answer: TwentyQuestionsAnswer) => void;
  onVerdict: (verdict: TwentyQuestionsVerdict) => void;
}

export function TwentyQuestionsGame({
  state,
  currentActor,
  personaName,
  busy,
  pendingUserAction,
  onAnswer,
  onVerdict,
}: TwentyQuestionsGameProps) {
  const transcript = Array.isArray(state.transcript) ? state.transcript : [];
  const maximum = Number.isInteger(state.max_questions) && state.max_questions > 0 ? state.max_questions : 20;
  const count = Math.min(maximum, Math.max(0, state.question_count || 0));
  const remaining = Math.max(0, maximum - count);
  const pending = state.pending?.kind === "question" || state.pending?.kind === "guess" ? state.pending : null;
  const pendingAnswer = pendingUserAction && "answer" in pendingUserAction ? pendingUserAction.answer : null;
  const pendingVerdict = pendingUserAction && "verdict" in pendingUserAction ? pendingUserAction.verdict : null;
  const activePrompt = state.status === "active" && currentActor === "user" ? pending : null;
  const statusCopy = state.status === "finished"
    ? "这一轮二十问已经结束"
    : currentActor === "persona"
      ? `${personaName} 正在整理下一问`
      : activePrompt?.kind === "guess"
        ? `${personaName} 给出了一个答案`
        : "请按你心里选定的答案回应";

  return <section className="cg-questions" aria-labelledby="cg-questions-status">
    <header className="cg-questions-heading">
      <div className="cg-questions-counter" aria-label={`已使用 ${count} 次，最多 ${maximum} 次`}>
        <strong>{count}</strong><span>/ {maximum}</span>
      </div>
      <div>
        <span>{remaining ? `还剩 ${remaining} 次` : "次数已用完"}</span>
        <h3 id="cg-questions-status" role="status" aria-live="polite">{statusCopy}</h3>
      </div>
    </header>

    <div className="cg-questions-progress" role="progressbar" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={count}>
      <span style={{ width: `${(count / maximum) * 100}%` }} />
    </div>

    {activePrompt ? <section className={`cg-questions-prompt is-${activePrompt.kind}`} aria-label={activePrompt.kind === "guess" ? "Persona 的猜测" : "Persona 的问题"}>
      <span>{activePrompt.kind === "guess" ? "猜测" : `第 ${activePrompt.ordinal} 问`}</span>
      <blockquote>{activePrompt.text}</blockquote>
      {activePrompt.kind === "question" ? <div className="cg-questions-actions is-answer" role="group" aria-label="回答这个问题">
        {answers.map((answer) => <button
          type="button"
          key={answer.id}
          className={pendingAnswer === answer.id ? "is-pending" : ""}
          disabled={busy}
          onClick={() => onAnswer(answer.id)}
        ><i aria-hidden="true">{answer.mark}</i><b>{answer.label}</b></button>)}
      </div> : <div className="cg-questions-actions is-verdict" role="group" aria-label="确认这次猜测">
        {verdicts.map((verdict) => <button
          type="button"
          key={verdict.id}
          className={pendingVerdict === verdict.id ? "is-pending" : ""}
          disabled={busy}
          onClick={() => onVerdict(verdict.id)}
        ><i aria-hidden="true">{verdict.mark}</i><b>{verdict.label}</b></button>)}
      </div>}
    </section> : <div className="cg-questions-wait" aria-live="polite">
      <span aria-hidden="true">?</span>
      <p>{state.status === "finished" ? "全部问答都保留在下方记录中。" : `${personaName} 的下一步由当前 Persona 和对话上下文生成。`}</p>
    </div>}

    <section className="cg-questions-log" aria-label="二十问记录">
      <header><h4>问答记录</h4><small>{transcript.length ? `${transcript.length} 条` : "尚未提问"}</small></header>
      {!transcript.length ? <p className="cg-questions-empty">第一问出现后，会按顺序留在这里。</p> : <ol>
        {[...transcript].reverse().map((entry) => <li key={`${entry.ordinal}:${entry.kind}`} className={`is-${entry.kind}`}>
          <span>{String(entry.ordinal).padStart(2, "0")}</span>
          <div><small>{entry.kind === "guess" ? "猜测" : "问题"}</small><p>{entry.text}</p></div>
          <strong className={responseCopy(entry) === "等待回答" ? "is-waiting" : ""}>{responseCopy(entry)}</strong>
        </li>)}
      </ol>}
    </section>
  </section>;
}
