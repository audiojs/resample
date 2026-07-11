/** Linear-interpolation resampling — cheap, real-time. No anti-alias filter. */
export interface LinearOptions {
  /** source sample rate (Hz) */
  from: number
  /** target sample rate (Hz) */
  to: number
}

/** Returns a new Float32Array of length round(data.length · to/from). */
export default function linear(data: Float32Array, options: LinearOptions): Float32Array
