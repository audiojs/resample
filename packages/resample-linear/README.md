# @audio/resample-linear

> Linear-interpolation resampling — cheap, real-time

Linear-interpolation resampling — cheap, real-time. No anti-alias filter: use
`@audio/resample-sinc` when downsampling.

```js
import linear from '@audio/resample-linear'

linear(data, { from: 44100, to: 48000 })   // → Float32Array
```

`linear(data: Float32Array, opts: {from, to}) → Float32Array` — sample rates in Hz.

## Install

```
npm i @audio/resample-linear
```
