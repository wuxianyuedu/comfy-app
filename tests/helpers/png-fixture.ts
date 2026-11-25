/**
 * PNG 测试夹具（tests 基建）：用 node:zlib 现场拼最小 PNG（RGB 8bit 非隔行），
 * 供质量打分 / 产物相关用例构造确定性的图片字节，不依赖仓库里的夹具文件。
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (3_988_059_505 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 4_294_967_295;
  for (const byte of buf) {
    c = ((CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 4_294_967_295) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** 拼 PNG：RGB 8bit 非隔行；pixels 为行优先 RGB（长度 = width*height*3）。 */
export function makePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** 造一张「每像素颜色都不同」的噪声图（质量打分应给高分）。 */
export function noiseImage(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 3);
  let seed = 1;
  for (let i = 0; i < pixels.length; i += 3) {
    seed = (seed * 16_807) % 2_147_483_647;
    pixels[i] = seed % 256;
    pixels[i + 1] = (seed >> 3) % 256;
    pixels[i + 2] = (seed >> 6) % 256;
  }
  return makePng(size, size, pixels);
}

/** 造一张纯色图（质量打分应判为疑似空白）。 */
export function flatImage(size: number, r = 200, g = 200, b = 200): Uint8Array {
  const pixels = new Uint8Array(size * size * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
  return makePng(size, size, pixels);
}

/** 按给定的**每行滤波类型**编码 PNG（filters.length == height）：
 *  让解码侧的反滤波（Sub / Up / Average / Paeth）真正被走到。 */
export function makePngWithFilters(
  width: number,
  height: number,
  pixels: Uint8Array,
  filters: Array<number>,
): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = filters[y] ?? 0;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const current = pixels[y * stride + x] ?? 0;
      const left = x >= 3 ? (pixels[y * stride + x - 3] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= 3 && y > 0 ? (pixels[(y - 1) * stride + x - 3] ?? 0) : 0;
      let filtered = current;
      switch (filter) {
        case 1: {
          filtered = (current - left) & 0xff;
          break;
        }
        case 2: {
          filtered = (current - up) & 0xff;
          break;
        }
        case 3: {
          filtered = (current - ((left + up) >> 1)) & 0xff;
          break;
        }
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          filtered = (current - (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff;
          break;
        }
        default: {
          break;
        }
      }
      raw[y * (stride + 1) + 1 + x] = filtered;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
