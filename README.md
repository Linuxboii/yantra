# Yantra · यन्त्र

**A 16-bit computer that does not exist: its own instruction set, assembler, disassembler and screen.**
Live: **https://yantra.avlokai.com**

Yantra is a fantasy machine designed from scratch: eight registers, 64K words of memory, a 64×64
memory-mapped display and 33 instructions. The page includes an assembler with labels, constants and
expressions; a disassembler that follows the program counter; a step debugger; and four programs, including a
fixed-point Mandelbrot renderer and a complete game of Snake in 236 words of machine code.

---

## What it does

- **Editor** with line numbers, assembly errors marked on the exact line, Tab to indent, and Ctrl/Cmd+Enter
  to run.
- **Machine panel**: the 64×64 screen (16-colour palette), Run/Pause, single Step, Reset, and a speed control
  from 200 to 4,000,000 instructions per frame.
- **Live state**: all eight registers in hex and signed decimal (changed ones highlighted when paused), the
  cycle count, instructions per second, PC, SP, and the last key.
- **Disassembly around PC**, decoded from memory rather than from the source.
- **Programs**: Rings (animated distance field), Mandelbrot (8.8 fixed point, then palette cycling), Snake
  (arrow keys, WASD or swipe) and a blank page that remembers your code.
- **Instruction set reference** built into the page.

## The machine

| Part | Spec |
| --- | --- |
| Registers | r0–r7, 16-bit |
| Memory | 65,536 × 16-bit words |
| Screen | 0xF000–0xFFFF, 64 × 64 words, low 4 bits = colour |
| Stack | grows down from 0xEFFF, overflow trapped after 4,096 entries |
| Input | `KEY rd` reads the last direction (1 ↑, 2 →, 3 ↓, 4 ←) |
| Timing | `FRAME` ends the current frame; the host shows the screen and resumes |

### Encoding

One word per instruction, plus one immediate word when the instruction carries one:

```
15      10 9    7 6    4 3    1 0
[ opcode ][  rd  ][  rs  ][  rt  ][-]        (+ imm16)
```

### Instructions

`HLT LDI MOV ADD SUB MUL DIV MOD AND OR XOR SHL SHR SAR ADDI LD ST JMP JZ JNZ JLT JGE JEQ JNE CALL RET PUSH
POP RND FRAME KEY FMUL NOP`

Comparisons are signed. Division and modulo by zero give 0 rather than trapping. `RND` is a 32-bit xorshift.
**`FMUL rd, rs, rt`** computes (rs × rt) >> 8 on signed values, a single-instruction 8.8 fixed-point multiply,
which is what lets the Mandelbrot demo run without floating point.

### Assembler

Two passes. The first assigns addresses, collects labels (`name:`) and constants (`NAME = value`), and
supports `.org` and `DW` data words. The second resolves operands, which can be decimal, `0x` hex, `0b`
binary, character literals, names, or small `a+b` / `a-b` expressions. Errors carry line numbers
("line 12: JLT takes 3 operands, got 2"). Names are case-insensitive, and a label colliding with a constant
is reported rather than silently shadowed.

## The demo programs

- **Rings** — colour = ((dx² + dy²) >> 4 − t) mod 15 + 1 for every pixel each frame: about 75,000
  instructions per frame.
- **Mandelbrot** — c spans −2.0…0.46 by −1.25…1.21 in steps of 10/256. Iteration uses `FMUL` for zx², zy²
  and zx·zy, escaping when zx² + zy² ≥ 4.0 (1024 in 8.8). Values are bounded before the escape test so
  nothing overflows 16 bits. Iteration counts go to a buffer at 0x8000, then the second phase cycles the
  palette forever.
- **Snake** — the body is a ring buffer of positions at 0x9000; the screen doubles as the collision map. The
  tail is erased *before* the collision test, so moving into the cell the tail just left is legal. Reversing
  is blocked against the last direction actually moved, not the last key pressed. Food spawns on random
  empty cells.

## How it was built

- **`core.js`** — CPU, assembler and disassembler in one dependency-free file that runs in the browser and in
  Node. The CPU's `run(budget)` executes until `FRAME`, `HLT`, a fault or the budget runs out, using typed
  arrays and a single `switch`.
- **`demos.js`** — the four programs as assembly source.
- **`index.html`** — editor, gutter, screen (`putImageData` on a 64×64 canvas scaled with pixelated
  rendering), registers, disassembly and the run loop on `requestAnimationFrame`.

## Verification

```bash
node test.cjs
```

- Assembler: constants, expressions, negative immediates, error messages, disassembly round-trip.
- `FMUL`: −2.0 × 1.5 = −3.0 in 8.8.
- Every demo assembles and runs for dozens of frames without faulting.
- Mandelbrot: the point (−0.2, 0) is black (inside the set) and the corner is coloured.
- Snake: a bot steers toward the food for 6,000 frames. The snake grows past length 60, dies and restarts
  cleanly, with no faults.

## Run locally

```bash
python -m http.server 8000   # then http://localhost:8000
```

## Files

```
index.html   the machine's front panel, editor and run loop
core.js      CPU, assembler, disassembler (browser + Node)
demos.js     Rings, Mandelbrot, Snake, blank page
test.cjs     assembler, arithmetic and whole-program tests, including a Snake-playing bot
```

## Name

*Yantra* (यन्त्र) is Sanskrit for an instrument or machine — literally "that which holds".

---

Built by Sushanth Kasturi as one of a set of deliberately useless things. More at
https://sushanth.avlokai.com/projects
