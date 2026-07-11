/** Polyphase FIR rational resampling — streaming-friendly, chunked output bit-identical to batch. */
export interface PolyphaseOptions {
  /** source sample rate (Hz) */
  from: number
  /** target sample rate (Hz) */
  to: number
}

/** Streaming rational resampler. */
export interface PolyphaseStream {
  /** Feed a chunk; returns output ready so far (may be shorter than input). */
  write(chunk: Float32Array): Float32Array
  /** Drain the remaining filter history. */
  flush(): Float32Array
}

/** Returns a new Float32Array of length round(data.length · to/from). */
export default function polyphase(data: Float32Array, options: PolyphaseOptions): Float32Array

/** Streaming form — carries filter history across chunks. */
export function stream(options: PolyphaseOptions): PolyphaseStream
