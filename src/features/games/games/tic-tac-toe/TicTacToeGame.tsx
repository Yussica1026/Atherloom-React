import { useMemo } from "react";
import type { CasualGameActor, TicTacToeState } from "../../types";

const winningLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

function winningLine(board: TicTacToeState["board"]) {
  return winningLines.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]) || null;
}

function point(position: number) {
  return {
    x: (position % 3) * 100 + 50,
    y: Math.floor(position / 3) * 100 + 50,
  };
}

function cellLabel(position: number, mark: "X" | "O" | null, personaName: string) {
  const row = Math.floor(position / 3) + 1;
  const column = (position % 3) + 1;
  if (!mark) return `第 ${row} 行第 ${column} 列，空白`;
  return `第 ${row} 行第 ${column} 列，${mark === "X" ? "你" : personaName} 已落子`;
}

interface TicTacToeGameProps {
  state: TicTacToeState;
  currentActor: CasualGameActor | null;
  personaName: string;
  busy: boolean;
  onMove: (position: number) => void;
}

export function TicTacToeGame({ state, currentActor, personaName, busy, onMove }: TicTacToeGameProps) {
  const board = Array.from({ length: 9 }, (_, index) => state.board?.[index] === "X" || state.board?.[index] === "O" ? state.board[index] : null);
  const line = useMemo(() => winningLine(board), [board]);
  const start = line ? point(line[0]) : null;
  const end = line ? point(line[2]) : null;
  const turnCopy = state.status === "finished"
    ? line ? (board[line[0]] === "X" ? "这一局你赢了" : `这一局 ${personaName} 赢了`) : "这一局是平局"
    : currentActor === "user" ? "轮到你落子" : currentActor === "persona" ? `${personaName} 正在看棋盘` : "棋局暂停";

  return <section className="cg-ttt" aria-labelledby="cg-turn-status">
    <div className="cg-players" aria-label="棋子归属">
      <span className="is-user"><i aria-hidden="true">×</i><b>你</b><small>先手 · X</small></span>
      <span className="cg-thread-knot" aria-hidden="true" />
      <span className="is-persona"><i aria-hidden="true">○</i><b>{personaName}</b><small>同一人格 · O</small></span>
    </div>
    <p className="cg-turn-status" id="cg-turn-status" role="status" aria-live="polite">{turnCopy}</p>
    <div className="cg-board-wrap">
      <div className="cg-board" role="grid" aria-label="井字棋棋盘">
        {board.map((mark, position) => <button
          type="button"
          role="gridcell"
          className={`cg-cell${mark === "X" ? " is-user" : mark === "O" ? " is-persona" : ""}${line?.some((value) => value === position) ? " is-winning" : ""}`}
          disabled={busy || state.status !== "active" || currentActor !== "user" || Boolean(mark)}
          aria-label={cellLabel(position, mark, personaName)}
          onClick={() => onMove(position)}
          key={position}
        >{mark ? <span aria-hidden="true">{mark === "X" ? "×" : "○"}</span> : <span className="cg-cell-empty" aria-hidden="true" />}</button>)}
      </div>
      {start && end ? <svg className="cg-winning-thread" viewBox="0 0 300 300" aria-hidden="true">
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      </svg> : null}
    </div>
    <small className="cg-revision">第 {state.move_count || 0} 手 · 规则与胜负由程序确认</small>
  </section>;
}
