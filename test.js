import test, { almost, ok, is } from 'tst'
import { sinc, linear, polyphase, polyphaseStream } from './index.js'

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

test('polyphase — anti-alias: 15 kHz into 22.05k suppressed below −80 dB', () => {
	let r = polyphase(sine(15000, fs), { from: 44100, to: 22050 })
	let db = 20 * Math.log10(rms(r, 1000, r.length - 1000) / rms(sine(15000, fs)))
	ok(db < -80, `${db.toFixed(1)} dB`)
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

test('polyphase — invalid rates throw', () => {
	let threw = 0
	try { polyphase(sine(440, 64), {}) } catch { threw++ }
	try { polyphase(sine(440, 64), { from: 0, to: 48000 }) } catch { threw++ }
	is(threw, 2)
})
