import { useEffect, useRef } from 'react'

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

export function DarkNoiseField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return undefined

    let width = 0
    let height = 0
    let field = new Float32Array(0)
    let next = new Float32Array(0)
    let image = context.createImageData(1, 1)
    let animationFrame = 0
    let renderedFrames = 0
    let previousTime = 0
    let seed = 0x6d757070
    const frameInterval = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 52 : 41

    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }

    const reset = () => {
      const cellSize = window.innerWidth <= 660 ? 4.4 : 5
      width = Math.max(96, Math.min(360, Math.ceil(window.innerWidth / cellSize)))
      height = Math.max(96, Math.min(240, Math.ceil(window.innerHeight / cellSize)))
      canvas.width = width
      canvas.height = height
      field = new Float32Array(width * height)
      next = new Float32Array(width * height)
      image = context.createImageData(width, height)

      for (let index = 0; index < field.length; index += 1) {
        field[index] = random()
      }
    }

    const draw = (time: number) => {
      if (time - previousTime >= frameInterval) {
        previousTime = time
        const pixels = image.data

        for (let y = 0; y < height; y += 1) {
          const row = y * width
          const rowAbove = (y === 0 ? height - 1 : y - 1) * width
          const rowBelow = (y === height - 1 ? 0 : y + 1) * width

          for (let x = 0; x < width; x += 1) {
            const index = row + x
            const left = row + (x === 0 ? width - 1 : x - 1)
            const right = row + (x === width - 1 ? 0 : x + 1)
            const neighbours = (field[left] + field[right] + field[rowAbove + x] + field[rowBelow + x]) * 0.25
            const freshNoise = random()
            const wave = (Math.sin(x * 0.105 + time * 0.00052) + Math.cos(y * 0.12 - time * 0.00037)) * 0.026
            const value = Math.max(0, Math.min(1, field[index] * 0.44 + neighbours * 0.2 + freshNoise * 0.36 + wave))
            const chroma = (random() - 0.5) * 11
            const pixel = index * 4

            next[index] = value
            pixels[pixel] = clampByte(20 + value * 53 + chroma * 0.38)
            pixels[pixel + 1] = clampByte(27 + value * 61 + chroma * 0.22)
            pixels[pixel + 2] = clampByte(39 + value * 77 - chroma * 0.2)
            pixels[pixel + 3] = 255
          }
        }

        const previousField = field
        field = next
        next = previousField
        context.putImageData(image, 0, 0)
        renderedFrames += 1
        canvas.dataset.frame = String(renderedFrames)
      }

      animationFrame = window.requestAnimationFrame(draw)
    }

    reset()
    animationFrame = window.requestAnimationFrame(draw)
    window.addEventListener('resize', reset)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', reset)
    }
  }, [])

  return (
    <div className="dark-motion-field" aria-hidden="true">
      <canvas ref={canvasRef} className="dark-motion-canvas" data-frame="0" />
    </div>
  )
}
