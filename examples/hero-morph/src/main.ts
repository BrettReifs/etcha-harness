import './style.css'
import { mountHero } from './renderer.ts'
import type { RenderStatus } from './renderer.ts'
import type { Equipment } from './state.ts'

const stage = document.querySelector<HTMLElement>('#stage')!
const viewport = document.querySelector<HTMLElement>('#viewport')!
const button = document.querySelector<HTMLButtonElement>('#equip')!
const formName = document.querySelector<HTMLElement>('#form-name')!
const formDescription = document.querySelector<HTMLElement>('#form-description')!
const equipmentState = document.querySelector<HTMLElement>('#equipment-state')!
const announcement = document.querySelector<HTMLElement>('#announcement')!
const renderMessage = document.querySelector<HTMLElement>('#render-message')!
const messages: Record<RenderStatus, string> = {
  loading: 'Preparing the 3D fitting room. An illustration is shown for now.',
  ready: 'Live 3D · made of a little more possibility.',
  unavailable: '3D is unavailable. You can still try both illustrated forms. Reload to retry 3D.',
  lost: '3D was interrupted. Illustrated forms are available while the graphics connection recovers.',
}
let equipment: Equipment = 'none'
export const controller = mountHero(viewport, status => {
  stage.dataset.renderer = status
  renderMessage.textContent = messages[status]
})
function equip() {
  equipment = equipment === 'none' ? 'seed' : 'none'
  const equipped = equipment === 'seed'
  stage.dataset.equipment = equipment
  button.setAttribute('aria-pressed', String(equipped))
  button.textContent = equipped ? 'Unequip Seed badge' : 'Equip Seed badge'
  equipmentState.textContent = equipped ? 'Equipped' : 'Not equipped'
  formName.textContent = equipped ? 'Leaf-wisp' : 'Original wisp'
  formDescription.textContent = equipped ? 'A little taller. A little bolder. Still you.' : 'A soft shape, with room to grow.'
  announcement.textContent = equipped ? 'Seed badge equipped. Leaf-wisp form selected.' : 'Seed badge removed. Original wisp form selected.'
  controller.equip(equipment)
}
button.disabled = false
button.addEventListener('click', equip)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    button.removeEventListener('click', equip)
    controller.dispose()
  })
}
