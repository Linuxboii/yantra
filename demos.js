/* Programs that ship with Yantra. Plain assembly; the page assembles them. */
(function (root) {
  'use strict';
  const demos = [
    {
      id: 'rings',
      name: 'Rings',
      blurb: 'Distance field, squared and shifted, recoloured every frame.',
      src: `; RINGS — concentric colour bands that flow outward
; colour = ((dx*dx + dy*dy) >> 4 - t) mod 15 + 1

SCREEN = 0xF000

        LDI r6, 0           ; t
frame:  LDI r1, 0           ; y
row:    LDI r0, 0           ; x
col:    ADDI r2, r0, -32    ; dx
        ADDI r3, r1, -32    ; dy
        MUL r2, r2, r2
        MUL r3, r3, r3
        ADD r2, r2, r3
        LDI r4, 4
        SHR r2, r2, r4
        SUB r2, r2, r6      ; minus t: bands move outward
        LDI r4, 0x7FFF
        AND r2, r2, r4      ; keep it positive
        LDI r4, 15
        MOD r2, r2, r4
        ADDI r2, r2, 1
        LDI r4, 6
        SHL r3, r1, r4      ; y * 64
        ADD r3, r3, r0
        ADDI r3, r3, SCREEN
        ST [r3], r2
        ADDI r0, r0, 1
        LDI r4, 64
        JLT r0, r4, col
        ADDI r1, r1, 1
        JLT r1, r4, row
        FRAME
        ADDI r6, r6, 1
        JMP frame
`,
    },
    {
      id: 'mandel',
      name: 'Mandelbrot',
      blurb: 'Fixed-point 8.8 arithmetic, then palette cycling forever.',
      src: `; MANDELBROT in 8.8 fixed point (256 = 1.0)
; FMUL rd, rs, rt  computes (rs * rt) >> 8, signed.
; pass 1 renders a row per frame into BUF and the screen,
; pass 2 cycles the colours of the stored iteration counts.

SCREEN = 0xF000
BUF    = 0x8000
CX     = 0x7F00
CY     = 0x7F01
MAXIT  = 24
STEP   = 10             ; 10/256 = 0.039 per pixel

        LDI r1, 0               ; py
py:     LDI r0, 0               ; px
px:     PUSH r0
        PUSH r1
        LDI r7, STEP
        MUL r2, r0, r7
        ADDI r2, r2, -512       ; cx from -2.0
        LDI r3, CX
        ST [r3], r2
        MUL r2, r1, r7
        ADDI r2, r2, -320       ; cy from -1.25
        LDI r3, CY
        ST [r3], r2
        LDI r4, 0               ; zx
        LDI r5, 0               ; zy
        LDI r6, 0               ; i
iter:   FMUL r0, r4, r4         ; zx^2
        FMUL r1, r5, r5         ; zy^2
        ADD r2, r0, r1
        LDI r3, 1024            ; |z|^2 >= 4.0 escapes
        JGE r2, r3, out
        FMUL r5, r4, r5
        ADD r5, r5, r5          ; 2 zx zy
        LDI r3, CY
        LD r2, [r3]
        ADD r5, r5, r2
        SUB r4, r0, r1          ; zx^2 - zy^2
        LDI r3, CX
        LD r2, [r3]
        ADD r4, r4, r2
        ADDI r6, r6, 1
        LDI r3, MAXIT
        JLT r6, r3, iter
out:    POP r1
        POP r0
        LDI r3, 6
        SHL r2, r1, r3
        ADD r2, r2, r0          ; index
        ADDI r3, r2, BUF
        ST [r3], r6
        CALL shade              ; r6 -> r7 colour, t = 0
        ADDI r3, r2, SCREEN
        ST [r3], r7
        ADDI r0, r0, 1
        LDI r3, 64
        JLT r0, r3, px
        FRAME
        ADDI r1, r1, 1
        JLT r1, r3, py

; ---- pass 2: cycle ----
        LDI r5, 0               ; t
cycle:  LDI r2, 0
        LDI r4, 4096
cell:   ADDI r3, r2, BUF
        LD r6, [r3]
        ADD r6, r6, r5
        CALL shade
        LD r6, [r3]
        LDI r0, MAXIT
        JNE r6, r0, put
        LDI r7, 0               ; inside the set stays black
put:    ADDI r3, r2, SCREEN
        ST [r3], r7
        ADDI r2, r2, 1
        JLT r2, r4, cell
        FRAME
        FRAME
        ADDI r5, r5, 1
        JMP cycle

; r7 = (r6 mod 15) + 1, or 0 when r6 == MAXIT (first pass only)
shade:  LDI r7, MAXIT
        JEQ r6, r7, black
        LDI r7, 15
        MOD r7, r6, r7
        ADDI r7, r7, 1
        RET
black:  LDI r7, 0
        RET
`,
    },
    {
      id: 'snake',
      name: 'Snake',
      blurb: 'A ring buffer, a wrap-around world, and the arrow keys.',
      src: `; SNAKE — arrow keys or WASD. The screen is the collision map.
; KEY returns the last direction pressed: 1 up, 2 right, 3 down, 4 left.

SCREEN  = 0xF000
BODY    = 0x9000        ; ring buffer of positions (y*64 + x)
VARS    = 0x7F10
DIR     = VARS+0        ; wanted direction
HEAD    = VARS+1        ; ring index of the head
LEN     = VARS+2
FOOD    = VARS+3
GROW    = VARS+4        ; segments still to add
MOVED   = VARS+5        ; direction of the last real step
SPEED   = 4             ; frames per step
C_BODY  = 11
C_HEAD  = 12
C_FOOD  = 6

start:  LDI r0, 0
        LDI r1, 4096
        LDI r2, 0
clear:  ADDI r3, r0, SCREEN
        ST [r3], r2
        ADDI r0, r0, 1
        JLT r0, r1, clear
        LDI r0, 2
        LDI r7, DIR
        ST [r7], r0
        LDI r7, MOVED
        ST [r7], r0
        LDI r0, 0
        LDI r7, HEAD
        ST [r7], r0
        LDI r0, 1
        LDI r7, LEN
        ST [r7], r0
        LDI r0, 4
        LDI r7, GROW
        ST [r7], r0
        LDI r0, 2080            ; (32, 32)
        LDI r1, BODY
        ST [r1], r0
        ADDI r1, r0, SCREEN
        LDI r2, C_HEAD
        ST [r1], r2
        CALL spawn

tick:   LDI r5, SPEED
wait:   FRAME
        KEY r0
        JZ r0, idle
        LDI r7, MOVED
        LD r1, [r7]
        SUB r2, r0, r1
        LDI r3, 2
        JEQ r2, r3, idle        ; no reversing into yourself
        LDI r3, -2
        JEQ r2, r3, idle
        LDI r7, DIR
        ST [r7], r0
idle:   ADDI r5, r5, -1
        JNZ r5, wait

        LDI r7, DIR
        LD r0, [r7]
        LDI r7, MOVED
        ST [r7], r0
        LDI r7, HEAD
        LD r1, [r7]             ; r1 = head index
        ADDI r2, r1, BODY
        LD r2, [r2]             ; r2 = head position
        LDI r3, 63
        AND r3, r2, r3          ; x
        LDI r4, 6
        SHR r4, r2, r4          ; y
        LDI r5, 1
        JNE r0, r5, notup
        ADDI r4, r4, -1
        JMP wrap
notup:  LDI r5, 2
        JNE r0, r5, notrt
        ADDI r3, r3, 1
        JMP wrap
notrt:  LDI r5, 3
        JNE r0, r5, notdn
        ADDI r4, r4, 1
        JMP wrap
notdn:  ADDI r3, r3, -1
wrap:   LDI r5, 63
        AND r3, r3, r5
        AND r4, r4, r5
        LDI r5, 6
        SHL r4, r4, r5
        ADD r2, r4, r3          ; r2 = new head position

        ADDI r3, r1, BODY       ; old head becomes body
        LD r3, [r3]
        ADDI r3, r3, SCREEN
        LDI r4, C_BODY
        ST [r3], r4

        LDI r7, GROW
        LD r3, [r7]
        JZ r3, trim
        ADDI r3, r3, -1
        ST [r7], r3
        LDI r7, LEN
        LD r3, [r7]
        ADDI r3, r3, 1
        ST [r7], r3
        JMP step
trim:   LDI r7, LEN             ; erase the tail before testing collisions
        LD r3, [r7]
        SUB r4, r1, r3
        ADDI r4, r4, 1
        LDI r5, 4095
        AND r4, r4, r5
        ADDI r4, r4, BODY
        LD r4, [r4]
        ADDI r4, r4, SCREEN
        LDI r5, 0
        ST [r4], r5

step:   ADDI r3, r2, SCREEN
        LD r4, [r3]
        LDI r5, C_BODY
        JEQ r4, r5, dead
        LDI r0, 0               ; r0 = ate?
        LDI r7, FOOD
        LD r5, [r7]
        JNE r2, r5, place
        LDI r0, 1
        LDI r7, GROW
        LD r5, [r7]
        ADDI r5, r5, 3
        ST [r7], r5
place:  ADDI r1, r1, 1
        LDI r5, 4095
        AND r1, r1, r5
        LDI r7, HEAD
        ST [r7], r1
        ADDI r6, r1, BODY
        ST [r6], r2
        LDI r5, C_HEAD
        ST [r3], r5
        JZ r0, tick
        CALL spawn
        JMP tick

dead:   LDI r5, C_FOOD
        ST [r3], r5
        LDI r5, 45
pause:  FRAME
        ADDI r5, r5, -1
        JNZ r5, pause
        JMP start

; drop food on a random empty cell
spawn:  RND r0
        LDI r1, 4095
        AND r0, r0, r1
        ADDI r1, r0, SCREEN
        LD r2, [r1]
        JNZ r2, spawn
        LDI r2, C_FOOD
        ST [r1], r2
        LDI r1, FOOD
        ST [r1], r0
        RET
`,
    },
    {
      id: 'hello',
      name: 'Blank page',
      blurb: 'The smallest useful program. Start here.',
      src: `; Your program. Edit, then press Run (or Ctrl+Enter).
; Screen: 64x64 words at 0xF000, value = colour 0-15.
; Address of (x, y) is 0xF000 + y*64 + x.

SCREEN = 0xF000

        LDI r0, 0           ; i
        LDI r1, 64
loop:   LDI r2, 65          ; 65 = one row down, one column right
        MUL r2, r0, r2
        ADDI r2, r2, SCREEN
        LDI r3, 15
        MOD r3, r0, r3
        ADDI r3, r3, 1
        ST [r2], r3         ; a diagonal, one colour per pixel
        ADDI r0, r0, 1
        FRAME               ; draw slowly so you can watch it
        JLT r0, r1, loop
        HLT
`,
    },
  ];
  if (typeof module === 'object' && module.exports) module.exports = demos;
  else root.YantraDemos = demos;
})(typeof globalThis !== 'undefined' ? globalThis : this);
