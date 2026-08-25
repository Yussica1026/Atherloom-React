import { useEffect, useRef, useState } from "react";
import { getGameRegistration } from "./GameRegistry";
import { useGameSession } from "./hooks/useGameSession";
import type { OpenGameEffect } from "./types";
import "./games.css";

interface GameOverlayProps {
  effect: OpenGameEffect;
  personaName: string;
  conversationTitle: string;
  onClose: () => void;
  onConversationUpdated: (conversationId: string) => Promise<unknown> | unknown;
}

function resultCopy(outcome: string | undefined, personaName: string) {
  if (outcome === "user_win") return "这一局，你赢了。";
  if (outcome === "persona_win") return `这一局，${personaName} 赢了。`;
  if (outcome === "draw") return "这一局，平局。";
  return "这一局已经落定。";
}

export function GameOverlay({ effect, personaName, conversationTitle, onClose, onConversationUpdated }: GameOverlayProps) {
  const registration = getGameRegistration(effect.game_id);
  const game = useGameSession(effect.session_id, { onConversationUpdated });
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current;
    const siblings = layer?.parentElement
      ? Array.from(layer.parentElement.children).filter((item) => item !== layer) as HTMLElement[]
      : [];
    const inertState = siblings.map((item) => [item, item.hasAttribute("inert")] as const);
    siblings.forEach((item) => item.setAttribute("inert", ""));
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((item) => item.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKey);
      inertState.forEach(([item, wasInert]) => wasInert ? item.setAttribute("inert", "") : item.removeAttribute("inert"));
      previousFocus?.focus();
    };
  }, []);

  const sessionMatchesEffect = game.session?.id === effect.session_id && game.session.game_id === effect.game_id;
  const visibleSession = sessionMatchesEffect ? game.session : null;
  const unsupportedVersion = Boolean(visibleSession && registration && visibleSession.rules_version !== registration.rulesVersion);
  const active = visibleSession?.status === "active";
  const finished = visibleSession?.status === "finished";

  return <div className="cg-layer" ref={layerRef}>
    <section className="cg-room" role="dialog" aria-modal="true" aria-labelledby="cg-room-title" aria-describedby="cg-room-context" ref={dialogRef}>
      <header className="cg-room-header">
        <div>
          <span>CASUAL GAME · SAME PERSONA</span>
          <h2 id="cg-room-title">{registration?.label || "休闲游戏"}</h2>
          <p id="cg-room-context"><strong>{personaName}</strong><i aria-hidden="true">↔</i><span>{conversationTitle || "当前对话"}</span></p>
        </div>
        <button type="button" aria-label="收起游戏" title="收起，游戏仍会保留" onClick={onClose}>×</button>
      </header>

      <main className="cg-room-main">
        {game.phase === "loading" && !visibleSession ? <div className="cg-loading" role="status"><span /><p>正在进入游戏…</p></div> : null}
        {!registration ? <div className="cg-engine-note" role="alert"><strong>这个游戏界面还没有接入</strong><p>Session 已保留，没有写入错误动作。</p></div> : null}
        {unsupportedVersion ? <div className="cg-engine-note" role="alert"><strong>规则版本不一致</strong><p>请更新前端后再继续这局。</p></div> : null}
        {visibleSession && registration && !unsupportedVersion ? registration.render({
          state: visibleSession.state,
          currentActor: visibleSession.current_actor,
          personaName,
          busy: game.busy,
          pendingUserAction: game.pendingUserAction,
          onAction: (action) => void game.playAction(action),
        }) : null}

        {game.error ? <aside className="cg-engine-note is-error" role="alert">
          <strong>{visibleSession?.current_actor === "persona" ? `${personaName} 还没有完成行动` : "游戏没有推进"}</strong>
          <p>{game.error}</p>
          <div>{visibleSession?.current_actor === "persona" && active ? <button type="button" onClick={game.retryPersonaTurn}>让 {personaName} 再想一次</button> : <button type="button" onClick={() => void game.reload()}>重新读取游戏</button>}</div>
        </aside> : null}

        {finished ? <section className="cg-finish" aria-label="本局结果">
          <span>RESULT</span>
          <h3>{resultCopy(game.result?.outcome, personaName)}</h3>
          <p className={`cg-reply-state is-${game.replyStatus}`} aria-live="polite">
            {game.replyStatus === "pending" ? `${personaName} 正在把这局接回原对话…` : null}
            {game.replyStatus === "saved" ? `赛后回复已经回到「${conversationTitle || "原对话"}」。` : null}
            {game.replyStatus === "error" ? `赛后回复尚未完成：${game.replyError}` : null}
          </p>
          {game.replyStatus === "error" ? <button type="button" className="cg-text-action" onClick={game.retryChatReply}>重新接回对话</button> : null}

          {game.memoryMode === "ask" && game.memoryStatus === "idle" ? <div className="cg-memory-choice">
            <div><strong>要把这局留给「{personaName}」吗？</strong><small>只保存这局的事实摘要，不保存每次行动。</small></div>
            <div><button type="button" onClick={() => void game.decideMemory(false)}>这次不记</button><button type="button" className="is-primary" onClick={() => void game.decideMemory(true)}>记住这局</button></div>
          </div> : null}
          {game.memoryStatus === "pending" ? <p className="cg-memory-state" role="status">正在保存你的选择…</p> : null}
          {game.memoryStatus === "accepted" ? <p className="cg-memory-state">这局已经留进 {personaName} 原来的记忆。</p> : null}
          {game.memoryStatus === "declined" ? <p className="cg-memory-state">这次不写入长期记忆。</p> : null}
          {game.memoryStatus === "error" ? <div className="cg-memory-state is-error" role="alert"><span>{game.memoryError}</span><button type="button" onClick={() => void game.decideMemory(false)}>这次不记</button><button type="button" onClick={() => void game.decideMemory(true)}>重试记住</button></div> : null}
        </section> : null}
      </main>

      <footer className="cg-room-footer">
        {active ? confirmAbandon ? <div className="cg-abandon-confirm" role="group" aria-label="确认结束游戏"><span>结束后不能继续这一局。</span><button type="button" onClick={() => setConfirmAbandon(false)}>继续玩</button><button type="button" className="is-danger" disabled={game.busy} onClick={() => void game.abandon().then((done) => done && onClose())}>确认结束</button></div> : <button type="button" className="cg-abandon" disabled={game.busy} onClick={() => setConfirmAbandon(true)}>结束这局</button> : null}
        <button type="button" className="cg-return" onClick={onClose}>{finished ? "回到对话" : "收起游戏"}</button>
      </footer>
    </section>
  </div>;
}
