# @audio/resample-polyphase

> Polyphase FIR resampling — streaming-friendly rational rate conversion (48↔16/24 kHz voice-agent path)

Polyphase FIR rational resampling — upsample L, Kaiser-windowed sinc lowpass, downsample
M, computed directly from the phase decomposition (no zero stuffing). The streaming
variant carries filter history across chunks: chunked output is bit-identical to batch.

```js
import polyphase, { stream } from '@audio/resample-polyphase'

polyphase(data, { from: 44100, to: 48000 })   // → Float32Array

let s = stream({ from: 48000, to: 16000 })
s.write(chunk)   // → Float32Array
s.flush()        // → Float32Array (drains remaining history)
```

`polyphase(data: Float32Array, opts: {from, to}) → Float32Array` — sample rates in Hz.

`stream(opts: {from, to}) → {write(chunk) → Float32Array, flush() → Float32Array}`

Alias floor ≈−97 dB (15 kHz tone downsampled 44.1k → 22.05k).

## Install

```
npm i @audio/resample-polyphase
```
