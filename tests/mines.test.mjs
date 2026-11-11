import test from 'node:test';
import assert from 'node:assert/strict';
import {createMinefield,createMinesGame} from '../dist/src/apps-extra.js';

const deterministic = () => {
  let seed = 20261110;
  return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
};

test('all 81 first moves are safe and open a useful flood area', () => {
  for (let index = 0; index < 81; index++) {
    const game = createMinesGame(deterministic());
    assert.equal(game.reveal(index),true);
    assert.equal(game.state.cells.filter(cell => cell.mine).length,10);
    assert.equal(game.state.cells[index].mine,false);
    assert.equal(game.state.cells[index].count,0);
    assert.ok(game.state.cells.filter(cell => cell.revealed).length >= 4);
    assert.equal(game.state.cells.some(cell => cell.revealed && cell.mine),false);
    assert.equal(game.state.moves,1);
  }
});

test('clues equal neighboring mines and never exceed eight', () => {
  const field = createMinefield(9,10,40,deterministic());
  field.cells.forEach((cell,index) => {
    assert.equal(cell.count,field.neighbors(index).filter(near => field.cells[near].mine).length);
    assert.ok(cell.count >= 0 && cell.count <= 8);
  });
});

test('flags block reveals, survive the first move and are limited to ten', () => {
  const game = createMinesGame(deterministic());
  for (let index = 0; index < 10; index++) assert.equal(game.flag(index),true);
  assert.equal(game.flag(10),false);
  assert.equal(game.reveal(0),false);
  assert.equal(game.state.started,false);
  game.reveal(80);
  assert.equal(game.state.cells.filter(cell => cell.flagged).length,10);
  for (let index = 0; index < 10; index++) assert.equal(game.state.cells[index].revealed,false);
  assert.equal(game.flag(0),true);
  assert.equal(game.state.cells[0].flagged,false);
});

test('revealing all safe cells wins and terminal input cannot change the result', () => {
  const game = createMinesGame(deterministic());
  game.reveal(40);
  game.state.cells.forEach((cell,index) => { if (!cell.mine) game.reveal(index); });
  assert.equal(game.state.ended,true);
  assert.equal(game.state.won,true);
  assert.equal(game.state.cells.filter(cell => cell.revealed).length,71);
  assert.equal(game.state.cells.filter(cell => cell.flagged).length,10);
  const final = JSON.stringify(game.state);
  assert.equal(game.reveal(game.state.cells.findIndex(cell => cell.mine)),false);
  assert.equal(game.flag(0),false);
  assert.equal(JSON.stringify(game.state),final);
});

test('a mine ends the round and restart produces a clean playable board', () => {
  const game = createMinesGame(deterministic());
  game.reveal(40);
  const mine = game.state.cells.findIndex(cell => cell.mine);
  assert.equal(game.reveal(mine),true);
  assert.equal(game.state.ended,true);
  assert.equal(game.state.won,false);
  assert.equal(game.state.cells.filter(cell => cell.mine && cell.revealed).length,10);
  const moves = game.state.moves;
  assert.equal(game.reveal(0),false);
  assert.equal(game.state.moves,moves);
  game.reset();
  assert.equal(game.state.started,false);
  assert.equal(game.state.ended,false);
  assert.equal(game.state.moves,0);
  assert.equal(game.state.cells.some(cell => cell.revealed || cell.flagged || cell.mine),false);
  assert.equal(game.reveal(0),true);
});

test('invalid coordinates fail safely without mutating game state', () => {
  const game = createMinesGame(deterministic());
  const initial = JSON.stringify(game.state);
  for (const invalid of [-1,81,NaN,Infinity,0.5,'0',null]) {
    assert.equal(game.reveal(invalid),false);
    assert.equal(game.flag(invalid),false);
  }
  assert.equal(JSON.stringify(game.state),initial);
});
