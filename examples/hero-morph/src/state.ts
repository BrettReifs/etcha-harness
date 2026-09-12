export type Equipment = 'none' | 'seed'
export type Transition = Readonly<{ from: number; target: number; started: number; duration: number }>
export const MORPH_DURATION = 850
export const clamp = (value: number) => Math.min(1, Math.max(0, value))
export const targetFor = (equipment: Equipment) => equipment === 'seed' ? 1 : 0

export function sample(transition: Transition, now: number): number {
  if (transition.duration === 0) return transition.target
  const t = clamp((now - transition.started) / transition.duration)
  const eased = t * t * (3 - 2 * t)
  return transition.from + (transition.target - transition.from) * eased
}

export function transitionTo(current: number, equipment: Equipment, now: number, reduced: boolean): Transition {
  const target = targetFor(equipment)
  return { from: current, target, started: now, duration: reduced ? 0 : MORPH_DURATION * Math.abs(target - current) }
}

export function complete(transition: Transition, now: number) {
  return now >= transition.started + transition.duration
}
