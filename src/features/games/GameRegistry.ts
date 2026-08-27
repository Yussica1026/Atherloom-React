import { createElement, type ReactNode } from "react";
import { BullsAndCowsGame } from "./games/bulls-and-cows/BullsAndCowsGame";
import { RockPaperScissorsGame } from "./games/rock-paper-scissors/RockPaperScissorsGame";
import { TicTacToeGame } from "./games/tic-tac-toe/TicTacToeGame";
import { TwentyQuestionsGame } from "./games/twenty-questions/TwentyQuestionsGame";
import type {
  BullsAndCowsState,
  CasualGameAction,
  CasualGameActor,
  CasualGameId,
  RegisteredCasualGameState,
  RockPaperScissorsState,
  TicTacToeState,
  TwentyQuestionsState,
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
  eyebrow: string;
  description: string;
  resumeMark: string;
  rulesVersion: number;
  render: (props: GameViewProps) => ReactNode;
}

const registrations: Partial<Record<CasualGameId, GameRegistration>> = {
  tic_tac_toe: {
    id: "tic_tac_toe",
    label: "井字棋",
    eyebrow: "THREE IN A ROW",
    description: "你执 X，Persona 执 O；每一步由程序判定是否合法。",
    resumeMark: "× ○",
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
    eyebrow: "HIDDEN CHOICE",
    description: "你的选择会先封住，等 Persona 出手后一起揭晓。",
    resumeMark: "石 · 剪 · 布",
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
  bulls_and_cows: {
    id: "bulls_and_cows",
    label: "猜数字",
    eyebrow: "FOUR DISTINCT DIGITS",
    description: "双方各藏一个四位不重复数字，轮流根据 A / B 反馈猜答案。",
    resumeMark: "1A · 2B",
    rulesVersion: 1,
    render: (props) => createElement(BullsAndCowsGame, {
      state: props.state as BullsAndCowsState,
      currentActor: props.currentActor,
      personaName: props.personaName,
      busy: props.busy,
      pendingUserAction: props.pendingUserAction,
      onGuess: (guess) => props.onAction({ guess }),
    }),
  },
  twenty_questions: {
    id: "twenty_questions",
    label: "二十问",
    eyebrow: "YES · NO · UNKNOWN",
    description: "你先在心里选定答案，Persona 最多用二十次提问或猜测找到它。",
    resumeMark: "? / 20",
    rulesVersion: 1,
    render: (props) => createElement(TwentyQuestionsGame, {
      state: props.state as TwentyQuestionsState,
      currentActor: props.currentActor,
      personaName: props.personaName,
      busy: props.busy,
      pendingUserAction: props.pendingUserAction,
      onAnswer: (answer) => props.onAction({ answer }),
      onVerdict: (verdict) => props.onAction({ verdict }),
    }),
  },
};

export function getGameRegistration(gameId: CasualGameId) {
  return registrations[gameId] || null;
}

export function listGameRegistrations() {
  return [
    registrations.tic_tac_toe,
    registrations.rock_paper_scissors,
    registrations.bulls_and_cows,
    registrations.twenty_questions,
  ].filter((item): item is GameRegistration => Boolean(item));
}
