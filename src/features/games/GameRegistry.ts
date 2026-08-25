import { createElement, type ReactNode } from "react";
import { RockPaperScissorsGame } from "./games/rock-paper-scissors/RockPaperScissorsGame";
import { TicTacToeGame } from "./games/tic-tac-toe/TicTacToeGame";
import type {
  CasualGameAction,
  CasualGameActor,
  CasualGameId,
  RegisteredCasualGameState,
  RockPaperScissorsState,
  TicTacToeState,
} from "./types";

export interface GameViewProps {
  state: RegisteredCasualGameState;
  currentActor: CasualGameActor | null;
  personaName: string;
  busy: boolean;
  pendingUserAction: CasualGameAction | null;
  onAction: (action: CasualGameAction) => void;
}

export interface GameRegistration {
  id: CasualGameId;
  label: string;
  rulesVersion: number;
  render: (props: GameViewProps) => ReactNode;
}

const registrations: Partial<Record<CasualGameId, GameRegistration>> = {
  tic_tac_toe: {
    id: "tic_tac_toe",
    label: "井字棋",
    rulesVersion: 1,
    render: (props) => createElement(TicTacToeGame, {
      state: props.state as TicTacToeState,
      currentActor: props.currentActor,
      personaName: props.personaName,
      busy: props.busy,
      onMove: (position) => props.onAction({ position }),
    }),
  },
  rock_paper_scissors: {
    id: "rock_paper_scissors",
    label: "石头 · 剪刀 · 布",
    rulesVersion: 1,
    render: (props) => createElement(RockPaperScissorsGame, {
      state: props.state as RockPaperScissorsState,
      currentActor: props.currentActor,
      personaName: props.personaName,
      busy: props.busy,
      pendingUserAction: props.pendingUserAction,
      onChoose: (choice) => props.onAction({ choice }),
    }),
  },
};

export function getGameRegistration(gameId: CasualGameId) {
  return registrations[gameId] || null;
}

export function listGameRegistrations() {
  return [registrations.tic_tac_toe, registrations.rock_paper_scissors].filter((item): item is GameRegistration => Boolean(item));
}
