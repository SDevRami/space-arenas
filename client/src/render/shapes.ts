import { Graphics, type Renderer as PixiRenderer, type Texture } from 'pixi.js'
import { getGraphics } from '../ui/graphics.ts'

const cache = new Map<string, Texture>()

function rect(g: Graphics, x: number, y: number, w: number, h: number): Graphics {
  return g.rect(x, y, w, h).fill(0xffffff)
}

function circle(g: Graphics, x: number, y: number, r: number): Graphics {
  return g.circle(x, y, r).fill(0xffffff)
}

function rectC(g: Graphics, x: number, y: number, w: number, h: number, c: number): Graphics {
  return g.rect(x, y, w, h).fill(c)
}

function circleC(g: Graphics, x: number, y: number, r: number, c: number): Graphics {
  return g.circle(x, y, r).fill(c)
}

const LIGHT = 0xdedede
const SHADE = 0x9a9a9a
const MID = 0x5c5c5c
const DARK = 0x2c2c2c

function unitShape(kind: string, g: Graphics): Graphics {
  switch (kind) {
    case 'bulldozer':
      rect(g, -13, -8, 7, 16)
      rect(g, -7, -6, 16, 12)
      rect(g, 7, -3, 4, 5)
      return g
    case 'harvester':
      rect(g, -10, -7, 20, 14)
      rect(g, -6, -4, 6, 6)
      return g
    case 'scout':
      rect(g, -3, -2, 6, 4)
      circle(g, 0, 0, 3)
      return g
    case 'rifleman':
      circle(g, 0, 0, 3)
      rect(g, 2, -1, 4, 2)
      return g
    case 'rocket-trooper':
      circle(g, 0, 0, 3)
      rect(g, -5, -1, 4, 2)
      return g
    case 'assault-walker':
      rect(g, -9, -5, 18, 10)
      rect(g, -7, -8, 6, 3)
      rect(g, 1, -8, 6, 3)
      rect(g, -3, -5, 6, 4)
      return g
    case 'aa-platform':
      rect(g, -9, -5, 18, 10)
      circle(g, 0, -2, 3)
      rect(g, -1, -6, 2, 5)
      return g
    case 'artillery':
      rect(g, -14, -4, 28, 8)
      rect(g, -10, -4, 6, 5)
      return g
    case 'engineer':
      rect(g, -10, -5, 20, 10)
      rect(g, -4, -8, 5, 4)
      rect(g, 6, -9, 2, 6)
      return g
    case 'apc':
      rect(g, -13, -7, 26, 14)
      rect(g, -9, -5, 18, 10)
      rect(g, 8, -3, 5, 6)
      return g
    case 'fighter':
      g.poly([-14, 0, -7, -6, 10, -6, 14, 0, 10, 6, -7, 6]).fill(0xffffff)
      circle(g, 0, 0, 3)
      return g
    case 'carrier':
      rect(g, -16, -5, 32, 10)
      rect(g, -4, -9, 12, 4)
      rect(g, 9, -8, 5, 3)
      return g
    case 'missile-boat':
      rect(g, -11, -3, 22, 6)
      rect(g, 3, -6, 7, 3)
      rect(g, -6, -7, 2, 4)
      circle(g, 6, -5, 1.5)
      return g
    default:
      circle(g, 0, 0, 4)
      return g
  }
}

function buildingShape(kind: string, g: Graphics): Graphics {
  switch (kind) {
    case 'command-center':
      rect(g, -12, -10, 24, 20)
      rect(g, -8, -6, 16, 12)
      return g
    case 'power-plant':
      rect(g, -9, -9, 18, 18)
      circle(g, 0, 0, 4)
      return g
    case 'supply-dock':
      rect(g, -9, -9, 18, 18)
      rect(g, -9, -9, 18, 4)
      return g
    case 'barracks':
      rect(g, -9, -9, 18, 18)
      rect(g, -3, 2, 6, 6)
      return g
    case 'war-factory':
      rect(g, -12, -9, 24, 18)
      rect(g, 2, -2, 10, 6)
      return g
    case 'turret':
      circle(g, 0, 0, 4)
      rect(g, -1, -6, 2, 6)
      return g
    case 'tech-center':
      rect(g, -9, -9, 18, 18)
      circle(g, 0, 0, 5)
      return g
    case 'air-force':
      rect(g, -9, -9, 18, 18)
      g.poly([-10, 0, -3, -4, 8, -4, 10, 0, 8, 4, -3, 4]).fill(0xffffff)
      return g
    case 'super-weapon':
      rect(g, -12, -12, 24, 24)
      circle(g, 0, 0, 7)
      return g
    case 'bunker':
      rect(g, -9, -9, 18, 18)
      rect(g, -5, 1, 10, 7)
      circle(g, 0, -3, 4)
      return g
    case 'dock':
      rect(g, -12, -9, 24, 18)
      rect(g, -12, -9, 24, 5)
      rect(g, -5, 3, 10, 5)
      return g
    default:
      rect(g, -8, -8, 16, 16)
      return g
  }
}

function obstacleShape(kind: string, g: Graphics): Graphics {
  switch (kind) {
    case 'rock':
      g.poly([-14, -3, -9, -10, 0, -12, 10, -9, 14, -2, 10, 7, -1, 10, -12, 7]).fill(0xffffff)
      return g
    case 'mine':
      circle(g, 0, 0, 4)
      rect(g, -2, -4, 4, 8)
      return g
    case 'wreck':
      rect(g, -13, -6, 9, 12)
      rect(g, -6, -3, 18, 7)
      rect(g, -4, -4, 4, 3)
      return g
    case 'tree':
      g.poly([-3, -14, 0, -16, 3, -14, 5, -10, 11, -4, 13, 3, 11, 10, -11, 10, -13, 3, -11, -4, -5, -10]).fill(0xffffff)
      rect(g, -3, 6, 6, 7)
      return g
    default:
      circle(g, 0, 0, 5)
      return g
  }
}

// ---------- medium quality: richly detailed, purpose-specific shapes ----------

function mediumUnitShape(kind: string, g: Graphics): Graphics {
  switch (kind) {
    case 'bulldozer': {
      rectC(g, -13, 2, 26, 5, 0xffffff)
      rectC(g, -12, 3, 24, 1, MID)
      rectC(g, -12, 5, 24, 1, MID)
      rectC(g, -11, -3, 20, 6, 0xffffff)
      rectC(g, 8, -3, 2, 6, DARK)
      rectC(g, 6, -5, 3, 3, SHADE)
      rectC(g, -6, -6, 9, 4, 0xffffff)
      rectC(g, -4, -5, 5, 3, DARK)
      rectC(g, -3, -3, 4, 1, 0xffffff)
      rectC(g, -7, -8, 11, 2, 0xffffff)
      rectC(g, 9, -2, 4, 6, MID)
      rectC(g, 9, -2, 4, 1, LIGHT)
      rectC(g, 9, 4, 4, 1, LIGHT)
      circleC(g, 10, 3, 1.2, 0xffffff)
      rectC(g, -12, -8, 2, 3, MID)
      return g
    }
    case 'harvester': {
      rectC(g, -13, -7, 17, 11, 0xffffff)
      rectC(g, -11, -7, 1, 11, SHADE)
      rectC(g, -4, -7, 1, 11, SHADE)
      rectC(g, -2, -7, 1, 11, SHADE)
      rectC(g, 4, -7, 1, 11, SHADE)
      rectC(g, 5, -5, 8, 8, 0xffffff)
      rectC(g, 6, -4, 5, 4, DARK)
      rectC(g, -3, 4, 18, 2, 0xffffff)
      circleC(g, -6, 5, 2.5, 0xffffff)
      circleC(g, -6, 5, 1, DARK)
      circleC(g, 0, 5, 2.5, 0xffffff)
      circleC(g, 0, 5, 1, DARK)
      circleC(g, 6, 5, 2.5, 0xffffff)
      circleC(g, 6, 5, 1, DARK)
      rectC(g, 13, -7, 2, 3, MID)
      rectC(g, 12, -4, 3, 2, MID)
      circleC(g, 11, -7, 1.4, 0xffffff)
      return g
    }
    case 'scout': {
      rectC(g, -2, -4, 6, 7, 0xffffff)
      circleC(g, 0, -7, 3, 0xffffff)
      circleC(g, 0, -8, 2.6, MID)
      rectC(g, 1, -8, 2, 1.4, LIGHT)
      rectC(g, -6, -3, 3, 4, SHADE)
      rectC(g, -2, 3, 2, 4, 0xffffff)
      rectC(g, 2, 3, 2, 4, 0xffffff)
      rectC(g, -4, 7, 3, 1.4, MID)
      rectC(g, 2, 7, 3, 1.4, MID)
      rectC(g, 1, -6, 2, 2, 0xffffff)
      rectC(g, 5, -12, 1.5, 8, MID)
      circleC(g, 5.8, -12.8, 1.2, 0xffffff)
      g.poly([6.5, -12, 11.5, -10.6, 6.5, -9.2]).fill(0xffffff)
      return g
    }
    case 'rifleman': {
      rectC(g, -2, -4, 6, 7, 0xffffff)
      circleC(g, 0, -7, 3, 0xffffff)
      circleC(g, 0, -8, 2.6, MID)
      rectC(g, 1, -8, 2, 1.4, LIGHT)
      rectC(g, -6, -3, 3, 4, MID)
      rectC(g, -2, 3, 2, 4, 0xffffff)
      rectC(g, 2, 3, 2, 4, 0xffffff)
      rectC(g, -4, 7, 3, 1.4, MID)
      rectC(g, 2, 7, 3, 1.4, MID)
      rectC(g, -5, -1, 3, 2, 0xffffff)
      rectC(g, 1, -1, 8, 2, 0xffffff)
      rectC(g, 8, -1, 3, 1, MID)
      rectC(g, 5, 1, 2, 3, DARK)
      return g
    }
    case 'rocket-trooper': {
      rectC(g, -2, -4, 6, 7, 0xffffff)
      circleC(g, 0, -7, 3, MID)
      rectC(g, -1, -8, 2, 2, LIGHT)
      rectC(g, -6, -3, 3, 4, SHADE)
      rectC(g, -2, 3, 2, 4, 0xffffff)
      rectC(g, 2, 3, 2, 4, 0xffffff)
      rectC(g, -4, 7, 3, 1.4, MID)
      rectC(g, 2, 7, 3, 1.4, MID)
      rectC(g, 2, -8, 9, 3, 0xffffff)
      rectC(g, 6, -7, 2, 5, MID)
      rectC(g, 10, -8, 2, 3, 0xffffff)
      circleC(g, 12, -6.5, 1.4, LIGHT)
      rectC(g, -5, -6, 2, 4, 0xffffff)
      return g
    }
    case 'assault-walker': {
      rectC(g, -5, -8, 14, 8, 0xffffff)
      rectC(g, -2, -7, 6, 5, DARK)
      circleC(g, 3, -9, 3, 0xffffff)
      circleC(g, 4, -9, 1.3, DARK)
      rectC(g, 8, -10, 6, 2, MID)
      rectC(g, 13, -11, 2, 4, DARK)
      rectC(g, -2, -2, 8, 3, 0xffffff)
      rectC(g, -4, 1, 3, 7, 0xffffff)
      rectC(g, 4, 1, 3, 7, 0xffffff)
      rectC(g, -6, 7, 7, 2, MID)
      rectC(g, 2, 7, 7, 2, MID)
      rectC(g, -1, -12, 3, 4, SHADE)
      return g
    }
    case 'aa-platform': {
      rectC(g, -10, -3, 20, 6, 0xffffff)
      rectC(g, -9, -1, 18, 2, MID)
      rectC(g, -4, -7, 8, 4, 0xffffff)
      circleC(g, 0, -9, 3.5, 0xffffff)
      rectC(g, 2, -12, 7, 2, MID)
      rectC(g, 2, -9.4, 7, 1.8, MID)
      rectC(g, 8, -12, 1.4, 4, DARK)
      rectC(g, -8, -5, 2, 4, SHADE)
      rectC(g, -9, -9, 3, 2, SHADE)
      return g
    }
    case 'artillery': {
      rectC(g, -14, -2, 28, 6, 0xffffff)
      rectC(g, -13, 2, 26, 3, MID)
      rectC(g, -13, -6, 8, 6, 0xffffff)
      rectC(g, -12, -5, 5, 3, DARK)
      rectC(g, -7, -7, 5, 5, 0xffffff)
      rectC(g, -6, -9, 20, 3, 0xffffff)
      rectC(g, 13, -10, 2, 5, DARK)
      rectC(g, 8, -7, 5, 2, MID)
      circleC(g, 10, 1.4, 2.4, 0xffffff)
      circleC(g, -4, 1.4, 2.4, 0xffffff)
      circleC(g, -10, 1.4, 2.4, 0xffffff)
      circleC(g, 10, 1.4, 1, DARK)
      circleC(g, -4, 1.4, 1, DARK)
      circleC(g, -10, 1.4, 1, DARK)
      return g
    }
    case 'engineer': {
      rectC(g, -11, -2, 22, 6, 0xffffff)
      rectC(g, -3, 2, 14, 3, MID)
      rectC(g, -8, -6, 8, 6, 0xffffff)
      rectC(g, -7, -5, 5, 3, DARK)
      rectC(g, -3, -4, 3, 2, DARK)
      circleC(g, -3, -4, 0.6, 0xffffff)
      rectC(g, 1, -6, 6, 4, 0xffffff)
      rectC(g, 6, -9, 2, 6, MID)
      circleC(g, 7, -10, 1.5, 0xffffff)
      rectC(g, -9, 2, 3, 1, LIGHT)
      circleC(g, -5, 0.8, 2, 0xffffff)
      circleC(g, 0, 0.8, 2, 0xffffff)
      circleC(g, 5, 0.8, 2, 0xffffff)
      circleC(g, 9, 0.8, 2, 0xffffff)
      circleC(g, 5, 0.8, 1, DARK)
      circleC(g, -5, 0.8, 1, DARK)
      circleC(g, 0, 0.8, 1, DARK)
      return g
    }
    case 'apc': {
      rectC(g, -13, -4, 26, 8, 0xffffff)
      rectC(g, -12, -3, 24, 5, MID)
      rectC(g, -9, -8, 16, 5, 0xffffff)
      rectC(g, -8, -7, 7, 4, DARK)
      rectC(g, -8, -6, 5, 1, LIGHT)
      rectC(g, 1, -7, 6, 4, 0xffffff)
      rectC(g, 2, -6, 3, 2, DARK)
      circleC(g, 7, -2.5, 1.6, 0xffffff)
      rectC(g, 10, -3, 3, 5, 0xffffff)
      rectC(g, -11, 2, 5, 1, LIGHT)
      circleC(g, -3, 3, 2, 0xffffff)
      circleC(g, 2, 3, 2, 0xffffff)
      circleC(g, -3, 3, 1, DARK)
      circleC(g, 2, 3, 1, DARK)
      return g
    }
    case 'fighter': {
      rectC(g, -7, -3, 17, 6, 0xffffff)
      rectC(g, 4, -3.5, 4, 3, DARK)
      g.poly([10, -2, 16, 0, 10, 2]).fill(0xffffff)
      g.poly([0, -3, -7, -11, -4, -11, 8, -3]).fill(0xffffff)
      g.poly([0, 3, -7, 11, -4, 11, 8, 3]).fill(0xffffff)
      g.poly([-6, -3, -11, -9, -8, -9, -2, -3]).fill(0xffffff)
      rectC(g, -12, -2, 5, 4, MID)
      rectC(g, -13, -1.5, 2, 3, DARK)
      rectC(g, -9, -1, 6, 1, SHADE)
      circleC(g, 5, -7, 2, 0xffffff)
      circleC(g, 5, -7, 1, DARK)
      return g
    }
    case 'carrier': {
      rectC(g, -16, -2, 32, 6, 0xffffff)
      rectC(g, -15, -1, 30, 3, MID)
      rectC(g, -11, -8, 20, 6, 0xffffff)
      rectC(g, -10, -7, 18, 3, DARK)
      rectC(g, 9, -6, 7, 3, 0xffffff)
      rectC(g, 10, -5, 4, 2, DARK)
      circleC(g, 0, -6, 1.6, 0xffffff)
      circleC(g, -6, -6, 1.6, 0xffffff)
      rectC(g, -12, 3, 8, 2, SHADE)
      rectC(g, 2, 3, 12, 2, SHADE)
      return g
    }
    case 'missile-boat': {
      rectC(g, -12, -2, 24, 6, 0xffffff)
      rectC(g, -11, -1, 22, 3, MID)
      rectC(g, -3, -7, 12, 5, 0xffffff)
      rectC(g, -2, -6, 10, 2, DARK)
      rectC(g, -11, -5, 7, 2, SHADE)
      rectC(g, 8, -9, 2, 4, MID)
      circleC(g, 9, -10, 1.4, 0xffffff)
      rectC(g, -9, 3, 7, 2, SHADE)
      rectC(g, 3, 3, 9, 2, SHADE)
      return g
    }
    default:
      rectC(g, -6, -6, 12, 12, 0xffffff)
      rectC(g, -4, -4, 8, 8, MID)
      return g
  }
}

function mediumBuildingShape(kind: string, g: Graphics): Graphics {
  switch (kind) {
    case 'command-center': {
      rectC(g, -13, -7, 26, 14, 0xffffff)
      rectC(g, -8, -8, 16, 2, LIGHT)
      g.poly([-8, -8, 0, -17, 8, -8]).fill(0xffffff)
      g.poly([-6, -8, 0, -15, 6, -8]).fill(MID)
      rectC(g, -1, -20, 2, 4, MID)
      circleC(g, 0, -22, 1.6, 0xffffff)
      rectC(g, -10, -3, 4, 3, DARK)
      rectC(g, 4, -3, 5, 3, DARK)
      rectC(g, -2, 1, 4, 4, DARK)
      rectC(g, -12, 4, 24, 1, SHADE)
      return g
    }
    case 'power-plant': {
      rectC(g, -9, -7, 18, 14, 0xffffff)
      circleC(g, 0, -2, 8, 0xffffff)
      g.poly([-8, -2, 0, -9, 8, -2]).fill(MID)
      rectC(g, -6, 2, 12, 2, SHADE)
      rectC(g, -2, -11, 3, 4, MID)
      rectC(g, -3, -12, 5, 1.4, LIGHT)
      g.poly([-12, -8, -7, -8, -9, 8, -14, 8]).fill(0xffffff)
      g.poly([-11, -7, -8.4, -7, -9.4, 6, -11, 6]).fill(MID)
      g.poly([7, -8, 12, -8, 14, 8, 9, 8]).fill(0xffffff)
      g.poly([8, -7, 11, -7, 10.4, 6, 9.2, 6]).fill(MID)
      rectC(g, 9, -15, 1.5, 10, MID)
      rectC(g, 6, -14, 8, 1, MID)
      circleC(g, 9, -16, 1.4, LIGHT)
      return g
    }
    case 'supply-dock': {
      rectC(g, -10, -8, 20, 15, 0xffffff)
      rectC(g, -12, -11, 24, 3, 0xffffff)
      rectC(g, -11, -10, 22, 1, DARK)
      rectC(g, -2, 1, 6, 6, DARK)
      rectC(g, -9, -4, 8, 5, SHADE)
      rectC(g, 1, -4, 7, 5, MID)
      rectC(g, -9, -3, 8, 1, LIGHT)
      rectC(g, 1, -3, 7, 1, LIGHT)
      rectC(g, -3, 7, 12, 2, SHADE)
      rectC(g, 9, -16, 2, 7, SHADE)
      rectC(g, 10, -17, 5, 2, MID)
      circleC(g, 15, -16, 1.5, 0xffffff)
      return g
    }
    case 'barracks': {
      rectC(g, -12, -6, 24, 14, 0xffffff)
      rectC(g, -12, -8, 4, 3, 0xffffff)
      rectC(g, -6, -8, 4, 3, 0xffffff)
      rectC(g, 0, -8, 4, 3, 0xffffff)
      rectC(g, 6, -8, 4, 3, 0xffffff)
      rectC(g, -12, -6, 24, 1, MID)
      rectC(g, -6, -2, 2, 3, DARK)
      rectC(g, 4, -2, 2, 3, DARK)
      rectC(g, -1, 2, 3, 6, DARK)
      circleC(g, 0.5, 2, 1.6, DARK)
      circleC(g, 0, 1.5, 1.3, LIGHT)
      rectC(g, -8, -3, 3, 2, DARK)
      rectC(g, 5, -3, 3, 2, DARK)
      circleC(g, -7, -4, 1.4, LIGHT)
      circleC(g, 6.5, -4, 1.4, LIGHT)
      circleC(g, -7, 8, 2.2, SHADE)
      circleC(g, -4, 8.6, 2.2, SHADE)
      circleC(g, 7, 8, 2.2, SHADE)
      rectC(g, -13, -7, 1, 15, SHADE)
      rectC(g, 12, -7, 1, 15, SHADE)
      rectC(g, 7, -17, 1, 9, MID)
      g.poly([8, -17, 13, -16, 8, -14]).fill(0xffffff)
      return g
    }
    case 'war-factory': {
      rectC(g, -13, -9, 26, 18, 0xffffff)
      rectC(g, -13, -11, 7, 4, 0xffffff)
      rectC(g, -6, -11, 7, 4, 0xffffff)
      rectC(g, 1, -11, 7, 4, 0xffffff)
      rectC(g, 8, -11, 6, 4, 0xffffff)
      rectC(g, -12, -10, 6, 1, MID)
      rectC(g, -5, -10, 6, 1, MID)
      rectC(g, 2, -10, 6, 1, MID)
      rectC(g, 9, -10, 5, 1, MID)
      rectC(g, -6, 3, 12, 7, DARK)
      rectC(g, -6, 5, 12, 1, MID)
      rectC(g, -11, -4, 22, 2, SHADE)
      rectC(g, -10, -16, 2, 6, MID)
      rectC(g, 9, -16, 2, 6, MID)
      rectC(g, -10, -17, 2, 1, LIGHT)
      rectC(g, 9, -17, 2, 1, LIGHT)
      return g
    }
    case 'turret': {
      circleC(g, 0, 1, 7, 0xffffff)
      rectC(g, -6, 3, 12, 3, MID)
      rectC(g, -6, -3, 12, 5, 0xffffff)
      rectC(g, -3, -2, 6, 3, MID)
      rectC(g, 6, -1, 11, 2, MID)
      rectC(g, 16, -1.5, 2, 3, DARK)
      rectC(g, 6, -3.4, 9, 1.5, SHADE)
      rectC(g, -8, -4, 2, 7, SHADE)
      rectC(g, 6, -4, 2, 7, SHADE)
      return g
    }
    case 'tech-center': {
      rectC(g, -10, -8, 20, 18, 0xffffff)
      circleC(g, 0, -2, 7, 0xffffff)
      circleC(g, 0, -3, 3, DARK)
      g.poly([7, -2, 14, -11, 14, -2]).fill(SHADE)
      rectC(g, 6, -2, 2, 3, MID)
      rectC(g, -13, -6, 3, 10, SHADE)
      rectC(g, 10, -6, 3, 9, SHADE)
      rectC(g, -7, 4, 14, 2, MID)
      rectC(g, -7, 3, 3, 1, LIGHT)
      rectC(g, 4, 3, 3, 1, LIGHT)
      circleC(g, 0, -2, 1.2, LIGHT)
      return g
    }
    case 'air-force': {
      rectC(g, -12, -2, 9, 13, 0xffffff)
      rectC(g, 3, -3, 9, 12, 0xffffff)
      rectC(g, -14, -3, 11, 2, DARK)
      rectC(g, 2, -4, 10, 2, DARK)
      rectC(g, 3, -13, 8, 9, 0xffffff)
      rectC(g, 1, -16, 12, 3, 0xffffff)
      rectC(g, 2, -15, 10, 2, DARK)
      g.poly([2, -16, 4, -22, 2, -22]).fill(MID)
      rectC(g, -8, 5, 22, 1, SHADE)
      rectC(g, -10, 8, 24, 1, SHADE)
      return g
    }
    case 'super-weapon': {
      rectC(g, -14, -3, 28, 9, 0xffffff)
      rectC(g, -15, -6, 2, 9, MID)
      rectC(g, 13, -6, 2, 9, MID)
      g.poly([-10, -11, 12, -7, 12, -3, -10, -7]).fill(0xffffff)
      rectC(g, 12, -8, 3, 5, DARK)
      rectC(g, -6, -4, 3, 7, MID)
      circleC(g, -2, -4, 4, 0xffffff)
      circleC(g, -2, -4, 2, DARK)
      rectC(g, -13, 5, 26, 1, SHADE)
      return g
    }
    case 'dock': {
      rectC(g, -13, -9, 26, 18, 0xffffff)
      rectC(g, -13, -11, 10, 4, 0xffffff)
      rectC(g, -3, -11, 10, 4, 0xffffff)
      rectC(g, -12, -10, 9, 1, MID)
      rectC(g, -2, -10, 9, 1, MID)
      rectC(g, -6, 3, 12, 6, MID)
      rectC(g, -6, 3, 12, 1, LIGHT)
      rectC(g, -4, 9, 8, 4, SHADE)
      rectC(g, -12, -2, 24, 1, SHADE)
      rectC(g, 9, -17, 2, 7, SHADE)
      rectC(g, 10, -18, 5, 2, MID)
      g.poly([6, -18, 12, -18, 9, -14]).fill(0xffffff)
      circleC(g, 12, -17, 1.5, 0xffffff)
      return g
    }
    default:
      rectC(g, -9, -9, 18, 18, 0xffffff)
      rectC(g, -7, -7, 14, 14, MID)
      return g
  }
}

function mediumObstacleShape(kind: string, g: Graphics): Graphics {
  switch (kind) {
    case 'rock': {
      g.poly([-15, -2, -10, -11, -2, -14, 8, -12, 15, -3, 12, 8, -2, 11, -13, 8]).fill(0xffffff)
      g.poly([-9, -9, -2, -12, 3, -11, 6, -9, 2, -6, -5, -6]).fill(SHADE)
      g.poly([-6, -2, 0, -4, 3, -1, 1, 3, -4, 2]).fill(MID)
      g.poly([9, -2, 12, -3, 12, 4, 9, 5]).fill(SHADE)
      rectC(g, -1, -11, 3, 2, MID)
      rectC(g, -10, 4, 3, 2, MID)
      rectC(g, 3, 7, 3, 2, MID)
      circleC(g, -12, 5, 1.6, MID)
      circleC(g, 4, -10, 1.6, LIGHT)
      return g
    }
    case 'wreck': {
      rectC(g, -14, -5, 26, 10, 0xffffff)
      rectC(g, -12, -3, 22, 6, MID)
      rectC(g, -11, -4, 6, 2, DARK)
      rectC(g, -0, -2, 8, 2, DARK)
      rectC(g, 6, 1, 7, 2, SHADE)
      g.poly([-13, -7, -7, -7, -13, 2]).fill(MID)
      rectC(g, -12, -8, 7, 2, DARK)
      circleC(g, 12, 2, 3, SHADE)
      circleC(g, 12, 2, 1, DARK)
      rectC(g, -4, 4, 4, 2, DARK)
      rectC(g, -9, 4, 3, 3, SHADE)
      circleC(g, 0, -9, 2, LIGHT)
      circleC(g, 0, -10, 1.2, SHADE)
      return g
    }
    case 'tree': {
      circleC(g, 0, -7, 10, 0xffffff)
      circleC(g, -6, -10, 6, 0xffffff)
      circleC(g, 6, -10, 6, 0xffffff)
      circleC(g, 0, -13, 6, 0xffffff)
      circleC(g, 0, -9, 7, MID)
      circleC(g, 0, -13, 3, LIGHT)
      circleC(g, -4, -7, 2.4, LIGHT)
      circleC(g, 4, -6, 2, LIGHT)
      rectC(g, -2, 4, 4, 8, SHADE)
      rectC(g, -3, 3, 6, 2, MID)
      rectC(g, -5, 10, 3, 2, DARK)
      rectC(g, 2, 10, 3, 2, DARK)
      circleC(g, 1, 4, 1.2, LIGHT)
      return g
    }
    case 'mine': {
      circleC(g, 0, 0, 5.5, 0xffffff)
      circleC(g, 0, 0, 3.6, MID)
      rectC(g, -2, -4, 4, 8, DARK)
      circleC(g, -2.4, -1.4, 1.2, LIGHT)
      circleC(g, 2.4, -1.4, 1.2, LIGHT)
      return g
    }
    default:
      circleC(g, 0, 0, 6, 0xffffff)
      circleC(g, 0, 0, 3, MID)
      return g
  }
}

export function textureFor(kind: 'unit' | 'building', type: string, renderer: PixiRenderer): Texture {
  const quality = getGraphics().quality
  const medium = quality === 'medium' || quality === 'high'
  const key = `${quality}:${kind}-${type}`
  const hit = cache.get(key)
  if (hit) return hit
  const g = new Graphics()
  if (medium) {
    if (kind === 'unit') mediumUnitShape(type, g)
    else mediumBuildingShape(type, g)
  } else if (kind === 'unit') unitShape(type, g)
  else buildingShape(type, g)
  const tex = renderer.generateTexture({ target: g, resolution: 8, antialias: true })
  g.destroy()
  cache.set(key, tex)
  return tex
}

export function obstacleTexture(kind: string, renderer: PixiRenderer): Texture {
  const quality = getGraphics().quality
  const medium = quality === 'medium' || quality === 'high'
  const key = `${quality}:obstacle-${kind}`
  const hit = cache.get(key)
  if (hit) return hit
  const g = new Graphics()
  if (medium) mediumObstacleShape(kind, g)
  else obstacleShape(kind, g)
  const tex = renderer.generateTexture({ target: g, resolution: 8, antialias: true })
  g.destroy()
  cache.set(key, tex)
  return tex
}

export function fieldTexture(renderer: PixiRenderer): Texture {
  const key = 'field'
  const hit = cache.get(key)
  if (hit) return hit
  const g = new Graphics()
  g.poly([0, -16, 32, 0, 0, 16, -32, 0]).fill({ color: 0xffffff, alpha: 0.9 }).stroke({ color: 0xffffff, width: 2 })
  g.poly([0, -9, 18, 0, 0, 9, -18, 0]).stroke({ color: 0x2c2c2c, alpha: 0.35, width: 1 })
  const tex = renderer.generateTexture({ target: g, resolution: 8, antialias: true })
  g.destroy()
  cache.set(key, tex)
  return tex
}

export function supplyIconTexture(renderer: PixiRenderer): Texture {
  const quality = getGraphics().quality
  const key = `${quality}:icon-supply`
  const hit = cache.get(key)
  if (hit) return hit
  const g = new Graphics()
  if (quality === 'medium' || quality === 'high') {
    rectC(g, -10, -2, 12, 7, 0xffffff)
    rectC(g, -10, -2, 12, 1.6, SHADE)
    rectC(g, 0, -2, 10, 7, 0xffffff)
    rectC(g, 0, -2, 10, 1.6, MID)
    rectC(g, -6, -9, 12, 7, 0xffffff)
    rectC(g, -6, -9, 12, 1.6, SHADE)
    rectC(g, -3, -6, 6, 2, 0xffffff)
    circleC(g, 6, 4, 1.4, LIGHT)
    circleC(g, -8, -11, 1.4, DARK)
  } else {
    rectC(g, -7, -6, 14, 12, 0xffffff)
    rectC(g, -7, -6, 14, 2, MID)
    rectC(g, -2, -6, 3, 12, SHADE)
    rectC(g, -1, -1, 14, 2, DARK)
  }
  const tex = renderer.generateTexture({ target: g, resolution: 8, antialias: true })
  g.destroy()
  cache.set(key, tex)
  return tex
}

export function oilIconTexture(renderer: PixiRenderer): Texture {
  const quality = getGraphics().quality
  const key = `${quality}:icon-oil`
  const hit = cache.get(key)
  if (hit) return hit
  const g = new Graphics()
  if (quality === 'medium' || quality === 'high') {
    rectC(g, -10, 2, 20, 3, 0xffffff)
    rectC(g, -8, -8, 4, 10, SHADE)
    g.poly([-10, -1, -2, -11, 2, -5, -4, 0]).fill(0xffffff)
    g.poly([0, -4, 8, 2, 10, 2, 4, -6]).fill(MID)
    rectC(g, -12, -10, 20, 2, 0xffffff)
    rectC(g, -12, -10, 20, 2, MID)
    rectC(g, -15, -12, 3, 4, DARK)
    rectC(g, 11, -12, 3, 6, 0xffffff)
    rectC(g, 11, -12, 3, 1, MID)
    circleC(g, 12, 7, 2, SHADE)
    circleC(g, 12, 7, 1, DARK)
  } else {
    rectC(g, -1, -8, 2, 12, 0xffffff)
    rectC(g, -7, -7, 12, 2, 0xffffff)
    rectC(g, 4, -6, 7, 2, MID)
    circleC(g, 12, -5, 2, 0xffffff)
    circleC(g, -4, 4, 3, DARK)
    rectC(g, -8, 8, 16, 2, MID)
  }
  const tex = renderer.generateTexture({ target: g, resolution: 8, antialias: true })
  g.destroy()
  cache.set(key, tex)
  return tex
}

export function lightningTexture(renderer: PixiRenderer): Texture {
  const key = 'lightning'
  const hit = cache.get(key)
  if (hit) return hit
  const g = new Graphics()
  g.poly([-3, -14, 1, -5, -2, -5, 3, 4, 0, 4, 3, 14, -2, 4, 1, 4, -4, -6, -1, -6, -6, -14]).fill(0xffe066).stroke({ color: 0xffffff, width: 1 })
  const tex = renderer.generateTexture({ target: g, resolution: 8, antialias: true })
  g.destroy()
  cache.set(key, tex)
  return tex
}

export function flagTexture(renderer: PixiRenderer): Texture {
  const key = 'flag'
  const hit = cache.get(key)
  if (hit) return hit
  const g = new Graphics()
  g.rect(-1.5, -12, 3, 24).fill(0xffffff)
  g.circle(-1.5, 12, 2.2).fill(0xffffff)
  g.poly([-1.5, -11, 13, -7, -1.5, -3]).fill(0xffffff)
  g.poly([-1.5, -11, 13, -7, -1.5, -3]).stroke({ color: 0x000000, width: 0.5, alpha: 0.25 })
  const tex = renderer.generateTexture({ target: g, resolution: 8, antialias: true })
  g.destroy()
  cache.set(key, tex)
  return tex
}

export function clearShapeCache(): void {
  cache.forEach((t) => t.destroy())
  cache.clear()
}
