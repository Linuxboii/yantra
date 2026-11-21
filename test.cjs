const assert = require('node:assert');
const Y = require('./core.js');
const demos = require('./demos.js');

function runFrames(cpu, frames, budget = 2_000_000) {
  let n = 0, last;
  while (n < frames) { last = cpu.run(budget); if (last === 'frame') n++; else break; }
  return last;
}
const screen = (cpu) => cpu.mem.subarray(Y.SCREEN, Y.SCREEN + 4096);
const distinct = (cpu) => new Set(screen(cpu)).size;

// assembler basics
{
  const p = Y.assemble('X = 3\nstart: LDI r1, X+2\nADDI r2, r1, -1\nJMP start');
  assert.equal(p.memory[1], 5);
  assert.equal(p.memory[3], 0xffff);
  assert.equal(p.memory[5], 0);
  assert.throws(() => Y.assemble('FOO r1'), /unknown instruction/);
  assert.throws(() => Y.assemble('ADD r1, r2'), /takes 3 operands/);
  assert.throws(() => Y.assemble('JMP nowhere'), /unknown name/);
  assert.equal(Y.disasm(p.memory, 0).text, 'LDI r1, 0x0005');
}
// FMUL signed
{
  const cpu = new Y.CPU();
  cpu.load(Y.assemble('LDI r1, -512\nLDI r2, 384\nFMUL r3, r1, r2\nHLT'));
  cpu.run(100);
  assert.equal((cpu.r[3] << 16) >> 16, -768); // -2.0 * 1.5 = -3.0
}

for (const d of demos) {
  const prog = Y.assemble(d.src);
  const cpu = new Y.CPU();
  cpu.load(prog);
  const res = runFrames(cpu, d.id === 'mandel' ? 70 : 30);
  assert.equal(cpu.fault, null, `${d.id}: ${cpu.fault}`);
  console.log(d.id, 'words', prog.size, 'result', res, 'colours', distinct(cpu), 'cycles', cpu.cycles);
  assert.ok(distinct(cpu) >= 2, d.id + ' draws nothing');
}

// snake: steer and make sure it moves, eats eventually and never faults
{
  const cpu = new Y.CPU();
  cpu.load(Y.assemble(demos.find((d) => d.id === 'snake').src));
  const keys = [1, 2, 3, 4];
  let maxLen = 0;
  for (let f = 0; f < 20000; f++) {
    if (f % 37 === 0) cpu.key = keys[(f / 37 | 0) % 4];
    const r = cpu.run(1_000_000);
    assert.notEqual(r, 'fault', cpu.fault);
    assert.equal(r, 'frame');
    maxLen = Math.max(maxLen, cpu.mem[0x7f12]);
  }
  console.log('snake max length', maxLen);
  assert.ok(maxLen >= 5);
}
// mandelbrot: the set interior should be black and the outside coloured
{
  const cpu = new Y.CPU();
  cpu.load(Y.assemble(demos.find((d) => d.id === 'mandel').src));
  runFrames(cpu, 64);
  const s = screen(cpu);
  const at = (x, y) => s[y * 64 + x];
  // (-0.2, 0) is inside: px = (-0.2*256+512)/10 = 46, py = 320/10 = 32
  assert.equal(at(46, 32), 0, 'inside should be black');
  assert.notEqual(at(0, 0), 0, 'corner should be outside');
}
console.log('ok');
{
  const cpu = new Y.CPU();
  cpu.load(Y.assemble(demos.find((d) => d.id === 'snake').src));
  let maxLen = 0, deaths = 0, prevLen = 0;
  for (let f = 0; f < 6000; f++) {
    const head = cpu.mem[0x9000 + cpu.mem[0x7f11]], food = cpu.mem[0x7f13];
    const hx = head & 63, hy = head >> 6, fx = food & 63, fy = food >> 6;
    const moved = cpu.mem[0x7f15];
    let want = fx > hx ? 2 : fx < hx ? 4 : fy > hy ? 3 : 1;
    if (Math.abs(want - moved) === 2) want = want % 2 ? 2 : 1; // sidestep a reversal
    cpu.key = want;
    assert.equal(cpu.run(1_000_000), 'frame', cpu.fault);
    const len = cpu.mem[0x7f12];
    if (len < prevLen) deaths++;
    prevLen = len; maxLen = Math.max(maxLen, len);
  }
  console.log('bot snake max length', maxLen, 'deaths', deaths);
  assert.ok(maxLen > 20);
}
