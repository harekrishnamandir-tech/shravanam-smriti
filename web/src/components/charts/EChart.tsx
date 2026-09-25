import { BarChart, HeatmapChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import { useTheme } from '../../lib/theme'

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkLineComponent,
  CanvasRenderer,
])

export type EChartsOption = echarts.EChartsCoreOption
export type ChartClick = { seriesIndex?: number; dataIndex: number; data: unknown; name: string; value: unknown }

/**
 * Thin ECharts wrapper. `build` is called with the current theme so options can
 * read CSS variables; the chart re-renders when the theme or options change.
 */
export function EChart({
  build,
  deps,
  height = 280,
  onClick,
  ariaLabel,
}: {
  build: () => EChartsOption
  deps: unknown[]
  height?: number
  onClick?: (p: ChartClick) => void
  ariaLabel: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const clickRef = useRef(onClick)
  clickRef.current = onClick
  const theme = useTheme()

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' })
    chart.current = c
    c.on('click', (p) => clickRef.current?.(p as unknown as ChartClick))
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(build(), { notMerge: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ...deps])

  return <div ref={el} role="img" aria-label={ariaLabel} style={{ height, width: '100%' }} />
}
