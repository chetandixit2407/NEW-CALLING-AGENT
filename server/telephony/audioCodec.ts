/**
 * ITU-T G.711 mu-law <-> 16-bit Linear PCM codec and sample-rate converter
 * Used to bridge PSTN telephony 8kHz mu-law audio streams with Gemini Live API
 * (16kHz PCM input / 24kHz PCM output).
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

// Precomputed 256-entry mu-law -> Int16 linear PCM lookup table
const MULAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const mu = ~i & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  MULAW_DECODE_TABLE[i] = sign !== 0 ? -sample : sample;
}

const EXP_LUT = new Uint8Array([
  0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
]);

export function linear16ToMulawByte(sample: number): number {
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;
  const exponent = EXP_LUT[(sample >> 7) & 0xff];
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/**
 * Convert 8kHz G.711 mu-law base64 audio (from Twilio Media Streams)
 * to 16kHz 16-bit Little-Endian PCM base64 (for Gemini Live API).
 */
export function mulaw8kToPcm16kBase64(mulawBase64: string): string {
  const mulawBuf = Buffer.from(mulawBase64, 'base64');
  const len = mulawBuf.length;
  if (len === 0) return '';

  const pcm16k = new Int16Array(len * 2);
  let prev = MULAW_DECODE_TABLE[mulawBuf[0]];
  for (let i = 0; i < len; i++) {
    const curr = MULAW_DECODE_TABLE[mulawBuf[i]];
    const next = i + 1 < len ? MULAW_DECODE_TABLE[mulawBuf[i + 1]] : curr;
    pcm16k[i * 2] = curr;
    pcm16k[i * 2 + 1] = ((curr + next) >> 1);
    prev = curr;
  }
  void prev;

  return Buffer.from(pcm16k.buffer, pcm16k.byteOffset, pcm16k.byteLength).toString('base64');
}

/**
 * Convert 24kHz 16-bit Little-Endian PCM base64 (from Gemini Live API)
 * to 8kHz G.711 mu-law base64 (for Twilio Media Streams).
 */
export function pcm24kToMulaw8kBase64(pcm24kBase64: string): string {
  const pcmBuf = Buffer.from(pcm24kBase64, 'base64');
  const sampleCount = Math.floor(pcmBuf.byteLength / 2);
  if (sampleCount < 3) return '';

  const pcm24 = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, sampleCount);
  const outCount = Math.floor(sampleCount / 3);
  const mulawOut = Buffer.allocUnsafe(outCount);

  for (let i = 0; i < outCount; i++) {
    const base = i * 3;
    // 3-tap box average anti-aliasing downsample (24kHz -> 8kHz)
    const avg = Math.round((pcm24[base] + pcm24[base + 1] + pcm24[base + 2]) / 3);
    mulawOut[i] = linear16ToMulawByte(avg);
  }

  return mulawOut.toString('base64');
}
