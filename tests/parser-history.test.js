import test from "node:test";
import assert from "node:assert/strict";
import { parseGamesFromText } from "../src/utils/parseGames.js";
import { createHistory, historyReducer } from "../src/utils/historyReducer.js";

test("README game blocks retain dates, platforms and unlabelled descriptions", () => {
  const games = parseGamesFromText("《007》\r\n发售日期：2026年9月24日\r\n登陆平台：PS5 / PC\r\n现已开启预购，Steam国区售价268元\r\n《第二款》\r\n日期：待定\r\n平台：Nintendo Switch2\r\n备注：包含《前作》的故事");
  assert.equal(games.length, 2);
  assert.equal(games[0].title, "007");
  assert.equal(games[0].date, "2026年9月24日");
  assert.deepEqual(games[0].platforms, ["PS5", "PC"]);
  assert.equal(games[0].info, "现已开启预购，Steam国区售价268元");
  assert.equal(games[1].date, "待定");
  assert.deepEqual(games[1].platforms, ["Switch 2"]);
  assert.equal(games[1].info, "包含《前作》的故事");
});
test("labelled titles, separators, platform aliases and numeric titles", () => {
  const games = parseGamesFromText("游戏名称：1945\n平台：Xbox Series X|S / Switch / Switch 2 / Steam\n关键信息：第一行\n第二行\n---\n游戏名：另一个\n发行日期：2027年\n平台：Linux");
  assert.equal(games[0].title, "1945");
  assert.deepEqual(games[0].platforms, ["XBOX Series", "Switch", "Switch 2", "PC"]);
  assert.equal(games[0].info, "第一行 第二行");
  assert.equal(games[1].date, "2027年");
  assert.deepEqual(games[1].platforms, ["Linux"]);
  for (const empty of [null, undefined, {}, " \r\n"]) assert.deepEqual(parseGamesFromText(empty), []);
});
test("blank lines inside explicitly titled blocks do not create phantom games", () => {
  const games = parseGamesFromText("《第一款》\n\n日期：2026年\n平台：Switch 2\n\n试玩现已开放\n\n游戏名：第二款\n平台：PC");
  assert.equal(games.length, 2);
  assert.equal(games[0].info, "试玩现已开放");
  assert.deepEqual(games[0].platforms, ["Switch 2"]);
});
test("history reducer is repeatable and supports consecutive undo/redo", () => {
  const initial = createHistory(() => 0);
  const action = { type: "set", updater: (n) => n + 1 };
  const first = historyReducer(initial, action);
  assert.deepEqual(historyReducer(initial, action), first);
  assert.deepEqual(initial, { past: [], present: 0, future: [] });
  let state = historyReducer(first, action);
  state = historyReducer(state, { type: "undo" });
  assert.equal(state.present, 1);
  state = historyReducer(state, { type: "undo" });
  assert.equal(state.present, 0);
  state = historyReducer(state, { type: "redo" });
  state = historyReducer(state, { type: "redo" });
  assert.equal(state.present, 2);
});
test("history capacity, no-ops, branching and reset", () => {
  for (const maxHistory of [0, 1, 2]) {
    let state = createHistory(0);
    for (let i = 1; i <= 4; i++) state = historyReducer(state, { type: "set", updater: i, maxHistory });
    assert.equal(state.past.length, maxHistory);
    for (let i = 0; i < 4; i++) state = historyReducer(state, { type: "undo", maxHistory });
    assert.equal(state.present, 4 - maxHistory);
    assert.equal(historyReducer(state, { type: "set", updater: (n) => n }), state);
    state = historyReducer(state, { type: "set", updater: 9, maxHistory });
    assert.deepEqual(state.future, []);
    assert.deepEqual(historyReducer(state, { type: "reset", updater: () => 42 }), { past: [], present: 42, future: [] });
  }
});
