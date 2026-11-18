import test, { almost, ok, is } from 'tst'
import { execFileSync } from 'node:child_process'
import { sinc, sincRead, resampleTo, linear, polyphase, polyphaseStream } from './index.js'
import { oversampler, up, down } from '@audio/resample-sinc'

const fs = 44100

function sine (freq, n, sr = fs) {
	let d = new Float32Array(n)
	for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / sr)
	return d
}
function rms (d, from = 0, to = d.length) {
	let s = 0
	for (let i = from; i < to; i++) s += d[i] * d[i]
	return Math.sqrt(s / (to - from))
}
// dominant frequency via zero-crossing count over the mid section (edges tapered by kernel)
function measureFreq (d, sr) {
	let from = d.length >> 3, to = d.length - (d.length >> 3), crossings = 0
	for (let i = from + 1; i < to; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) crossings++
	return crossings / 2 * sr / (to - from)
}

test('sinc — output length is round(n·to/from)', () => {
	is(sinc(sine(440, fs), { from: fs, to: 48000 }).length, 48000)
	is(sinc(sine(440, fs), { from: fs, to: 22050 }).length, 22050)
})

test('sinc — same rate is a copy', () => {
	let d = sine(440, 1024)
	let r = sinc(d, { from: fs, to: fs })
	ok(r !== d, 'new buffer')
	is(r.length, d.length)
	for (let i = 0; i < d.length; i++) if (r[i] !== d[i]) throw new Error('copy differs')
})

test('sinc — pitch preserved on upsample 44.1k → 48k', () => {
	let r = sinc(sine(440, fs), { from: fs, to: 48000 })
	almost(measureFreq(r, 48000), 440, 2, 'frequency preserved')
})

test('sinc — pitch preserved on downsample 44.1k → 22.05k', () => {
	let r = sinc(sine(440, fs), { from: fs, to: 22050 })
	almost(measureFreq(r, 22050), 440, 2, 'frequency preserved')
})

test('sinc — round-trip preserves energy within 1%', () => {
	let d = sine(440, fs)
	let back = sinc(sinc(d, { from: fs, to: 48000 }), { from: 48000, to: fs })
	let a = rms(d, 2000, d.length - 2000), b = rms(back, 2000, back.length - 2000)
	ok(Math.abs(a - b) / a < 0.01, `energy loss ${(100 * Math.abs(a - b) / a).toFixed(2)}%`)
})

test('sinc — anti-alias: 15 kHz attenuated when downsampling to 22.05k (Nyquist 11 kHz)', () => {
	let d = sine(15000, fs)
	let r = sinc(d, { from: fs, to: 22050 })
	let ratio = rms(r, 1000, r.length - 1000) / rms(d)
	ok(ratio < 0.1, `alias suppressed to ${(20 * Math.log10(ratio)).toFixed(1)} dB`)
})

// The phase table (integer rates) and the Lanczos weights by angle addition (others) equal the direct form: the
// previous implementation, kept here as the reference, sin() per tap, at the exact position i·from/to. 7.7→5.5 puts
// positions a rounding error off an integer, where the identity cancels (taken directly there). Equal after the
// Float32 store, sample for sample
test('sinc: equals the direct Lanczos form at every ratio', () => {
	const HALF = 16, sn = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
	const direct = (data, from, to) => {
		let rate = from / to, n = Math.round(data.length * to / from), out = new Float32Array(n), scale = rate > 1 ? 1 / rate : 1
		for (let i = 0; i < n; i++) {
			let base = Math.floor(i * from / to), frac = (i * from - base * to) / to, sum = 0, w = 0
			for (let T = Math.ceil(HALF / scale), t = 1 - T; t <= T; t++) { let idx = base + t, x = (t - frac) * scale; if (idx < 0 || idx >= data.length || Math.abs(x) >= HALF) continue; let k = sn(x) * sn(x / HALF); sum += data[idx] * k; w += k }
			out[i] = w !== 0 ? sum / w : 0
		}
		return out
	}
	let seed = 1, rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
	let x = Float32Array.from({ length: 4410 }, (_, i) => 0.5 * Math.sin(i * 0.05) + 0.3 * (rnd() * 2 - 1))
	for (let [from, to] of [[1, 4], [44100, 48000], [48000, 44100], [3, 1], [1, 3], [7, 5], [5, 7], [11, 13], [48000, 16000], [7.7, 5.5], [44100.5, 48000], [48000, 22050.5]]) {
		let a = direct(x, from, to), b = sinc(x, { from, to }), diff = 0
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
		is([b.length, diff], [a.length, 0], `${from}→${to}: every sample equal`)
	}
})

// A band-limited sine resampled is the same sine sampled at the output times (Shannon): no gain error, no delay.
// Gain and phase fitted over the middle half; the offset is in input samples, + when the output is late.
function toneFit(f, from, to, fn) {
	let x = Float32Array.from({ length: from }, (_, i) => Math.sin(2 * Math.PI * f * i / from)), y = fn(x, { from, to })
	let a = 0, b = 0, m0 = y.length >> 2, m1 = 3 * y.length >> 2
	for (let m = m0; m < m1; m++) { let p = 2 * Math.PI * f * m / to; a += y[m] * Math.sin(p); b += y[m] * Math.cos(p) }
	return { db: 20 * Math.log10(2 * Math.hypot(a, b) / (m1 - m0)), offset: -Math.atan2(b, a) / (2 * Math.PI * f) * from }
}

test('sinc, polyphase: a sine keeps its level and its time (2:1, 3:1, 44.1→48)', () => {
	// flat to 0.8 of the new Nyquist (sinc +0.1 dB at 0.9, polyphase -0.34 dB, then their transitions). Before: sinc
	// ±0.3 dB with 0.095 samples of delay at 3:1; polyphase half a sample early at 2:1 and 3:1, -0.34 dB at 0.7 for 3:1
	for (let [name, fn] of [['sinc', sinc], ['polyphase', polyphase]]) for (let [from, to] of [[44100, 22050], [48000, 16000], [44100, 48000]]) {
		let ny = Math.min(from, to) / 2, bad = []
		for (let f of [1000, 0.5 * ny, 0.8 * ny]) {
			let { db, offset } = toneFit(Math.round(f), from, to, fn)
			if (Math.abs(db) > 0.02 || Math.abs(offset) > 0.005) bad.push(`${Math.round(f)} Hz: ${db.toFixed(3)} dB, ${offset.toFixed(4)} samples`)
		}
		is(bad, [], `${name} ${from}→${to}`)
	}
})

test('sinc — invalid rates throw', () => {
	let threw = 0
	try { sinc(sine(440, 64), {}) } catch { threw++ }
	try { sinc(sine(440, 64), { from: -1, to: 48000 }) } catch { threw++ }
	is(threw, 2)
})

test('linear — length, noop, pitch preserved on upsample', () => {
	let d = sine(440, fs)
	is(linear(d, { from: fs, to: 48000 }).length, 48000)
	let same = linear(d, { from: fs, to: fs })
	ok(same !== d && same[1234] === d[1234], 'noop copy')
	almost(measureFreq(linear(d, { from: fs, to: 48000 }), 48000), 440, 2, 'frequency preserved')
})

test('polyphase — rational 44.1→48: exact length, frequency, unity gain', () => {
	let r = polyphase(sine(440, fs), { from: 44100, to: 48000 })
	is(r.length, 48000)
	almost(measureFreq(r, 48000), 440, 2)
	almost(rms(r, 1000, r.length - 1000), Math.SQRT1_2, 0.01, 'unity passband gain')
})

// Kaiser β = 8.6 designs ~85 dB of stopband; swept floor 2:1 -93.8 dB, 3:1 -92.6 dB (3:1 was -35 dB with 32 taps)
test('polyphase: anti-alias, tones past the transition band suppressed below −85 dB at 2:1 and 3:1', () => {
	for (let [from, to] of [[44100, 22050], [48000, 16000]]) {
		let loud = []
		for (let r of [1.36, 1.5, 1.7, 1.9]) {
			let f = Math.round(r * to / 2), y = polyphase(sine(f, from, from), { from, to })
			let db = 20 * Math.log10(rms(y, 1000, y.length - 1000) / Math.SQRT1_2)
			if (!(db < -85)) loud.push(`${f} Hz: ${db.toFixed(1)} dB`)
		}
		is(loud, [], `${from}→${to}`)
	}
})

test('polyphase stream — chunked ≡ batch exactly (48↔16 voice path)', () => {
	let x = sine(440, 48000, 48000)
	let batch = polyphase(x, { from: 48000, to: 16000 })
	let s = polyphaseStream({ from: 48000, to: 16000 }), parts = []
	for (let pos = 0, sizes = [64, 1000, 3, 2048, 777]; pos < x.length;) {
		let n = Math.min(sizes[pos % sizes.length] || 512, x.length - pos)
		parts.push(s.write(x.subarray(pos, pos + n))); pos += n
	}
	parts.push(s.flush())
	let cat = new Float32Array(parts.reduce((a, p) => a + p.length, 0)), o = 0
	for (let p of parts) { cat.set(p, o); o += p.length }
	is(cat.length, batch.length)
	let diff = 0
	for (let i = 0; i < cat.length; i++) diff = Math.max(diff, Math.abs(cat[i] - batch[i]))
	ok(diff === 0, `bit-identical (${diff})`)
})

test('polyphase stream: same rate passes through, nothing added at flush', () => {
	let x = sine(440, 1000), s = polyphaseStream({ from: 48000, to: 48000 })
	is([s.write(x).length, s.flush().length], [1000, 0])
})

test('polyphase — invalid rates throw', () => {
	let threw = 0
	try { polyphase(sine(440, 64), {}) } catch { threw++ }
	try { polyphase(sine(440, 64), { from: 0, to: 48000 }) } catch { threw++ }
	is(threw, 2)
})

test('sinc: sincRead — fractional read of a sine matches analytic value', () => {
  let fs = 48000, f = 440
  let x = new Float32Array(4096)
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * f * i / fs)
  let err = 0
  for (let pos of [1000.25, 1500.5, 2000.75, 3000.125]) {
    let want = Math.sin(2 * Math.PI * f * pos / fs)
    err = Math.max(err, Math.abs(sincRead(x, pos) - want))
  }
  ok(err < 1e-3, 'fractional sinc read accurate, err ' + err)
})

test('sinc: resampleTo — half-length downsample keeps a low sine intact', () => {
  let fs = 48000, f = 440
  let x = new Float32Array(8192)
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * f * i / fs)
  let y = resampleTo(x, 4096)
  ok(y.length === 4096, 'exact output length')
  let err = 0
  for (let i = 256; i < 4096 - 256; i++) {
    let want = Math.sin(2 * Math.PI * f * (i * (8192 - 1) / (4096 - 1)) / fs)
    err = Math.max(err, Math.abs(y[i] - want))
  }
  ok(err < 2e-2, 'downsampled sine intact, err ' + err)
})

// The streaming oversampler (oversampler, up, down) against sinc() itself: a curve run at N times the rate in calls of
// 1 to 1024 samples, shifted back by the latency, is sinc() up, the curve and sinc() down of the whole signal with 64
// zeros on each side (past any tap's reach), bit for bit; of the signal as it is, everywhere but within `ring` samples
// of its start and `latency` of its end, where sinc() divides by the taps left inside it and the stream reads silence
test('sinc: oversampler: up, a curve and down in calls of any size are sinc() up, the curve and sinc() down, latency late, bit for bit', () => {
	let seed = 7, rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, curve = v => Math.tanh(3 * v)
	let whole = (x, fs, N) => { let u = sinc(x, { from: fs, to: N * fs }); for (let i = 0; i < u.length; i++) u[i] = curve(u[i]); return sinc(u, { from: N * fs, to: fs }) }
	for (let N of [2, 4, 8]) for (let fs of [22050, 44100, 96000]) {
		let n = 6000, P = 64, x = Float32Array.from({ length: n }, (_, i) => 0.6 * Math.sin(2 * Math.PI * 3000 * i / fs) + 0.3 * (2 * rnd() - 1))
		let o = oversampler(N, 1024), L = o.latency, R = o.ring, y = new Float32Array(n + L), dry = new Float32Array(n + L)
		y.set(x)
		for (let pos = 0, k; pos < y.length; pos += k) {
			k = Math.min(1 + Math.floor(rnd() * 1024), y.length - pos)
			let d = y.subarray(pos, pos + k)
			up(o, d, k)
			for (let j = 0; j < N * k; j++) o.hi[j] = curve(o.hi[j])
			down(o, d, k)
			dry.set(o.dry.subarray(0, k), pos)
		}
		let pad = new Float32Array(n + 2 * P), out = y.subarray(L), bare = whole(x, fs, N), off = 0, inside = 0, ends = 0, late = 0
		pad.set(x, P)
		let padded = whole(pad, fs, N).subarray(P, P + n)
		for (let i = 0; i < n; i++) {
			if (!Object.is(out[i], padded[i])) off++
			if (out[i] !== bare[i]) i >= R && i < n - L ? inside++ : ends++
		}
		for (let i = 0; i < n + L; i++) if (!Object.is(dry[i], i < L ? 0 : x[i - L])) late++
		is([off, inside, late], [0, 0, 0], `${N}× at ${fs} Hz: the padded whole call; the bare one from ${R} to ${n - L}; dry, the input ${L} late`)
		ok(ends > 0, `${N}× at ${fs} Hz: the bare whole call parts from the stream at ${ends} of its ${R + L} samples by the ends`)
	}
})

// latency and ring are how far sinc() up then down reads ahead of an output and behind it: the first and the last sample
// an impulse moves, less where it is. A stream fed it moves from it to latency + ring on; the N points up() makes for
// one sample, moved, move the output from that sample to latency samples on
test('sinc: oversampler: latency and ring are how far sinc() up and down reads ahead and behind', () => {
	for (let N of [2, 4, 8]) {
		let n = 512, K = 256, g = 200, x = new Float32Array(n), o = oversampler(N, 1), s = new Float32Array(n)
		x[K] = 1
		let y = sinc(sinc(x, { from: 44100, to: N * 44100 }), { from: N * 44100, to: 44100 })
		for (let i = 0; i < n; i++) { let d = s.subarray(i, i + 1); d[0] = x[i]; up(o, d, 1); down(o, d, 1) }
		is([K - y.findIndex(v => v !== 0), y.findLastIndex(v => v !== 0) - K], [o.latency, o.ring], `${N}×: sinc() up and down reads ${o.latency} ahead, ${o.ring} behind`)
		is([s.findIndex(v => v !== 0), s.findLastIndex(v => v !== 0)], [K, K + o.latency + o.ring], `${N}×: the stream moves from the impulse to latency + ring on`)
		let a = new Float32Array(n), b = new Float32Array(n)
		for (let [out, by] of [[a, 0], [b, 0.25]]) {
			let q = oversampler(N, 1)
			for (let i = 0; i < n; i++) {
				let d = out.subarray(i, i + 1)
				d[0] = 0.5 * Math.sin(0.1 * i)
				up(q, d, 1)
				if (i === g) for (let p = 0; p < N; p++) q.hi[p] += by
				down(q, d, 1)
			}
		}
		let moved = [...a.keys()].filter(i => a[i] !== b[i])
		is([moved[0], moved.at(-1), moved.length], [g, g + o.latency, o.latency + 1], `${N}×: a sample's points move the output from it to latency samples on`)
	}
})

test('sinc: oversampler: a factor that is not a whole number from 2 throws', () => {
	let threw = 0
	for (let f of [1, 0, 2.5, -4, NaN]) try { oversampler(f, 128) } catch (e) { if (e instanceof RangeError) threw++ }
	is(threw, 5)
})

// measured as @audio/compile's validator measures a processor (tools/verify.js, alloc): a child Node with a 1 MB young
// generation, 2^17 warm calls of 8 samples, no collection allowed; a curve between up and down, as a saturator runs it
test('sinc: oversampler: up and down allocate nothing', () => {
	let code = `
		import { PerformanceObserver } from 'node:perf_hooks'
		import { oversampler, up, down } from '@audio/resample-sinc'
		let out = {}, x = Float32Array.from({ length: 4096 }, (_, i) => 0.7 * Math.sin(i * 0.05)), d = new Float32Array(8)
		for (let N of [2, 4, 8]) {
			let o = oversampler(N, 128), hi = o.hi
			// a call as a host makes it: the block in, up, the curve, down; compiled over the warm calls before the count
			let call = i => { for (let j = 0; j < 8; j++) d[j] = x[(8 * i + j) & 4095]; up(o, d, 8); for (let j = 0; j < 8 * N; j++) hi[j] = Math.tanh(2 * hi[j]); down(o, d, 8) }
			for (let i = 0; i < 1 << 15; i++) call(i)
			globalThis.gc()
			let gcs = 0, obs = new PerformanceObserver(l => { gcs += l.getEntries().length })
			obs.observe({ entryTypes: ['gc'] })
			for (let i = 0; i < 1 << 17; i++) call(i)
			await new Promise(r => setTimeout(r, 10))
			obs.disconnect()
			out[N] = gcs
		}
		process.stdout.write(JSON.stringify(out))`
	let res = JSON.parse(execFileSync(process.execPath, ['--max-semi-space-size=1', '--expose-gc', '--no-concurrent-recompilation', '--input-type=module', '-e', code], { cwd: new URL('.', import.meta.url).pathname, encoding: 'utf8', timeout: 600e3 }))
	is(res, { 2: 0, 4: 0, 8: 0 }, 'collections over 2^17 calls at 2, 4 and 8 times the rate')
})
