(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TrainingQR = api;
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
  function () {
    "use strict";

    // ISO/IEC 18004 Table 9: Error correction codewords per block (Versions 1..40)
    var ECC_CODEWORDS_PER_BLOCK = Object.freeze({
      L: Object.freeze([
        -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28,
        30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30,
        30, 30, 30, 30, 30,
      ]),
      M: Object.freeze([
        -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28,
        26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
        28, 28, 28, 28, 28,
      ]),
      Q: Object.freeze([
        -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28,
        28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30,
        30, 30, 30, 30, 30,
      ]),
      H: Object.freeze([
        -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28,
        28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
        30, 30, 30, 30, 30,
      ]),
    });

    // ISO/IEC 18004 Table 9: Total number of error correction blocks (Versions 1..40)
    var NUM_ERROR_CORRECTION_BLOCKS = Object.freeze({
      L: Object.freeze([
        -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9,
        9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
      ]),
      M: Object.freeze([
        -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
        17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45,
        47, 49,
      ]),
      Q: Object.freeze([
        -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21,
        20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59,
        62, 65, 68,
      ]),
      H: Object.freeze([
        -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25,
        25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70,
        74, 77, 81,
      ]),
    });

    // 2-bit format indicator per EC level (ISO/IEC 18004 Table 25)
    var EC_FORMAT_BITS = Object.freeze({
      L: 1, // 01
      M: 0, // 00
      Q: 3, // 11
      H: 2, // 10
    });

    // Precompute GF(256) exp/log tables for x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
    var GF_EXP = new Uint8Array(512);
    var GF_LOG = new Uint8Array(256);
    (function initGfTables() {
      var x = 1;
      for (var i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_EXP[i + 255] = x;
        GF_LOG[x] = i;
        x <<= 1;
        if (x & 0x100) {
          x ^= 0x11d;
        }
      }
      GF_EXP[510] = GF_EXP[0];
    })();

    function gfMul(x, y) {
      if (x === 0 || y === 0) return 0;
      return GF_EXP[GF_LOG[x] + GF_LOG[y]];
    }

    var divisorCache = new Map();

    function getReedSolomonDivisor(degree) {
      if (divisorCache.has(degree)) {
        return divisorCache.get(degree);
      }
      var result = new Uint8Array(degree);
      result[degree - 1] = 1;
      var root = 1;
      for (var i = 0; i < degree; i++) {
        for (var j = 0; j < degree; j++) {
          result[j] = gfMul(result[j], root);
          if (j + 1 < degree) {
            result[j] ^= result[j + 1];
          }
        }
        root = gfMul(root, 0x02);
      }
      divisorCache.set(degree, result);
      return result;
    }

    function computeReedSolomonRemainder(data, degree) {
      var divisor = getReedSolomonDivisor(degree);
      var rem = new Uint8Array(degree);
      for (var i = 0; i < data.length; i++) {
        var factor = data[i] ^ rem[0];
        rem.copyWithin(0, 1);
        rem[degree - 1] = 0;
        if (factor !== 0) {
          for (var j = 0; j < degree; j++) {
            rem[j] ^= gfMul(divisor[j], factor);
          }
        }
      }
      return rem;
    }

    function utf8Bytes(text) {
      var str = String(text);
      if (typeof TextEncoder === "function") {
        return new TextEncoder().encode(str);
      }
      var out = [];
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 0x80) {
          out.push(c);
        } else if (c < 0x800) {
          out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
          var next = str.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            var cp = ((c - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
            out.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 0x3f),
              0x80 | ((cp >> 6) & 0x3f),
              0x80 | (cp & 0x3f)
            );
            i += 1;
          }
        } else {
          out.push(
            0xe0 | (c >> 12),
            0x80 | ((c >> 6) & 0x3f),
            0x80 | (c & 0x3f)
          );
        }
      }
      return new Uint8Array(out);
    }

    function getAlignmentPatternPositions(version) {
      if (version === 1) return [];
      var numAlign = Math.floor(version / 7) + 2;
      var size = version * 4 + 17;
      var step =
        version === 32
          ? 26
          : Math.ceil((size - 13) / ((numAlign - 1) * 2)) * 2;
      var result = [6];
      for (var pos = size - 7; result.length < numAlign; pos -= step) {
        result.splice(1, 0, pos);
      }
      return result;
    }

    function getNumRawDataModules(version) {
      var result = (16 * version + 128) * version + 64;
      if (version >= 2) {
        var numAlign = Math.floor(version / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (version >= 7) {
          result -= 36;
        }
      }
      return result;
    }

    function getNumDataCodewords(version, ecLevel) {
      var rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
      var eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ecLevel][version];
      var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecLevel][version];
      return rawCodewords - eccPerBlock * numBlocks;
    }

    function charCountBitsForByteMode(version) {
      return version <= 9 ? 8 : 16;
    }

    function appendBits(val, numBits, bitList) {
      for (var i = numBits - 1; i >= 0; i--) {
        bitList.push((val >>> i) & 1);
      }
    }

    function buildDataCodewords(payloadBytes, version, ecLevel) {
      var capacityCodewords = getNumDataCodewords(version, ecLevel);
      var capacityBits = capacityCodewords * 8;
      var ccBits = charCountBitsForByteMode(version);

      var bits = [];
      // Byte mode indicator = 0100 (4)
      appendBits(0x4, 4, bits);
      appendBits(payloadBytes.length, ccBits, bits);
      for (var i = 0; i < payloadBytes.length; i++) {
        appendBits(payloadBytes[i], 8, bits);
      }

      // Terminator (up to 4 zero bits)
      var termLen = Math.min(4, capacityBits - bits.length);
      appendBits(0, termLen, bits);

      // Pad to next byte boundary
      var remBits = (8 - (bits.length % 8)) % 8;
      appendBits(0, remBits, bits);

      // Alternating pad bytes 0xEC, 0x11
      var padByteIdx = 0;
      while (bits.length < capacityBits) {
        appendBits(padByteIdx % 2 === 0 ? 0xec : 0x11, 8, bits);
        padByteIdx += 1;
      }

      var dataCw = new Uint8Array(capacityCodewords);
      for (var b = 0; b < bits.length; b++) {
        dataCw[b >>> 3] |= bits[b] << (7 - (b & 7));
      }
      return dataCw;
    }

    function addEccAndInterleave(dataCodewords, version, ecLevel) {
      var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecLevel][version];
      var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecLevel][version];
      var rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
      var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
      var shortBlockLen = Math.floor(rawCodewords / numBlocks);
      var shortDataLen = shortBlockLen - blockEccLen;

      var blocks = [];
      var offset = 0;
      for (var i = 0; i < numBlocks; i++) {
        var datLen = shortDataLen + (i < numShortBlocks ? 0 : 1);
        var dat = dataCodewords.subarray(offset, offset + datLen);
        offset += datLen;
        var ecc = computeReedSolomonRemainder(dat, blockEccLen);
        blocks.push({ data: dat, ecc: ecc });
      }

      var result = new Uint8Array(rawCodewords);
      var outIdx = 0;
      var maxDataLen = shortDataLen + 1;
      for (var col = 0; col < maxDataLen; col++) {
        for (var b = 0; b < numBlocks; b++) {
          if (col < blocks[b].data.length) {
            result[outIdx++] = blocks[b].data[col];
          }
        }
      }
      for (var ecol = 0; ecol < blockEccLen; ecol++) {
        for (var eb = 0; eb < numBlocks; eb++) {
          result[outIdx++] = blocks[eb].ecc[ecol];
        }
      }
      return result;
    }

    function createEmptyGrid(size) {
      var modules = new Array(size);
      var isFunction = new Array(size);
      for (var y = 0; y < size; y++) {
        modules[y] = new Array(size).fill(false);
        isFunction[y] = new Array(size).fill(false);
      }
      return { modules: modules, isFunction: isFunction };
    }

    function setFunctionModule(grid, x, y, isDark) {
      grid.modules[y][x] = Boolean(isDark);
      grid.isFunction[y][x] = true;
    }

    function drawFinderPattern(grid, size, cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var xx = cx + dx;
          var yy = cy + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
            var dist = Math.max(Math.abs(dx), Math.abs(dy));
            setFunctionModule(grid, xx, yy, dist !== 2 && dist !== 4);
          }
        }
      }
    }

    function drawAlignmentPattern(grid, cx, cy) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunctionModule(grid, cx + dx, cy + dy, dist !== 1);
        }
      }
    }

    function drawFormatBits(grid, size, ecLevel, mask) {
      var data = (EC_FORMAT_BITS[ecLevel] << 3) | mask;
      var rem = data;
      for (var i = 0; i < 10; i++) {
        rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      }
      var bits = ((data << 10) | rem) ^ 0x5412;

      // First copy around top-left finder
      for (var b0 = 0; b0 <= 5; b0++) {
        setFunctionModule(grid, 8, b0, ((bits >>> b0) & 1) !== 0);
      }
      setFunctionModule(grid, 8, 7, ((bits >>> 6) & 1) !== 0);
      setFunctionModule(grid, 8, 8, ((bits >>> 7) & 1) !== 0);
      setFunctionModule(grid, 7, 8, ((bits >>> 8) & 1) !== 0);
      for (var b1 = 9; b1 < 15; b1++) {
        setFunctionModule(grid, 14 - b1, 8, ((bits >>> b1) & 1) !== 0);
      }

      // Second copy split across top-right and bottom-left finders
      for (var b2 = 0; b2 < 8; b2++) {
        setFunctionModule(
          grid,
          size - 1 - b2,
          8,
          ((bits >>> b2) & 1) !== 0
        );
      }
      for (var b3 = 8; b3 < 15; b3++) {
        setFunctionModule(
          grid,
          8,
          size - 15 + b3,
          ((bits >>> b3) & 1) !== 0
        );
      }
      // Dark module
      setFunctionModule(grid, 8, size - 8, true);
    }

    function drawVersionBits(grid, size, version) {
      if (version < 7) return;
      var rem = version;
      for (var i = 0; i < 12; i++) {
        rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      }
      var bits = (version << 12) | rem;
      for (var b = 0; b < 18; b++) {
        var isDark = ((bits >>> b) & 1) !== 0;
        var a = size - 11 + (b % 3);
        var c = Math.floor(b / 3);
        setFunctionModule(grid, c, a, isDark);
        setFunctionModule(grid, a, c, isDark);
      }
    }

    function drawFunctionPatterns(grid, version, size, ecLevel) {
      for (var i = 0; i < size; i++) {
        setFunctionModule(grid, 6, i, i % 2 === 0);
        setFunctionModule(grid, i, 6, i % 2 === 0);
      }

      drawFinderPattern(grid, size, 3, 3);
      drawFinderPattern(grid, size, size - 4, 3);
      drawFinderPattern(grid, size, 3, size - 4);

      var alignPos = getAlignmentPatternPositions(version);
      var numAlign = alignPos.length;
      for (var ai = 0; ai < numAlign; ai++) {
        for (var aj = 0; aj < numAlign; aj++) {
          var isFinderCorner =
            (ai === 0 && aj === 0) ||
            (ai === 0 && aj === numAlign - 1) ||
            (ai === numAlign - 1 && aj === 0);
          if (!isFinderCorner) {
            drawAlignmentPattern(grid, alignPos[ai], alignPos[aj]);
          }
        }
      }

      // Reserve format & version modules before zigzag codeword placement
      drawFormatBits(grid, size, ecLevel, 0);
      drawVersionBits(grid, size, version);
    }

    function drawCodewords(grid, size, allCodewords) {
      var bitIdx = 0;
      var totalBits = allCodewords.length * 8;
      var upward = true;

      for (var right = size - 1; right >= 1; right -= 2) {
        if (right === 6) {
          right = 5;
        }
        for (var vert = 0; vert < size; vert++) {
          var y = upward ? size - 1 - vert : vert;
          for (var j = 0; j < 2; j++) {
            var x = right - j;
            if (!grid.isFunction[y][x]) {
              var dark = false;
              if (bitIdx < totalBits) {
                dark =
                  ((allCodewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !==
                  0;
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
        case 0:
          return (x + y) % 2 === 0;
        case 1:
          return y % 2 === 0;
        case 2:
          return x % 3 === 0;
        case 3:
          return (x + y) % 3 === 0;
        case 4:
          return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
        case 5:
          return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6:
          return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        case 7:
          return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        default:
          return false;
      }
    }

    function applyMaskInPlace(grid, size, mask) {
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (!grid.isFunction[y][x] && maskCondition(mask, x, y)) {
            grid.modules[y][x] = !grid.modules[y][x];
          }
        }
      }
    }

    function finderPenaltyCountPatterns(runHistory, size) {
      var n = runHistory[1];
      var core =
        n > 0 &&
        runHistory[2] === n &&
        runHistory[3] === n * 3 &&
        runHistory[4] === n &&
        runHistory[5] === n;
      return (
        (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
        (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0) +
        0 * size
      );
    }

    function finderPenaltyTerminateAndCount(
      currentRunColor,
      currentRunLength,
      runHistory,
      size
    ) {
      if (currentRunColor) {
        finderPenaltyAddHistory(currentRunLength, runHistory, size);
        currentRunLength = 0;
      }
      currentRunLength += size;
      finderPenaltyAddHistory(currentRunLength, runHistory, size);
      return finderPenaltyCountPatterns(runHistory, size);
    }

    function finderPenaltyAddHistory(currentRunLength, runHistory, size) {
      if (runHistory[0] === 0) {
        currentRunLength += size;
      }
      runHistory.copyWithin(1, 0, 6);
      runHistory[0] = currentRunLength;
    }

    function computePenaltyScore(modules, size) {
      var score = 0;
      var runHistory = new Int32Array(7);

      // Rule 1 & Rule 3 across rows
      for (var y = 0; y < size; y++) {
        var runColor = false;
        var runX = 0;
        runHistory.fill(0);
        for (var x = 0; x < size; x++) {
          if (modules[y][x] === runColor) {
            runX += 1;
            if (runX === 5) {
              score += 3;
            } else if (runX > 5) {
              score += 1;
            }
          } else {
            finderPenaltyAddHistory(runX, runHistory, size);
            if (!runColor) {
              score += finderPenaltyCountPatterns(runHistory, size) * 40;
            }
            runColor = modules[y][x];
            runX = 1;
          }
        }
        score +=
          finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * 40;
      }

      // Rule 1 & Rule 3 across columns
      for (var cx = 0; cx < size; cx++) {
        var colColor = false;
        var runY = 0;
        runHistory.fill(0);
        for (var cy = 0; cy < size; cy++) {
          if (modules[cy][cx] === colColor) {
            runY += 1;
            if (runY === 5) {
              score += 3;
            } else if (runY > 5) {
              score += 1;
            }
          } else {
            finderPenaltyAddHistory(runY, runHistory, size);
            if (!colColor) {
              score += finderPenaltyCountPatterns(runHistory, size) * 40;
            }
            colColor = modules[cy][cx];
            runY = 1;
          }
        }
        score +=
          finderPenaltyTerminateAndCount(colColor, runY, runHistory, size) * 40;
      }

      // Rule 2: 2x2 blocks of identical color
      for (var by = 0; by < size - 1; by++) {
        for (var bx = 0; bx < size - 1; bx++) {
          var c = modules[by][bx];
          if (
            c === modules[by][bx + 1] &&
            c === modules[by + 1][bx] &&
            c === modules[by + 1][bx + 1]
          ) {
            score += 3;
          }
        }
      }

      // Rule 4: Dark-to-light balance
      var darkCount = 0;
      for (var dy = 0; dy < size; dy++) {
        for (var dx = 0; dx < size; dx++) {
          if (modules[dy][dx]) darkCount += 1;
        }
      }
      var total = size * size;
      var k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
      if (k > 0) {
        score += k * 10;
      }

      return score;
    }

    function selectVersion(payloadLen, ecLevel, minVersion, maxVersion) {
      for (var v = minVersion; v <= maxVersion; v++) {
        var dataCapBits = getNumDataCodewords(v, ecLevel) * 8;
        var neededBits =
          4 + charCountBitsForByteMode(v) + payloadLen * 8;
        if (neededBits <= dataCapBits) {
          return v;
        }
      }
      throw new Error(
        "Payload of " +
          payloadLen +
          " bytes exceeds QR capacity up to Version " +
          maxVersion +
          " (" +
          ecLevel +
          ")."
      );
    }

    function encodeMatrix(text, options) {
      if (text === null || text === undefined) {
        throw new Error("QR payload text is required.");
      }
      var opts = options || {};
      var rawEc = String(opts.ecLevel || opts.level || "L")
        .trim()
        .toUpperCase();
      var ecLevel = EC_FORMAT_BITS[rawEc] !== undefined ? rawEc : "L";

      var minVer =
        opts.minVersion !== undefined
          ? Math.max(1, Math.min(40, Math.trunc(Number(opts.minVersion) || 1)))
          : 1;
      var maxVer =
        opts.maxVersion !== undefined
          ? Math.max(
              minVer,
              Math.min(40, Math.trunc(Number(opts.maxVersion) || 40))
            )
          : 40;

      var payloadBytes = utf8Bytes(text);
      var version = selectVersion(payloadBytes.length, ecLevel, minVer, maxVer);
      var size = version * 4 + 17;

      var dataCodewords = buildDataCodewords(payloadBytes, version, ecLevel);
      var allCodewords = addEccAndInterleave(dataCodewords, version, ecLevel);

      var grid = createEmptyGrid(size);
      drawFunctionPatterns(grid, version, size, ecLevel);
      drawCodewords(grid, size, allCodewords);

      var chosenMask = -1;
      if (
        opts.mask !== undefined &&
        opts.mask !== null &&
        Number.isInteger(opts.mask) &&
        opts.mask >= 0 &&
        opts.mask <= 7
      ) {
        chosenMask = opts.mask;
      }

      if (chosenMask === -1) {
        var minPenalty = Infinity;
        for (var m = 0; m < 8; m++) {
          applyMaskInPlace(grid, size, m);
          drawFormatBits(grid, size, ecLevel, m);
          var penalty = computePenaltyScore(grid.modules, size);
          if (penalty < minPenalty) {
            minPenalty = penalty;
            chosenMask = m;
          }
          // Revert mask m before testing next candidate
          applyMaskInPlace(grid, size, m);
        }
      }

      applyMaskInPlace(grid, size, chosenMask);
      drawFormatBits(grid, size, ecLevel, chosenMask);

      return {
        version: version,
        size: size,
        ecLevel: ecLevel,
        mask: chosenMask,
        modules: grid.modules,
      };
    }

    function escapeXmlAttr(str) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function renderSvg(text, options) {
      var opts = options || {};
      var margin =
        opts.margin !== undefined && opts.margin !== null
          ? Math.max(0, Math.min(16, Math.trunc(Number(opts.margin))))
          : 2;
      if (!Number.isFinite(margin)) {
        margin = 2;
      }
      var fg = escapeXmlAttr(opts.fg !== undefined ? opts.fg : "#090d16");
      var bg = escapeXmlAttr(opts.bg !== undefined ? opts.bg : "#f8fafc");

      var qr = encodeMatrix(text, opts);
      var size = qr.size;
      var total = size + margin * 2;
      var pathParts = [];

      for (var y = 0; y < size; y++) {
        var row = qr.modules[y];
        var x = 0;
        while (x < size) {
          if (!row[x]) {
            x += 1;
            continue;
          }
          var runStart = x;
          while (x < size && row[x]) {
            x += 1;
          }
          var runLen = x - runStart;
          pathParts.push(
            "M" +
              (runStart + margin) +
              " " +
              (y + margin) +
              "h" +
              runLen +
              "v1h-" +
              runLen +
              "z"
          );
        }
      }

      return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
        total +
        " " +
        total +
        '" shape-rendering="crispEdges" role="img" aria-label="QR Code">' +
        '<rect width="100%" height="100%" fill="' +
        bg +
        '"/>' +
        '<path d="' +
        pathParts.join("") +
        '" fill="' +
        fg +
        '"/></svg>'
      );
    }

    return Object.freeze({
      encodeMatrix: encodeMatrix,
      renderSvg: renderSvg,
    });
  }
);
