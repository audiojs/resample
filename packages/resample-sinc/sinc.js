// Windowed-sinc (Lanczos, a = 16) resampling: 32 taps, widened by the ratio on downsample (64 at 2:1) so the
// lowpass at the new Nyquist keeps all 16 lobes each side; no separate anti-alias filter needed.
// Ported from the audio-core interpolator (same math, standalone API).

const HALF = 16
const CAP = 1 << 18                       // phase table entries at most (2 MB): 44.1↔48 takes 5120 and 5292
const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
const gcd = (a, b) => b ? gcd(b, a % b) : a

// Lanczos taps each side: the kernel reaches |x| = HALF at t = HALF / scale. Fewer taps cut the window where it is
// still high (0.64 at 2:1): passband ripple of ±0.3 dB, and a skewed delay where the cut is uneven (0.1 samples at 3:1)
const taps = scale => Math.ceil(HALF / scale)
const tables = new Map()

/**
 * The phase table resample() reads at integer rates, for streaming forms to share its arithmetic: output i sits at
 * input position i·M/L (from/to = M/L reduced); phase p = i·M mod L weighs input base + 1 − T + j, j in J0[p]..J1[p),
 * by W[p·2T + j], base = floor(i·M/L). Null for other rates, or a table past CAP. Kept for the last few ratios, so
 * block-wise calls build it once. J0..J1 are the taps with |x| < HALF (the outermost can fall on it), so a NaN or ∞
 * past them stays out.
 */
export function phases (from, to) {
	let g = Number.isInteger(from) && Number.isInteger(to) ? gcd(from, to) : 0
	if (!g) return null
	let L = to / g, M = from / g, key = M + '/' + L, tab = tables.get(key)
	if (tab) return tab
	let rate = from / to, scale = rate > 1 ? 1 / rate : 1, T = taps(scale), S = 2 * T
	if (L * S > CAP) return null
	let W = new Float64Array(L * S), J0 = new Int32Array(L), J1 = new Int32Array(L)
	for (let p = 0; p < L; p++) {
		let j0 = S, j1 = 0
		for (let j = 0; j < S; j++) {
			let x = (j + 1 - T - p / L) * scale
			if (Math.abs(x) >= HALF) continue
			W[p * S + j] = sinc(x) * sinc(x / HALF)
			if (j < j0) j0 = j
			j1 = j + 1
		}
		J0[p] = j0; J1[p] = j1
	}
	if (tables.size >= 8) tables.delete(tables.keys().next().value)
	tables.set(key, tab = { L, M, T, W, J0, J1 })
	return tab
}

export default function resample (data, { from, to } = {}) {
	if (!(from > 0) || !(to > 0)) throw new RangeError('resample: from/to must be positive sample rates')
	if (from === to) return Float32Array.from(data)

	let rate = from / to                    // input samples per output sample
	let len = data.length
	let n = Math.round(len * to / from)
	let out = new Float32Array(n)
	let scale = rate > 1 ? 1 / rate : 1     // widen kernel when downsampling (anti-alias)
	let T = taps(scale)

	// Integer rates: the fraction of output i's position cycles through L phases, each one's weights tabled once, so an
	// output is a dot product. base, p stepped in integers: the position is exact where i·rate drifts (4e-9 samples
	// 10 minutes in). Taps outside the input are left out and the rest renormalized: weights summed as used, at the
	// ends as between
	let tab = phases(from, to)
	if (tab) {
		let { L, M, W, J0, J1 } = tab, S = 2 * T
		for (let i = 0, p = 0, base = 0; i < n; i++) {
			let lo = base + 1 - T, o = p * S - lo, sum = 0, w = 0
			for (let j = Math.max(0, lo + J0[p]), e = Math.min(len, lo + J1[p]); j < e; j++) { let k = W[o + j]; sum += data[j] * k; w += k }
			out[i] = w !== 0 ? sum / w : 0
			if ((p += M) >= L) { let q = Math.floor(p / L); base += q; p -= q * L }
		}
		return out
	}

	// Other rates, or a table past CAP: the Lanczos weight sinc(x)·sinc(x/HALF) at x = (t − frac)·scale, by angle
	// addition: the sines of π·scale·t and π·scale·t/HALF are tabled per tap, those of the fraction taken once per
	// output sample (4 trig calls, not 64)
	let A = new Float64Array(2 * T), B = new Float64Array(2 * T), C = new Float64Array(2 * T), D = new Float64Array(2 * T)
	for (let j = 0, t = 1 - T; t <= T; t++, j++) {
		let a = Math.PI * scale * t
		A[j] = Math.sin(a); B[j] = Math.cos(a); C[j] = Math.sin(a / HALF); D[j] = Math.cos(a / HALF)
	}
	let K = HALF / (Math.PI * Math.PI)

	for (let i = 0; i < n; i++) {
		let pos = i * rate
		let base = Math.floor(pos), frac = pos - base
		let f = Math.PI * scale * frac, sf = Math.sin(f), cf = Math.cos(f), sg = Math.sin(f / HALF), cg = Math.cos(f / HALF)
		let sum = 0, w = 0
		for (let j = 0, t = 1 - T; t <= T; t++, j++) {
			let idx = base + t
			if (idx < 0 || idx >= len) continue
			let x = (t - frac) * scale
			if (Math.abs(x) >= HALF) continue
			// sin(π·x)·sin(π·x/HALF) / (π·x · π·x/HALF); near x = 0 (a position a rounding error off an integer) the two
			// products cancel, so it is taken directly
			let k = Math.abs(x) < 1e-3 ? sinc(x) * sinc(x / HALF) : (A[j] * cf - B[j] * sf) * (C[j] * cg - D[j] * sg) * K / (x * x)
			sum += data[idx] * k; w += k
		}
		out[i] = w !== 0 ? sum / w : 0
	}
	return out
}

// ── Fractional-position primitives (absorbed from the shift family's engine) ──
// Hann-windowed sinc with angle-addition rotation: sin/cos are advanced by fixed
// per-tap deltas instead of recomputed, so tight resample loops stay trig-free.

// A kernel's position-invariant state: depends only on half-width `hw` and `cutoff`.
function sincKernel (hw, cutoff) {
	let dTheta = Math.PI * cutoff, dPhi = Math.PI / hw
	return { hw, cutoff, dTheta, dPhi, cosDT: Math.cos(dTheta), sinDT: Math.sin(dTheta), cosDP: Math.cos(dPhi), sinDP: Math.sin(dPhi) }
}

// Accumulate a Hann-windowed sinc read of `buf` at fractional position `i0+frac` under
// kernel `k`. Out-of-range taps are dropped (zero-padding convention) and the sum is
// divided by the accumulated tap weight, so edge truncation droops tap count, not gain.
function sincAccumulate (buf, bufLen, i0, frac, k) {
	let { hw, cutoff, dTheta, dPhi, cosDT, sinDT, cosDP, sinDP } = k
	let x = -hw + 1 - frac
	let sinT = Math.sin(x * dTheta), cosT = Math.cos(x * dTheta)
	let sinP = Math.sin(x * dPhi), cosP = Math.cos(x * dPhi)
	let sum = 0, weight = 0
	for (let n = -hw + 1; n <= hw; n++) {
		if (Math.abs(x) < hw) {
			let idx = i0 + n
			if (idx >= 0 && idx < bufLen) {
				let theta = x * dTheta
				let si = Math.abs(x * cutoff) < 1e-9 ? 1 : sinT / theta
				let wt = si * cutoff * (0.5 + 0.5 * cosP)
				sum += buf[idx] * wt
				weight += wt
			}
		}
		let sinT1 = sinT * cosDT + cosT * sinDT
		cosT = cosT * cosDT - sinT * sinDT
		sinT = sinT1
		let sinP1 = sinP * cosDP + cosP * sinDP
		cosP = cosP * cosDP - sinP * sinDP
		sinP = sinP1
		x += 1
	}
	return weight > 1e-9 ? sum / weight : 0
}

/**
 * Hann-windowed sinc read at a fractional source position. `cutoff ∈ (0,1]` sets an
 * anti-alias lowpass at `cutoff × Nyquist` — use `cutoff = min(1, 1/stride)` when
 * stepping through the source faster than one sample per read. `r` is the kernel
 * half-width in zero-crossings (8 standard).
 */
export function sincRead (buf, pos, r = 8, cutoff = 1) {
	let i0 = Math.floor(pos)
	let frac = pos - i0
	let hw = Math.ceil(r / cutoff)
	return sincAccumulate(buf, buf.length, i0, frac, sincKernel(hw, cutoff))
}

/**
 * Resample to an exact output length (anti-aliased on downsample). The length-targeted
 * complement of the default rate-based export — pitch shifters and stretchers address
 * output size directly.
 */
export function resampleTo (data, outLen, r = 8) {
	let inLen = data.length
	let out = new Float32Array(outLen)
	if (outLen === 0 || inLen === 0) return out
	if (outLen === inLen) return new Float32Array(data)
	// outLen===1 has no defined step to anti-alias against; degrade to the pos=0 sample.
	if (outLen === 1) { out[0] = data[0]; return out }
	let step = (inLen - 1) / (outLen - 1)
	let cutoff = step > 1 ? 1 / step : 1
	let k = sincKernel(Math.ceil(r / cutoff), cutoff)
	for (let i = 0; i < outLen; i++) {
		let pos = i * step
		let i0 = Math.floor(pos)
		out[i] = sincAccumulate(data, inLen, i0, pos - i0, k)
	}
	return out
}
