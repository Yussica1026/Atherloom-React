import assert from "node:assert/strict";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  clear() {
    this.#values.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

let deterministicRandomWord = 48;
globalThis.crypto.getRandomValues = (values) => {
  values.fill(deterministicRandomWord);
  return values;
};

const {
  createStandaloneCasualGameSession,
  requestStandaloneCasualGameJson,
} = await import("../src/adapters/standalone/casualGames.ts");

const personaActions = [];
const personaRequests = [];
const runtime = {
  resolveConversation(conversationId) {
    return { conversation_id: conversationId, persona_id: "persona-local", player_id: "user-local" };
  },
  async choosePersonaAction(request) {
    personaRequests.push(request);
    assert.equal(JSON.stringify(request.public_state).includes("secret"), false);
    assert.equal(JSON.stringify(request.session).includes("secret"), false);
    assertNoPrivateDeck(request.public_state, "Persona public_state");
    assertNoPrivateDeck(request.session, "Persona session");
    const action = personaActions.shift();
    assert.ok(action, "the test must provide a Persona action");
    return action;
  },
  async createChatReply() {
    return { assistant_id: "assistant-result", content: "result reply" };
  },
  createMemory() {
    return { memory_id: "memory-result" };
  },
};

function assertNoPrivateDeck(value, label = "public response") {
  const visit = (item) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    assert.equal(Object.prototype.hasOwnProperty.call(item, "deck"), false, `${label} must not expose deck`);
    Object.values(item).forEach(visit);
  };
  visit(value);
}

function jsonRequest(path, method = "GET", body = undefined) {
  return requestStandaloneCasualGameJson(
    path,
    {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    runtime,
  );
}

const games = await jsonRequest("/api/casual-games");
assert.equal(games.games.length, 5);
assert.deepEqual(games.games.map((game) => game.id), [
  "tic_tac_toe",
  "rock_paper_scissors",
  "bulls_and_cows",
  "twenty_questions",
  "blackjack",
]);

assert.throws(
  () => createStandaloneCasualGameSession(
    { game_id: "bulls_and_cows", conversation_id: "conversation-local", options: {} },
    runtime,
  ),
  /四位互不重复/,
);

const bulls = createStandaloneCasualGameSession(
  {
    game_id: "bulls_and_cows",
    conversation_id: "conversation-local",
    options: { user_secret: "1234" },
  },
  runtime,
  "create-bulls",
);
assert.equal(bulls.current_actor, "user");
assert.equal(JSON.stringify(bulls).includes("1234"), false);
assert.equal(JSON.stringify(bulls).includes("secret"), false);

const userGuess = await jsonRequest(
  `/api/casual-games/sessions/${bulls.id}/actions`,
  "POST",
  { action: { guess: "5678" }, expected_revision: 0, idempotency_key: "bulls-user-1" },
);
assert.equal(userGuess.revision, 1);
assert.equal(userGuess.current_actor, "persona");
assert.equal(userGuess.events[0].type, "guess_scored");
assert.equal(JSON.stringify(userGuess).includes("secret"), false);

personaActions.push({ guess: "1234" });
const personaGuess = await jsonRequest(
  `/api/casual-games/sessions/${bulls.id}/persona-turn`,
  "POST",
  { expected_revision: 1, idempotency_key: "bulls-persona-1" },
);
assert.equal(personaGuess.revision, 2);
assert.equal(personaGuess.status, "finished");
assert.equal(personaGuess.result.outcome, "persona_win");
assert.equal(JSON.stringify(personaGuess).includes("secret"), false);

const replay = await jsonRequest(
  `/api/casual-games/sessions/${bulls.id}/persona-turn`,
  "POST",
  { expected_revision: 1, idempotency_key: "bulls-persona-1" },
);
assert.equal(replay.idempotent_replay, true);
assert.equal(replay.revision, 2);

const twenty = createStandaloneCasualGameSession(
  { game_id: "twenty_questions", conversation_id: "conversation-local", options: {} },
  runtime,
  "create-twenty",
);
assert.equal(twenty.current_actor, "persona");
assert.equal(twenty.state.question_count, 0);

personaActions.push({ kind: "guess", text: "是一只猫吗？" });
const question = await jsonRequest(
  `/api/casual-games/sessions/${twenty.id}/persona-turn`,
  "POST",
  { expected_revision: 0, idempotency_key: "twenty-persona-1" },
);
assert.equal(question.revision, 1);
assert.equal(question.current_actor, "user");
assert.equal(question.state.pending.kind, "guess");
assert.equal(question.state.question_count, 1);

const verdict = await jsonRequest(
  `/api/casual-games/sessions/${twenty.id}/actions`,
  "POST",
  { action: { verdict: "correct" }, expected_revision: 1, idempotency_key: "twenty-user-1" },
);
assert.equal(verdict.revision, 2);
assert.equal(verdict.status, "finished");
assert.equal(verdict.result.outcome, "persona_win");
assert.equal(verdict.state.transcript[0].verdict, "correct");

const twentyLimit = createStandaloneCasualGameSession(
  { game_id: "twenty_questions", conversation_id: "conversation-local", options: {} },
  runtime,
  "create-twenty-limit",
);
let limitResponse = null;
for (let ordinal = 1; ordinal <= 20; ordinal += 1) {
  const personaRevision = (ordinal - 1) * 2;
  personaActions.push({ kind: "question", text: `第 ${ordinal} 个问题` });
  const asked = await jsonRequest(
    `/api/casual-games/sessions/${twentyLimit.id}/persona-turn`,
    "POST",
    { expected_revision: personaRevision, idempotency_key: `twenty-limit-persona-${ordinal}` },
  );
  assert.equal(asked.revision, personaRevision + 1);
  limitResponse = await jsonRequest(
    `/api/casual-games/sessions/${twentyLimit.id}/actions`,
    "POST",
    {
      action: { answer: "no" },
      expected_revision: personaRevision + 1,
      idempotency_key: `twenty-limit-user-${ordinal}`,
    },
  );
}
assert.equal(limitResponse.revision, 40);
assert.equal(limitResponse.status, "finished");
assert.equal(limitResponse.result.outcome, "user_win");
assert.deepEqual(limitResponse.result.notable_events, ["question_limit_reached"]);

deterministicRandomWord = 0;
const blackjack = createStandaloneCasualGameSession(
  { game_id: "blackjack", conversation_id: "conversation-local", options: {} },
  runtime,
  "create-blackjack",
);
assert.equal(blackjack.current_actor, "user");
assert.equal(blackjack.state.user_total, 21);
assert.equal(blackjack.state.persona_total, 20);
assert.equal(blackjack.state.deck_remaining, 48);
assertNoPrivateDeck(blackjack, "created blackjack session");

await assert.rejects(
  jsonRequest(
    `/api/casual-games/sessions/${blackjack.id}/actions`,
    "POST",
    { action: { decision: "hit" }, expected_revision: 0, idempotency_key: "blackjack-user-hit-at-21" },
  ),
  /达到 21 点后只能停牌/,
);

const blackjackStand = await jsonRequest(
  `/api/casual-games/sessions/${blackjack.id}/actions`,
  "POST",
  { action: { decision: "stand" }, expected_revision: 0, idempotency_key: "blackjack-user-stand" },
);
assert.equal(blackjackStand.revision, 1);
assert.equal(blackjackStand.current_actor, "persona");
assert.equal(blackjackStand.state.user_stood, true);
assertNoPrivateDeck(blackjackStand, "blackjack user action");

const blackjackStandReplay = await jsonRequest(
  `/api/casual-games/sessions/${blackjack.id}/actions`,
  "POST",
  { action: { decision: "stand" }, expected_revision: 0, idempotency_key: "blackjack-user-stand" },
);
assert.equal(blackjackStandReplay.idempotent_replay, true);
assert.equal(blackjackStandReplay.revision, 1);
assertNoPrivateDeck(blackjackStandReplay, "blackjack user action replay");

personaActions.push({ decision: "stand" });
const blackjackFinished = await jsonRequest(
  `/api/casual-games/sessions/${blackjack.id}/persona-turn`,
  "POST",
  { expected_revision: 1, idempotency_key: "blackjack-persona-stand" },
);
assert.equal(blackjackFinished.revision, 2);
assert.equal(blackjackFinished.status, "finished");
assert.equal(blackjackFinished.current_actor, null);
assert.equal(blackjackFinished.result.outcome, "user_win");
assert.deepEqual(blackjackFinished.result.score, { user: 21, persona: 20 });
assert.equal(blackjackFinished.events.at(-1).type, "game_finished");
assertNoPrivateDeck(blackjackFinished, "finished blackjack response");

const blackjackPersonaRequest = personaRequests.at(-1);
assert.equal(blackjackPersonaRequest.session.game_id, "blackjack");
assert.deepEqual(blackjackPersonaRequest.action_schema.properties.decision.enum, ["hit", "stand"]);
assertNoPrivateDeck(blackjackPersonaRequest, "blackjack Persona request");

const blackjackFinishedReplay = await jsonRequest(
  `/api/casual-games/sessions/${blackjack.id}/persona-turn`,
  "POST",
  { expected_revision: 1, idempotency_key: "blackjack-persona-stand" },
);
assert.equal(blackjackFinishedReplay.idempotent_replay, true);
assert.equal(blackjackFinishedReplay.revision, 2);
assertNoPrivateDeck(blackjackFinishedReplay, "blackjack Persona replay");

const tic = createStandaloneCasualGameSession(
  { game_id: "tic_tac_toe", conversation_id: "conversation-local", options: {} },
  runtime,
);
const rps = createStandaloneCasualGameSession(
  { game_id: "rock_paper_scissors", conversation_id: "conversation-local", options: {} },
  runtime,
);
assert.equal(tic.current_actor, "user");
assert.equal(rps.current_actor, "user");

const listed = await jsonRequest("/api/casual-games/sessions?conversation_id=conversation-local");
assert.equal(listed.sessions.length, 6);
assert.equal(JSON.stringify(listed).includes("secret"), false);
assertNoPrivateDeck(listed, "listed sessions");

console.log("standalone casual games runtime: ok");
