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

`phases(from, to)`: the weights `sinc()` reads at integer rates, one row per phase, for streaming forms that must give its samples.

`oversampler(factor, maxBlockSize)`, `up`, `down`: a stream oversampled by a whole factor, for a memoryless transfer (a saturator's curve) run at the higher rate, on `phases()`:

```js
import { oversampler, up, down } from '@audio/resample-sinc'

let o = oversampler(4, 128)        // 4×, calls of up to 128 samples
up(o, block, n)                    // n samples in, 4·n points out to o.hi
for (let j = 0; j < 4 * n; j++) o.hi[j] = Math.tanh(2 * o.hi[j])
down(o, block, n)                  // back to n samples, o.latency late; o.dry: the input as late
```

Shifted back by `o.latency` the stream is `sinc()` up, the transfer and `sinc()` down of the whole signal, bit for bit at a whole sample rate, except within `o.ring` samples of its start and `o.latency` of its end: there `sinc()` divides by the taps left inside the signal, where the stream reads the silence it began from (it is the whole call of the signal with silence around it). `o.latency` and `o.ring` are 31 and 31 at factors 2 to 8: a processor's latency, and the frames it rings past it. A sample's points reach the output from that sample to `o.latency` samples on. It allocates nothing after `oversampler()`.

## Install

```
npm i @audio/resample-sinc
```
