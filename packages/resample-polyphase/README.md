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

Taps per phase widen with the ratio on downsample (32 at 44.1k → 48k, 64 at 2:1, 96 at 3:1), so every ratio has the
same response: flat within 0.001 dB to 0.8 of the lower Nyquist (−0.34 dB at 0.9), no delay, alias floor −93 dB
from 1.36× Nyquist up (swept, 44.1k → 22.05k and 48k → 16k).

## Install

```
npm i @audio/resample-polyphase
```
