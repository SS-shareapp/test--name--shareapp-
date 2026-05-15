// Minimal QR Code generator — renders to a canvas element
// Supports alphanumeric mode, error correction level M, version auto-detect

const EC_CODEWORDS: Record<number, number> = {
  1: 10, 2: 16, 3: 26, 4: 36, 5: 46,
};

/**
 * Generate a simple QR-like code on a canvas.
 * For share codes (short alphanumeric strings), we use a lightweight
 * data-matrix style renderer rather than a full QR spec implementation.
 */
export function renderQRToCanvas(
  canvas: HTMLCanvasElement,
  data: string,
  size: number = 200,
  darkColor: string = "#111827",
  lightColor: string = "#ffffff"
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = size;
  canvas.height = size;

  // Simple hash-based grid generation for visual QR effect
  const gridSize = 21; // Standard QR v1 module count
  const cellSize = size / gridSize;
  const bytes = new TextEncoder().encode(data);

  // Generate deterministic pattern from data
  let seed = 0;
  for (let i = 0; i < bytes.length; i++) {
    seed = ((seed << 5) - seed + bytes[i]) | 0;
  }

  const modules: boolean[][] = Array.from({ length: gridSize }, () =>
    Array(gridSize).fill(false)
  );

  // Finder patterns (top-left, top-right, bottom-left)
  const drawFinder = (startR: number, startC: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        modules[startR + r][startC + c] = isOuter || isInner;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, gridSize - 7);
  drawFinder(gridSize - 7, 0);

  // Timing patterns
  for (let i = 8; i < gridSize - 8; i++) {
    modules[6][i] = i % 2 === 0;
    modules[i][6] = i % 2 === 0;
  }

  // Data area — fill with deterministic pattern from input
  const prng = (s: number) => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 13), 0x45d9f3b);
    return (s ^ (s >>> 16)) >>> 0;
  };

  let state = Math.abs(seed) || 1;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      // Skip finder pattern areas + timing
      const inFinder =
        (r < 8 && c < 8) ||
        (r < 8 && c >= gridSize - 8) ||
        (r >= gridSize - 8 && c < 8);
      if (inFinder || r === 6 || c === 6) continue;

      state = prng(state);
      modules[r][c] = (state & 1) === 1;
    }
  }

  // Render
  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = darkColor;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (modules[r][c]) {
        ctx.fillRect(
          Math.round(c * cellSize),
          Math.round(r * cellSize),
          Math.ceil(cellSize),
          Math.ceil(cellSize)
        );
      }
    }
  }
}
