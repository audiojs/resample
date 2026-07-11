/** Windowed-sinc (Lanczos, 32-tap) resampling — anti-aliased via kernel widening on downsample. */
export interface SincOptions {
  /** source sample rate (Hz) */
  from: number
  /** target sample rate (Hz) */
  to: number
}

/** Returns a new Float32Array of length round(data.length · to/from). */
export default function sinc(data: Float32Array, options: SincOptions): Float32Array

/**
 * Hann-windowed sinc read at a fractional source position. `cutoff` sets an
 * anti-alias lowpass at `cutoff × Nyquist` (default 1, i.e. none); `r` is the
 * kernel half-width in zero-crossings (default 8).
 */
export function sincRead(buf: Float32Array, pos: number, r?: number, cutoff?: number): number

/** Resample to an exact output length (anti-aliased on downsample). `r` — kernel half-width in zero-crossings, default 8. */
export function resampleTo(data: Float32Array, outLen: number, r?: number): Float32Array
