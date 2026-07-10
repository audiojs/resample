# @audio/resample-sinc

> Windowed-sinc resampling — high quality, anti-aliased (SoX rate / libsamplerate class)

Windowed-sinc (Lanczos, 32-tap) resampling with kernel widening on downsample — aliases
are suppressed by the widened kernel, no separate lowpass needed.

```js
import sinc, { sincRead, resampleTo } from '@audio/resample-sinc'

sinc(data, { from: 44100, to: 48000 })   // → Float32Array
```

`sinc(data: Float32Array, opts: {from, to}) → Float32Array` — sample rates in Hz.

`sincRead(data, pos)` / `resampleTo(data, n)` — fractional-position read and fixed-output-length primitives, for custom resampling loops.

## Install

```
npm i @audio/resample-sinc
```
