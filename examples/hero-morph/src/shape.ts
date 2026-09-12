import { clamp } from './state.ts'

export type Vec3 = readonly [number, number, number]
export type Part = 'head' | 'body' | 'leftArm' | 'rightArm' | 'leftFoot' | 'rightFoot'
export const PARTS: Part[] = ['head', 'body', 'leftArm', 'rightArm', 'leftFoot', 'rightFoot']
export const RINGS = 36
export const SEGMENTS = 48
const mix = (a: number, b: number, t: number) => a + (b - a) * t

// Same parameterization and vertex order in both forms; no object swaps or group-scale morph.
export function surface(part: Part, v: number, angle: number, amount: number): Vec3 {
  const t = clamp(amount)
  const phi = v * Math.PI
  const radial = Math.sin(phi)
  const vertical = -Math.cos(phi)
  const front = Math.cos(angle)
  const side = Math.sin(angle)
  if (part === 'head') {
    const crown = Math.max(0, vertical)
    const taper = 1 - 0.52 * crown ** 2
    return [
      side * radial * mix(0.78, 0.87, t) * taper + crown ** 4 * mix(0.28, 0.48, t),
      mix(2.65, 3.1, t) + vertical * mix(0.84, 1.03, t) + crown ** 5 * 0.2,
      front * radial * 0.56 * taper,
    ]
  }
  if (part === 'body') {
    const pear = 1 - vertical * 0.25
    return [side * radial * mix(0.54, 0.76, t) * pear,
      mix(1.45, 1.7, t) + vertical * mix(0.92, 1.16, t),
      front * radial * mix(0.39, 0.46, t)]
  }
  const sign = part.startsWith('left') ? -1 : 1
  if (part.endsWith('Arm')) {
    // Arms unfurl into broader leaf-like wisps, retaining their attachment at the shoulder.
    const x = mix(0.45, 0.62, t) + v * mix(0.66, 0.99, t)
    const width = radial * mix(0.19, 0.34, t)
    return [sign * (x + side * width * 0.42),
      mix(1.95, 2.26, t) - v * mix(0.83, 0.48, t) + side * width,
      front * radial * mix(0.2, 0.16, t)]
  }
  return [sign * (mix(0.27, 0.39, t) + v * 0.13) + side * radial * 0.23,
    mix(0.84, 0.86, t) - v * 0.68,
    front * radial * 0.25 + v * 0.12]
}

export function vertices(part: Part, amount: number): Float32Array {
  const result = new Float32Array((RINGS + 1) * (SEGMENTS + 1) * 3)
  for (let ring = 0; ring <= RINGS; ring++) {
    for (let segment = 0; segment <= SEGMENTS; segment++) {
      result.set(surface(part, ring / RINGS, segment / SEGMENTS * Math.PI * 2, amount),
        (ring * (SEGMENTS + 1) + segment) * 3)
    }
  }
  return result
}

export function interpolateVertices(base: Float32Array, seed: Float32Array, amount: number, output: Float32Array) {
  const t = clamp(amount)
  if (t === 0 || t === 1) {
    output.set(t === 0 ? base : seed)
    return
  }
  for (let i = 0; i < base.length; i++) output[i] = mix(base[i]!, seed[i]!, t)
}

export function attachment(name: 'leftEye' | 'rightEye' | 'mouth' | 'badge', amount: number): Vec3 {
  const part = name === 'badge' ? 'body' : 'head'
  const v = name === 'mouth' ? 0.42 : name === 'badge' ? 0.65 : 0.53
  const angle = name === 'leftEye' ? -0.29 : name === 'rightEye' ? 0.29 : name === 'badge' ? -0.38 : 0
  const a = surface(part, v, angle, 0)
  const b = surface(part, v, angle, 1)
  return [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount) + 0.025]
}
