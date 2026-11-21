# Yantra · यन्त्र

A 16-bit computer that does not exist. Live at **https://yantra.avlokai.com**.

- Eight 16-bit registers, 64K words of memory, a 64×64 memory-mapped screen at `0xF000`
- 33 instructions, one word each plus an optional immediate (6-bit opcode, three 3-bit register fields)
- A two-pass assembler with labels, constants and `a+b` expressions, line-accurate errors, and a disassembler
- `FMUL` for signed 8.8 fixed point, which is how the Mandelbrot demo runs without floats
- Demos: Rings, Mandelbrot with palette cycling, Snake (arrow keys / WASD / swipe), and a blank page

No build step and no dependencies: `core.js` is the CPU, assembler and disassembler, `demos.js` holds the programs,
`index.html` is the machine.

```
node test.cjs   # assembles every demo, runs them headless, and lets a bot play Snake
```
