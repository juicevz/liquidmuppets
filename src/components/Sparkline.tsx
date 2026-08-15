interface SparklineProps {
  values: number[]
  negative?: boolean
  width?: number
  height?: number
}

export function Sparkline({ values, negative = false, width = 132, height = 42 }: SparklineProps) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width
      const y = height - 5 - ((value - min) / range) * (height - 10)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const areaPoints = `0,${height} ${points} ${width},${height}`

  return (
    <svg className={`sparkline${negative ? ' negative' : ''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Simulated trend">
      <polygon points={areaPoints} />
      <polyline points={points} />
    </svg>
  )
}
