import bluePortrait from '../assets/pets/blue.webp'
import sagePortrait from '../assets/pets/sage.webp'
import stonePortrait from '../assets/pets/stone.webp'
import foxPortrait from '../assets/pets/fox-v2.webp'
import catPortrait from '../assets/pets/plum-v2.webp'
import frogPortrait from '../assets/pets/frog-v2.webp'
import axolotlPortrait from '../assets/pets/gold-v2.webp'
import type { PetAppearance } from '../types'

export const pets: PetAppearance[] = [
  { id: 0, name: 'blue', portrait: bluePortrait },
  { id: 1, name: 'sage', portrait: sagePortrait },
  { id: 2, name: 'stone', portrait: stonePortrait },
  { id: 3, name: 'fox', portrait: foxPortrait },
  { id: 4, name: 'plum', portrait: catPortrait },
  { id: 5, name: 'frog', portrait: frogPortrait },
  { id: 6, name: 'gold', portrait: axolotlPortrait },
]

export function getPet(id: number): PetAppearance {
  return pets.find((pet) => pet.id === id) ?? pets[0]
}
