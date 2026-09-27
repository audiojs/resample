# @audio/resample-sinc

> Windowed-sinc resampling — high quality, anti-aliased (SoX rate / libsamplerate class)

Windowed-sinc (Lanczos, a = 16) resampling: 32 taps, widened by the ratio on downsample (64 at 2:1), so the
kernel itself is the anti-alias lowpass. Flat within 0.01 dB to 0.8 of the lower Nyquist (+0.1 dB at 0.9), no delay;
aliases −39 dB just past Nyquist, −62 dB from 1.36× Nyquist up (swept, 2:1 and 3:1).

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
