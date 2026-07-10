# @audio/resample

> Sample-rate conversion.

| Package | What |
|---|---|
| `@audio/resample-sinc` | windowed-sinc (Lanczos, 32-tap), anti-aliased |
| `@audio/resample-linear` | linear interpolation, real-time, no anti-alias filter |
| `@audio/resample-polyphase` | polyphase FIR, streaming rational rates, bit-identical chunked/batch |

```js
import { sinc, linear, polyphase, polyphaseStream } from '@audio/resample'

sinc(data, { from: 44100, to: 48000 })       // → Float32Array
linear(data, { from: 44100, to: 48000 })     // → Float32Array
polyphase(data, { from: 44100, to: 48000 })  // → Float32Array

let s = polyphaseStream({ from: 48000, to: 16000 })
s.write(chunk)   // → Float32Array (may be shorter than input, buffers filter history)
s.flush()        // → Float32Array (drains remaining history)
```

Every resampler shares `fn(data, {from, to}) → Float32Array` (sample rates in Hz). Pitch preserved on up/downsample, round-trip energy loss <1%, aliasing suppressed at Nyquist — polyphase measures ≈−97 dB alias floor on a 15 kHz tone downsampled to 22.05 kHz. `pcm-convert`'s sampleRate is metadata-only today (its backlog wants this). Streaming atoms feed the voice-agent 48↔16/24 kHz path (OpenAI Realtime / LiveKit / Pipecat plumbing).
