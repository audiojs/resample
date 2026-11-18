/** Windowed-sinc (Lanczos, 32-tap) resampling — anti-aliased via kernel widening on downsample. */
export interface SincOptions {
  /** source sample rate (Hz) */
  from: number
  /** target sample rate (Hz) */
  to: number
}

/** Returns a new Float32Array of length round(data.length · to/from). */
export default function sinc(data: Float32Array, options: SincOptions): Float32Array

/** sinc()'s phase table at integer rates: output i reads input floor(i·M/L) + 1 − T + j, j in [J0[p], J1[p]),
 *  weighted by W[p·2T + j], p = i·M mod L, the sum divided by the weights used. Null for other rates or past its cap. */
export interface Phases { L: number, M: number, T: number, W: Float64Array, J0: Int32Array, J1: Int32Array }
export function phases(from: number, to: number): Phases | null

/** A stream oversampled by `factor` on sinc()'s arithmetic: the state of up() and down(). */
export interface Oversampler {
  /** the factor: points at the higher rate a sample */
  readonly factor: number
  /** samples down()'s output is late: how far sinc() up and back reads ahead of an output (31 at factors 2 to 8) */
  readonly latency: number
  /** samples the output still moves once the input stops, past `latency`, for a transfer that takes 0 to 0 (31 at 2 to 8) */
  readonly ring: number
  /** a call's factor·n points at the higher rate, from up() to down(), for a transfer to run on in place */
  readonly hi: Float32Array
  /** after down(), the call's input `latency` samples late, for a dry path */
  readonly dry: Float32Array
}
/**
 * State for oversampling a stream by `factor` (a whole number from 2) in calls of up to `maxBlockSize` samples. Shifted
 * back by `latency`, up(), a transfer on `hi` and down() give sinc() up, the transfer and sinc() down of the whole
 * signal with silence before and after it, bit for bit at a whole sample rate: of the signal as it is but within
 * `ring` samples of its start and `latency` of its end, where sinc() divides by the taps left inside it. A sample's
 * points reach the output from that sample to `latency` samples on. Nothing is allocated after this call.
 */
export function oversampler(factor: number, maxBlockSize: number): Oversampler
/** `n` samples of `data` in; their factor·n points at the higher rate out to `o.hi`. */
export function up(o: Oversampler, data: Float32Array, n: number): void
/** `o.hi` back to `n` samples of `data` (which may be up()'s), `o.latency` samples late; the input as late to `o.dry`. */
export function down(o: Oversampler, data: Float32Array, n: number): void

/**
 * Hann-windowed sinc read at a fractional source position. `cutoff` sets an
 * anti-alias lowpass at `cutoff × Nyquist` (default 1, i.e. none); `r` is the
 * kernel half-width in zero-crossings (default 8).
 */
export function sincRead(buf: Float32Array, pos: number, r?: number, cutoff?: number): number

/** Resample to an exact output length (anti-aliased on downsample). `r` — kernel half-width in zero-crossings, default 8. */
export function resampleTo(data: Float32Array, outLen: number, r?: number): Float32Array
