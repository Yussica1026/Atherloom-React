import type {
  CasualGameAction,
  CasualGameActor,
  RockPaperScissorsChoice,
  RockPaperScissorsState,
} from "../../types";

const choices: Array<{
  id: RockPaperScissorsChoice;
  glyph: string;
  label: string;
  note: string;
}> = [
  { id: "rock", glyph: "石", label: "石头", note: "胜剪刀" },
  { id: "scissors", glyph: "剪", label: "剪刀", note: "胜布" },
  { id: "paper", glyph: "布", label: "布", note: "胜石头" },
];

const choiceIds = new Set<RockPaperScissorsChoice>(choices.map((choice) => choice.id));

function choiceOf(value: unknown): RockPaperScissorsChoice | null {
  return typeof value === "string" && choiceIds.has(value as RockPaperScissorsChoice)
    ? value as RockPaperScissorsChoice
    : null;
}

function choiceDetails(choice: RockPaperScissorsChoice | null) {
  return choices.find((item) => item.id === choice) || null;
}

interface HandCardProps {
  owner: string;
  choice: RockPaperScissorsChoice | null;
  revealed: boolean;
  placeholder: string;
  className: string;
}

function HandCard({ owner, choice, revealed, placeholder, className }: HandCardProps) {
  const details = revealed ? choiceDetails(choice) : null;
  const accessibleChoice = details ? details.label : placeholder;
  return <div className={`cg-rps-hand ${className}${revealed ? " is-revealed" : " is-sealed"}`} aria-label={`${owner}：${accessibleChoice}`}>
    <span className="cg-rps-owner">{owner}</span>
    <span className="cg-rps-hand-face" aria-hidden="true">
      {details ? <><b>{details.glyph}</b><small>{details.label}</small></> : <><b>封</b><small>{placeholder}</small></>}
    </span>
  </div>;
}

interface RockPaperScissorsGameProps {
  state: RockPaperScissorsState;
  currentActor: CasualGameActor | null;
  personaName: string;
  busy: boolean;
  pendingUserAction: CasualGameAction | null;
  onChoose: (choice: RockPaperScissorsChoice) => void;
}

export function RockPaperScissorsGame({
  state,
  currentActor,
  personaName,
  busy,
  pendingUserAction,
  onChoose,
}: RockPaperScissorsGameProps) {
  const finished = state.status === "finished";
  const pendingChoice = pendingUserAction && "choice" in pendingUserAction
    ? choiceOf(pendingUserAction.choice)
    : null;
  const userChoice = finished ? choiceOf(state.user_choice) : pendingChoice;
  const personaChoice = finished ? choiceOf(state.persona_choice) : null;
  const committed = Boolean(state.user_choice_committed || currentActor === "persona" || pendingChoice);
  const statusCopy = finished
    ? "双方选择已经同时揭开"
    : currentActor === "user" && !busy
      ? "选好一手，等双方一起揭开"
      : committed
        ? `${personaName} 正在选择，对方的一手仍然封存`
        : "正在提交你的选择";

  return <section className="cg-rps" aria-labelledby="cg-rps-status">
    <p className="cg-rps-status" id="cg-rps-status" role="status" aria-live="polite">{statusCopy}</p>

    <div className="cg-rps-stage" aria-busy={!finished && busy}>
      <HandCard
        owner="你"
        choice={userChoice}
        revealed={finished}
        placeholder={committed ? "已封存" : "待选择"}
        className="is-user"
      />
      <div className={`cg-rps-knot${finished ? " is-open" : ""}`} aria-hidden="true">
        <span>{finished ? "揭" : "同"}</span>
      </div>
      <HandCard
        owner={personaName}
        choice={personaChoice}
        revealed={finished}
        placeholder="未揭开"
        className="is-persona"
      />
    </div>

    {state.status === "active" && currentActor === "user" ? <div className="cg-rps-choices" role="group" aria-label="选择石头、剪刀或布">
      {choices.map((choice) => <button
        type="button"
        key={choice.id}
        disabled={busy}
        aria-label={`选择${choice.label}，${choice.note}`}
        onClick={() => onChoose(choice.id)}
      >
        <span aria-hidden="true">{choice.glyph}</span>
        <b>{choice.label}</b>
        <small>{choice.note}</small>
      </button>)}
    </div> : null}

    <small className="cg-rps-rule">双方选择由服务器分别提交 · 结果由规则引擎确认</small>
  </section>;
}
