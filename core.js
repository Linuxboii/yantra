/* Yantra core: a 16-bit fantasy CPU, its assembler and disassembler.
   No DOM in here, so the same file runs in the page and under node tests.

   Machine
     8 registers r0..r7, 16-bit. 64K words of 16-bit memory.
     Screen: 64x64 words at 0xF000, low 4 bits = palette index.
     Stack grows down from 0xEFFF. Keyboard: KEY reads the last key code.

   Encoding (one word, plus one immediate word when the op takes one)
     15..10 opcode | 9..7 rd | 6..4 rs | 3..1 rt | 0 unused            */
(function (root) {
  'use strict';

  const SCREEN = 0xf000, STACK_TOP = 0xefff, W = 64;

  // name, operand shape, has-immediate. Shapes: d=rd s=rs t=rt i=imm
  const OPS = [
    ['HLT', ''], ['LDI', 'di'], ['MOV', 'ds'], ['ADD', 'dst'], ['SUB', 'dst'],
    ['MUL', 'dst'], ['DIV', 'dst'], ['MOD', 'dst'], ['AND', 'dst'], ['OR', 'dst'],
    ['XOR', 'dst'], ['SHL', 'dst'], ['SHR', 'dst'], ['SAR', 'dst'], ['ADDI', 'dsi'],
    ['LD', 'ds'], ['ST', 'ds'], ['JMP', 'i'], ['JZ', 'si'], ['JNZ', 'si'],
    ['JLT', 'sti'], ['JGE', 'sti'], ['JEQ', 'sti'], ['JNE', 'sti'], ['CALL', 'i'],
    ['RET', ''], ['PUSH', 's'], ['POP', 'd'], ['RND', 'd'], ['FRAME', ''],
    ['KEY', 'd'], ['FMUL', 'dst'], ['NOP', ''],
  ];
  const OPCODE = Object.fromEntries(OPS.map(([n], i) => [n, i]));

  const s16 = (v) => (v << 16) >> 16;
  const u16 = (v) => v & 0xffff;

  /* ---------------- assembler ---------------- */
  class AsmError extends Error {
    constructor(line, msg) { super(`line ${line}: ${msg}`); this.line = line; }
  }

  function parseNumber(tok) {
    const t = tok.trim().toLowerCase();
    let m;
    if ((m = /^(-?)0x([0-9a-f]+)$/.exec(t))) return (m[1] ? -1 : 1) * parseInt(m[2], 16);
    if ((m = /^(-?)0b([01]+)$/.exec(t))) return (m[1] ? -1 : 1) * parseInt(m[2], 2);
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    if ((m = /^'(.)'$/.exec(tok.trim()))) return m[1].charCodeAt(0);
    return null;
  }

  // Splits "ADD r1, r2, r3 ; comment" into ["ADD", ["r1","r2","r3"]].
  function splitLine(raw) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) return null;
    const sp = line.search(/\s/);
    const head = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1);
    const args = rest.trim() ? rest.split(',').map((a) => a.trim()) : [];
    return [head, args];
  }

  function assemble(src) {
    const lines = src.split('\n');
    const labels = Object.create(null);
    const consts = Object.create(null);
    const items = []; // {line, op, args, addr} or {line, data:[...], addr}
    let pc = 0;

    // pass 1: addresses, labels, constants
    lines.forEach((raw, idx) => {
      const ln = idx + 1;
      let text = raw.replace(/;.*$/, '');
      let m;
      while ((m = /^\s*([A-Za-z_][\w]*)\s*:/.exec(text))) {
        const name = m[1].toUpperCase();
        if (name in labels || name in consts) throw new AsmError(ln, `"${m[1]}" defined twice`);
        labels[name] = pc;
        text = text.slice(m[0].length);
      }
      if ((m = /^\s*([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(text))) {
        const name = m[1].toUpperCase();
        if (name in labels || name in consts) throw new AsmError(ln, `"${m[1]}" defined twice`);
        consts[name] = { expr: m[2].trim(), line: ln };
        return;
      }
      const parts = splitLine(text);
      if (!parts) return;
      const [head, args] = parts;
      const op = head.toUpperCase();
      if (op === 'DW') {
        items.push({ line: ln, data: args, addr: pc });
        pc += args.length;
      } else if (op === '.ORG') {
        const v = parseNumber(args[0] || '');
        if (v === null) throw new AsmError(ln, '.org needs a number');
        pc = v;
      } else if (op in OPCODE) {
        const shape = OPS[OPCODE[op]][1];
        items.push({ line: ln, op, args, addr: pc });
        pc += shape.includes('i') ? 2 : 1;
      } else {
        throw new AsmError(ln, `unknown instruction "${head}"`);
      }
      if (pc > STACK_TOP - 256) throw new AsmError(ln, 'program runs into the stack');
    });

    const resolving = new Set();
    function value(tok, ln) {
      const t = tok.trim();
      // small expressions: a+b, a-b (left to right)
      const terms = t.split(/(?=[+-])(?<=[\w)'])/);
      if (terms.length > 1) return terms.reduce((acc, term) => acc + value(term, ln), 0);
      let neg = false, body = t;
      if (/^[+-]/.test(body) && parseNumber(body) === null) { neg = body[0] === '-'; body = body.slice(1); }
      const n = parseNumber(body);
      if (n !== null) return neg ? -n : n;
      const key = body.toUpperCase();
      let v;
      if (key in labels) v = labels[key];
      else if (key in consts) {
        if (resolving.has(key)) throw new AsmError(ln, `"${body}" refers to itself`);
        resolving.add(key); v = value(consts[key].expr, consts[key].line); resolving.delete(key);
      } else throw new AsmError(ln, `unknown name "${body}"`);
      return neg ? -v : v;
    }
    function reg(tok, ln) {
      const m = /^r([0-7])$/i.exec((tok || '').trim());
      if (!m) throw new AsmError(ln, `expected a register r0-r7, got "${tok || ''}"`);
      return +m[1];
    }
    function mem(tok, ln) {
      const m = /^\[\s*(r[0-7])\s*\]$/i.exec((tok || '').trim());
      if (!m) throw new AsmError(ln, `expected [rN], got "${tok || ''}"`);
      return reg(m[1], ln);
    }

    const memory = new Uint16Array(65536);
    const lineOf = new Int32Array(65536).fill(-1);
    for (const it of items) {
      if (it.data) {
        it.data.forEach((d, k) => { memory[it.addr + k] = u16(value(d, it.line)); lineOf[it.addr + k] = it.line; });
        continue;
      }
      const shape = OPS[OPCODE[it.op]][1];
      const want = shape.length;
      if (it.args.length !== want) throw new AsmError(it.line, `${it.op} takes ${want} operand${want === 1 ? '' : 's'}, got ${it.args.length}`);
      let rd = 0, rs = 0, rt = 0, imm = null;
      [...shape].forEach((kind, k) => {
        const a = it.args[k];
        if (kind === 'd') rd = (it.op === 'ST') ? mem(a, it.line) : reg(a, it.line);
        else if (kind === 's') rs = (it.op === 'LD') ? mem(a, it.line) : reg(a, it.line);
        else if (kind === 't') rt = reg(a, it.line);
        else imm = value(a, it.line);
      });
      if (imm !== null && (imm < -32768 || imm > 65535)) throw new AsmError(it.line, `${imm} does not fit in 16 bits`);
      memory[it.addr] = (OPCODE[it.op] << 10) | (rd << 7) | (rs << 4) | (rt << 1);
      lineOf[it.addr] = it.line;
      if (imm !== null) { memory[it.addr + 1] = u16(imm); lineOf[it.addr + 1] = it.line; }
    }
    const size = items.reduce((mx, it) => Math.max(mx, it.addr + (it.data ? it.data.length : OPS[OPCODE[it.op]][1].includes('i') ? 2 : 1)), 0);
    return { memory, lineOf, labels, size, entry: 0 };
  }

  /* ---------------- disassembler ---------------- */
  function disasm(memory, addr) {
    const w = memory[addr];
    const opc = w >> 10;
    if (opc >= OPS.length) return { text: `DW 0x${w.toString(16).padStart(4, '0')}`, len: 1 };
    const [name, shape] = OPS[opc];
    const rd = (w >> 7) & 7, rs = (w >> 4) & 7, rt = (w >> 1) & 7;
    const imm = memory[(addr + 1) & 0xffff];
    const parts = [...shape].map((k) => {
      if (k === 'd') return name === 'ST' ? `[r${rd}]` : `r${rd}`;
      if (k === 's') return name === 'LD' ? `[r${rs}]` : `r${rs}`;
      if (k === 't') return `r${rt}`;
      return '0x' + imm.toString(16).padStart(4, '0');
    });
    return { text: (name + ' ' + parts.join(', ')).trim(), len: shape.includes('i') ? 2 : 1 };
  }

  /* ---------------- CPU ---------------- */
  class CPU {
    constructor() { this.mem = new Uint16Array(65536); this.r = new Uint16Array(8); this.reset(); }
    load(program) {
      this.mem.set(program.memory);
      this.reset();
      this.pc = program.entry;
    }
    reset() {
      this.r.fill(0);
      this.pc = 0; this.sp = STACK_TOP; this.halted = false; this.cycles = 0;
      this.key = 0; this.fault = null; this.mem.fill(0, SCREEN);
      this.seed = 0x2545f491;
    }
    rand() { // xorshift32
      let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed & 0xffff;
    }
    // Runs up to `budget` instructions. Stops early on FRAME, HLT or a fault.
    // Returns 'frame' | 'halt' | 'budget' | 'fault'.
    run(budget) {
      const m = this.mem, r = this.r;
      while (budget-- > 0) {
        if (this.halted) return 'halt';
        const pc = this.pc, w = m[pc];
        const opc = w >> 10, rd = (w >> 7) & 7, rs = (w >> 4) & 7, rt = (w >> 1) & 7;
        const imm = m[(pc + 1) & 0xffff];
        this.pc = (pc + 1) & 0xffff;
        this.cycles++;
        switch (opc) {
          case 0: this.halted = true; this.pc = pc; return 'halt';
          case 1: r[rd] = imm; this.pc = (pc + 2) & 0xffff; break;
          case 2: r[rd] = r[rs]; break;
          case 3: r[rd] = r[rs] + r[rt]; break;
          case 4: r[rd] = r[rs] - r[rt]; break;
          case 5: r[rd] = Math.imul(r[rs], r[rt]); break;
          case 6: r[rd] = r[rt] ? (r[rs] / r[rt]) | 0 : 0; break;
          case 7: r[rd] = r[rt] ? r[rs] % r[rt] : 0; break;
          case 8: r[rd] = r[rs] & r[rt]; break;
          case 9: r[rd] = r[rs] | r[rt]; break;
          case 10: r[rd] = r[rs] ^ r[rt]; break;
          case 11: r[rd] = r[rs] << (r[rt] & 15); break;
          case 12: r[rd] = r[rs] >>> (r[rt] & 15); break;
          case 13: r[rd] = s16(r[rs]) >> (r[rt] & 15); break;
          case 14: r[rd] = r[rs] + imm; this.pc = (pc + 2) & 0xffff; break;
          case 15: r[rd] = m[r[rs]]; break;
          case 16: m[r[rd]] = r[rs]; break;
          case 17: this.pc = imm; break;
          case 18: this.pc = r[rs] === 0 ? imm : (pc + 2) & 0xffff; break;
          case 19: this.pc = r[rs] !== 0 ? imm : (pc + 2) & 0xffff; break;
          case 20: this.pc = s16(r[rs]) < s16(r[rt]) ? imm : (pc + 2) & 0xffff; break;
          case 21: this.pc = s16(r[rs]) >= s16(r[rt]) ? imm : (pc + 2) & 0xffff; break;
          case 22: this.pc = r[rs] === r[rt] ? imm : (pc + 2) & 0xffff; break;
          case 23: this.pc = r[rs] !== r[rt] ? imm : (pc + 2) & 0xffff; break;
          case 24:
            m[this.sp] = (pc + 2) & 0xffff; this.sp = (this.sp - 1) & 0xffff; this.pc = imm;
            if (this.sp < STACK_TOP - 4096) return this.trap('stack overflow');
            break;
          case 25:
            if (this.sp >= STACK_TOP) return this.trap('RET with an empty stack');
            this.sp = (this.sp + 1) & 0xffff; this.pc = m[this.sp]; break;
          case 26:
            m[this.sp] = r[rs]; this.sp = (this.sp - 1) & 0xffff;
            if (this.sp < STACK_TOP - 4096) return this.trap('stack overflow');
            break;
          case 27:
            if (this.sp >= STACK_TOP) return this.trap('POP with an empty stack');
            this.sp = (this.sp + 1) & 0xffff; r[rd] = m[this.sp]; break;
          case 28: r[rd] = this.rand(); break;
          case 29: return 'frame';
          case 30: r[rd] = this.key; break;
          case 31: r[rd] = (s16(r[rs]) * s16(r[rt])) >> 8; break;
          case 32: break;
          default: return this.trap(`bad opcode ${opc} at 0x${pc.toString(16)}`, pc);
        }
      }
      return 'budget';
    }
    trap(msg, pc) { this.fault = msg; this.halted = true; if (pc !== undefined) this.pc = pc; return 'fault'; }
  }

  const api = { CPU, assemble, disasm, OPS, SCREEN, STACK_TOP, W, AsmError };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Yantra = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
