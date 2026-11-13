(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TrainingQR = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // ISO/IEC 18004 Table 9 — Level L (~7%) error correction codewords & block counts (v1..v40)
  const L_ECC_CODEWORDS_PER_BLOCK = Object.freeze([
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28,
    28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ]);
  const L_NUM_ERROR_CORRECTION_BLOCKS = Object.freeze([
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7,
    8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ]);
  const L_FORMAT_BITS = 1;

  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_EXP[i + 255] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    GF_EXP[510] = GF_EXP[0];
  })();

  const gfMul = (x, y) => (x === 0 || y === 0 ? 0 : GF_EXP[GF_LOG[x] + GF_LOG[y]]);
  const divisorCache = new Map();

  function getReedSolomonDivisor(degree) {
    if (divisorCache.has(degree)) return divisorCache.get(degree);
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    divisorCache.set(degree, result);
    return result;
  }

  function computeReedSolomonRemainder(data, degree) {
    const divisor = getReedSolomonDivisor(degree);
    const rem = new Uint8Array(degree);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      rem.copyWithin(0, 1);
      rem[degree - 1] = 0;
      if (factor !== 0) {
        for (let j = 0; j < degree; j++) rem[j] ^= gfMul(divisor[j], factor);
      }
    }
    return rem;
  }

  function getAlignmentPatternPositions(version) {
    if (version === 1) return [];
    const numAlign = Math.floor(version / 7) + 2;
    const size = version * 4 + 17;
    const step = version === 32 ? 26 : Math.ceil((size - 13) / ((numAlign - 1) * 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function getNumRawDataModules(version) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function getNumDataCodewords(version) {
    const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
    return rawCodewords - L_ECC_CODEWORDS_PER_BLOCK[version] * L_NUM_ERROR_CORRECTION_BLOCKS[version];
  }

  const charCountBitsForByteMode = (version) => (version <= 9 ? 8 : 16);

  function appendBits(val, numBits, bitList) {
    for (let i = numBits - 1; i >= 0; i--) bitList.push((val >>> i) & 1);
  }

  function buildDataCodewords(payloadBytes, version) {
    const capacityCodewords = getNumDataCodewords(version);
    const capacityBits = capacityCodewords * 8;
    const bits = [];

    appendBits(0x4, 4, bits);
    appendBits(payloadBytes.length, charCountBitsForByteMode(version), bits);
    for (let i = 0; i < payloadBytes.length; i++) appendBits(payloadBytes[i], 8, bits);

    appendBits(0, Math.min(4, capacityBits - bits.length), bits);
    appendBits(0, (8 - (bits.length % 8)) % 8, bits);

    let padByteIdx = 0;
    while (bits.length < capacityBits) {
      appendBits(padByteIdx % 2 === 0 ? 0xec : 0x11, 8, bits);
      padByteIdx += 1;
    }

    const dataCw = new Uint8Array(capacityCodewords);
    for (let b = 0; b < bits.length; b++) dataCw[b >>> 3] |= bits[b] << (7 - (b & 7));
    return dataCw;
  }

  function addEccAndInterleave(dataCodewords, version) {
    const numBlocks = L_NUM_ERROR_CORRECTION_BLOCKS[version];
    const blockEccLen = L_ECC_CODEWORDS_PER_BLOCK[version];
    const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortDataLen = Math.floor(rawCodewords / numBlocks) - blockEccLen;

    const blocks = [];
    let offset = 0;
    for (let i = 0; i < numBlocks; i++) {
      const datLen = shortDataLen + (i < numShortBlocks ? 0 : 1);
      const dat = dataCodewords.subarray(offset, offset + datLen);
      offset += datLen;
      blocks.push({ data: dat, ecc: computeReedSolomonRemainder(dat, blockEccLen) });
    }

    const result = new Uint8Array(rawCodewords);
    let outIdx = 0;
    for (let col = 0; col <= shortDataLen; col++) {
      for (let b = 0; b < numBlocks; b++) {
        if (col < blocks[b].data.length) result[outIdx++] = blocks[b].data[col];
      }
    }
    for (let ecol = 0; ecol < blockEccLen; ecol++) {
      for (let eb = 0; eb < numBlocks; eb++) result[outIdx++] = blocks[eb].ecc[ecol];
    }
    return result;
  }

  function createEmptyGrid(size) {
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
    return { modules, isFunction };
  }

  function setFunctionModule(grid, x, y, isDark) {
    grid.modules[y][x] = Boolean(isDark);
    grid.isFunction[y][x] = true;
  }

  function drawFinderPattern(grid, size, cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunctionModule(grid, xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  function drawAlignmentPattern(grid, cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFunctionModule(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawFormatBits(grid, size, mask) {
    const data = (L_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let b0 = 0; b0 <= 5; b0++) setFunctionModule(grid, 8, b0, ((bits >>> b0) & 1) !== 0);
    setFunctionModule(grid, 8, 7, ((bits >>> 6) & 1) !== 0);
    setFunctionModule(grid, 8, 8, ((bits >>> 7) & 1) !== 0);
    setFunctionModule(grid, 7, 8, ((bits >>> 8) & 1) !== 0);
    for (let b1 = 9; b1 < 15; b1++) setFunctionModule(grid, 14 - b1, 8, ((bits >>> b1) & 1) !== 0);

    for (let b2 = 0; b2 < 8; b2++) setFunctionModule(grid, size - 1 - b2, 8, ((bits >>> b2) & 1) !== 0);
    for (let b3 = 8; b3 < 15; b3++) setFunctionModule(grid, 8, size - 15 + b3, ((bits >>> b3) & 1) !== 0);
    setFunctionModule(grid, 8, size - 8, true);
  }

  function drawVersionBits(grid, size, version) {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let b = 0; b < 18; b++) {
      const isDark = ((bits >>> b) & 1) !== 0;
      const a = size - 11 + (b % 3), c = Math.floor(b / 3);
      setFunctionModule(grid, c, a, isDark);
      setFunctionModule(grid, a, c, isDark);
    }
  }

  function drawFunctionPatterns(grid, version, size) {
    for (let i = 0; i < size; i++) {
      setFunctionModule(grid, 6, i, i % 2 === 0);
      setFunctionModule(grid, i, 6, i % 2 === 0);
    }
    drawFinderPattern(grid, size, 3, 3);
    drawFinderPattern(grid, size, size - 4, 3);
    drawFinderPattern(grid, size, 3, size - 4);

    const alignPos = getAlignmentPatternPositions(version);
    const numAlign = alignPos.length;
    for (let ai = 0; ai < numAlign; ai++) {
      for (let aj = 0; aj < numAlign; aj++) {
        const isCorner =
          (ai === 0 && aj === 0) || (ai === 0 && aj === numAlign - 1) || (ai === numAlign - 1 && aj === 0);
        if (!isCorner) drawAlignmentPattern(grid, alignPos[ai], alignPos[aj]);
      }
    }
    drawFormatBits(grid, size, 0);
    drawVersionBits(grid, size, version);
  }

  function drawCodewords(grid, size, allCodewords) {
    let bitIdx = 0;
    const totalBits = allCodewords.length * 8;
    let upward = true;

    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (!grid.isFunction[y][x]) {
            let dark = false;
            if (bitIdx < totalBits) {
              dark = ((allCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
              bitIdx += 1;
            }
            grid.modules[y][x] = dark;
          }
        }
      }
      upward = !upward;
    }
  }

  function maskCondition(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function applyMaskInPlace(grid, size, mask) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!grid.isFunction[y][x] && maskCondition(mask, x, y)) {
          grid.modules[y][x] = !grid.modules[y][x];
        }
      }
    }
  }

  function finderPenaltyCountPatterns(runHistory) {
    const n = runHistory[1];
    const core =
      n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
    return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
      (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
  }

  function finderPenaltyAddHistory(currentRunLength, runHistory, size) {
    if (runHistory[0] === 0) currentRunLength += size;
    runHistory.copyWithin(1, 0, 6);
    runHistory[0] = currentRunLength;
  }

  function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory, size) {
    if (currentRunColor) {
      finderPenaltyAddHistory(currentRunLength, runHistory, size);
      currentRunLength = 0;
    }
    currentRunLength += size;
    finderPenaltyAddHistory(currentRunLength, runHistory, size);
    return finderPenaltyCountPatterns(runHistory);
  }

  function computePenaltyScore(modules, size) {
    let score = 0;
    const runHistory = new Int32Array(7);

    for (let y = 0; y < size; y++) {
      let runColor = false, runX = 0;
      runHistory.fill(0);
      for (let x = 0; x < size; x++) {
        if (modules[y][x] === runColor) {
          runX += 1;
          if (runX === 5) score += 3;
          else if (runX > 5) score += 1;
        } else {
          finderPenaltyAddHistory(runX, runHistory, size);
          if (!runColor) score += finderPenaltyCountPatterns(runHistory) * 40;
          runColor = modules[y][x];
          runX = 1;
        }
      }
      score += finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * 40;
    }

    for (let cx = 0; cx < size; cx++) {
      let colColor = false, runY = 0;
      runHistory.fill(0);
      for (let cy = 0; cy < size; cy++) {
        if (modules[cy][cx] === colColor) {
          runY += 1;
          if (runY === 5) score += 3;
          else if (runY > 5) score += 1;
        } else {
          finderPenaltyAddHistory(runY, runHistory, size);
          if (!colColor) score += finderPenaltyCountPatterns(runHistory) * 40;
          colColor = modules[cy][cx];
          runY = 1;
        }
      }
      score += finderPenaltyTerminateAndCount(colColor, runY, runHistory, size) * 40;
    }

    for (let by = 0; by < size - 1; by++) {
      for (let bx = 0; bx < size - 1; bx++) {
        const c = modules[by][bx];
        if (c === modules[by][bx + 1] && c === modules[by + 1][bx] && c === modules[by + 1][bx + 1]) score += 3;
      }
    }

    let darkCount = 0;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) if (modules[dy][dx]) darkCount += 1;
    }
    const total = size * size;
    const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
    if (k > 0) score += k * 10;
    return score;
  }

  function selectVersion(payloadLen) {
    for (let v = 1; v <= 40; v++) {
      if (4 + charCountBitsForByteMode(v) + payloadLen * 8 <= getNumDataCodewords(v) * 8) return v;
    }
    throw new Error(`Payload of ${payloadLen} bytes exceeds QR capacity up to Version 40 (L).`);
  }

  function encodeMatrix(text) {
    if (text === null || text === undefined) throw new Error("QR payload text is required.");
    const payloadBytes = new TextEncoder().encode(String(text));
    const version = selectVersion(payloadBytes.length);
    const size = version * 4 + 17;

    const dataCodewords = buildDataCodewords(payloadBytes, version);
    const allCodewords = addEccAndInterleave(dataCodewords, version);

    const grid = createEmptyGrid(size);
    drawFunctionPatterns(grid, version, size);
    drawCodewords(grid, size, allCodewords);

    let chosenMask = 0, minPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMaskInPlace(grid, size, m);
      drawFormatBits(grid, size, m);
      const penalty = computePenaltyScore(grid.modules, size);
      if (penalty < minPenalty) { minPenalty = penalty; chosenMask = m; }
      applyMaskInPlace(grid, size, m);
    }

    applyMaskInPlace(grid, size, chosenMask);
    drawFormatBits(grid, size, chosenMask);
    return { version, size, ecLevel: "L", mask: chosenMask, modules: grid.modules };
  }

  function escapeXmlAttr(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderSvg(text, options) {
    const opts = options || {};
    const rawMargin = opts.margin !== undefined && opts.margin !== null ? Math.trunc(Number(opts.margin)) : 2;
    const margin = Number.isFinite(rawMargin) ? Math.max(0, Math.min(16, rawMargin)) : 2;
    const fg = escapeXmlAttr(opts.fg !== undefined ? opts.fg : "#090d16");
    const bg = escapeXmlAttr(opts.bg !== undefined ? opts.bg : "#f8fafc");

    const { size, modules } = encodeMatrix(text);
    const total = size + margin * 2;
    const pathParts = [];

    for (let y = 0; y < size; y++) {
      const row = modules[y];
      let x = 0;
      while (x < size) {
        if (!row[x]) { x += 1; continue; }
        const runStart = x;
        while (x < size && row[x]) x += 1;
        const runLen = x - runStart;
        pathParts.push(`M${runStart + margin} ${y + margin}h${runLen}v1h-${runLen}z`);
      }
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
      `shape-rendering="crispEdges" role="img" aria-label="QR Code">` +
      `<rect width="100%" height="100%" fill="${bg}"/>` +
      `<path d="${pathParts.join("")}" fill="${fg}"/></svg>`
    );
  }

  return Object.freeze({ encodeMatrix, renderSvg });
});
