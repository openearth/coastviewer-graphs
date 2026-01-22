<template>
  <!-- Side panel (left) + charts (right) -->
  <div class="layout">
    <SidePanel :transect-num="currentTransectNum" />
    <div class="chart-wrap">
      <div ref="chartRef" class="chart"></div>
      <div ref="basalChartRef" class="chart"></div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import * as echarts from 'echarts'
import SidePanel from '@/components/SidePanel.vue'

const DEFAULT_TRANSECT_NUMBER = 1000475

const route = useRoute()
const store = useAppStore()

// Debounce utility for performance optimization
function debounce (func, wait) {
  let timeout
  return function executedFunction (...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Store-derived data for charting
const chartReady     = computed(() => store.chartReady)
const years          = computed(() => store.years)
const crossShore     = computed(() => store.crossShore)
const altitudeByYear = computed(() => store.altitudeByYear)

// Basal coastline data
const basalReady = computed(() => store.basalReady)
const basalYears = computed(() => store.basalYears)
const basalCoastline = computed(() => store.basalCoastline)
const basalDataPoints = computed(() => store.basalDataPoints)

// Current transect number from route (fallback to default)
const currentTransectNum = computed(() => {
  const raw = route.params.transectNum
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TRANSECT_NUMBER
})

// Catalog and index lookup
const idList = computed(() => store.idList)
const wantedIndex = computed(() => {
  if (!idList.value || idList.value.length === 0) return -1
  return idList.value.indexOf(currentTransectNum.value)
})
const indexNotFound = computed(() => wantedIndex.value < 0)

const url = computed(() => {
  if (indexNotFound.value) return ''
  const idx = wantedIndex.value
  return `https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?cross_shore[0:1:2462],time[0:1:59],altitude[0:1:59][${idx}][0:1:2462]`
})

async function fetchNow () {
  if (indexNotFound.value) return
  await store.fetchOpendapAscii(url.value)
}

/* -------------------- Jet colormap utility -------------------- */
function createJetColormap (n) {
  if (!Number.isFinite(n) || n <= 0) return []
  if (n === 1) return ['rgb(0,0,131)'] // arbitrary single color

  function jetRGB (t) {
    t = Math.max(0, Math.min(1, t))
    const r = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 3)))
    const g = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 2)))
    const b = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 1)))
    const gamma = 0.9
    const to255 = (x) => Math.round(255 * Math.pow(x, gamma))
    return `rgb(${to255(r)},${to255(g)},${to255(b)})`
  }

  const colors = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : 1 - i / (n - 1) // reversed: red → blue
    colors.push(jetRGB(t))
  }
  return colors
}

/* -------------------- ECharts setup -------------------- */
const chartRef = ref(null)
let chart = null

const basalChartRef = ref(null)
let basalChart = null

function disposeChart () {
  if (chart) {
    chart.dispose()
    chart = null
  }
}

function disposeBasalChart () {
  if (basalChart) {
    basalChart.dispose()
    basalChart = null
  }
}

// Memoize expensive computations using computed properties
const xAxisBounds = computed(() => {
  const xs = crossShore.value || []
  const byYear = altitudeByYear.value || []
  if (!xs.length || !byYear.length) {
    return { min: null, max: null }
  }

  // Optimize: use Set for faster lookup, single pass
  const used = new Set()
  for (let t = 0; t < byYear.length; t++) {
    const row = byYear[t]
    if (!row) continue
    for (let i = 0; i < Math.min(row.length, xs.length); i++) {
      const v = row[i]
      if (v != null && Number.isFinite(v)) {
        used.add(i)
      }
    }
  }

  if (used.size === 0) {
    return { min: Math.min(...xs), max: Math.max(...xs) }
  }

  const usedXs = Array.from(used).map(i => xs[i])
  return { min: Math.min(...usedXs), max: Math.max(...usedXs) }
})

// Find the cross_shore position to mark (closest to 0) - memoized
const rspX = computed(() => {
  const xs = crossShore.value || []
  if (!xs.length) return null
  let closest = xs[0]
  let best = Math.abs(xs[0])
  for (let i = 1; i < xs.length; i++) {
    const d = Math.abs(xs[i])
    if (d < best) { best = d; closest = xs[i] }
  }
  return closest
})

// Memoize series data
const seriesData = computed(() => {
  const ys = years.value || []
  const xs = crossShore.value || []
  const byYear = altitudeByYear.value || []
  if (!ys.length || !xs.length || !byYear.length) return []

  const rspXVal = rspX.value

  return ys.map((label, tIndex) => {
    const row = byYear[tIndex] || []
    // Pre-allocate array for better performance
    const points = new Array(xs.length)
    for (let i = 0; i < xs.length; i++) {
      points[i] = row[i] == null ? [xs[i], null] : [xs[i], row[i]]
    }

    // Attach the vertical markLine to the first series so it spans the chart
    const seriesObj = {
      name: label,
      type: 'line',
      showSymbol: false,
      connectNulls: true,
      data: points,
    }

    if (tIndex === 0 && rspXVal != null && Number.isFinite(rspXVal)) {
      seriesObj.markLine = {
        symbol: 'none',
        lineStyle: { color: '#000', width: 1.5, type: 'dashed' },
        label: {
          formatter: '{b}',
          position: 'insideEndTop'
        },
        data: [{
          name: 'RSP Lijn',
          xAxis: rspXVal,
          itemStyle: { color: '#000' }
        }]
      }
    }
    return seriesObj
  })
})

// Memoize color palette
const colorPalette = computed(() => {
  return createJetColormap(seriesData.value.length)
})

// Helper to extract x/y robustly from tooltip param
function getXY (p) {
  if (Array.isArray(p?.value)) return { x: p.value[0], y: p.value[1] }
  if (Array.isArray(p?.data))  return { x: p.data[0],  y: p.data[1]  }
  return { x: p?.axisValue, y: p?.value }
}

function renderChart () {
  try {
    if (!chartRef.value) return
    if (!chart) {
      chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
      window.addEventListener('resize', handleResize)
    }

    // Use memoized values for better performance
    const { min: xMin, max: xMax } = xAxisBounds.value
    const series = seriesData.value
    const palette = colorPalette.value

    const option = {
      animation: true,
      color: palette,
      title: {
        text: `Transect ${currentTransectNum.value}`,
        left: 'center',
        top: 8,
        textStyle: {
          fontSize: 24,
          fontWeight: '600',
        },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params]
          const valid = arr.filter(p => {
            const { y } = getXY(p)
            return y != null && Number.isFinite(Number(y))
          })
          if (valid.length === 0) return ''
          const { x } = getXY(valid[0])
          const header = `<b>Cross-shore: ${x} m</b>`
          const lines = valid.map(p => {
            const { y } = getXY(p)
            const marker = p.marker || ''
            return `<b>${marker}${p.seriesName}</b>: ${y} m`
          })
          return [header, ...lines].join('<br/>')
        },
        showDelay: 0,
        hideDelay: 50,
        confine: true,
      },
      legend: {
        top: 56,
        selector: [{ title: 'All' }],
        selectorPosition: 'start',
      },
      grid: {
        top: 142,
        right: 72,
        bottom: 96,
        left: 72,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        name: 'Cross-shore (m)',
        nameLocation: 'middle',
        nameGap: 32,
        min: xMin,
        max: xMax,
        axisLine: { onZero: false },
      },
      yAxis: {
        type: 'value',
        name: 'Elevation (m)',
        nameLocation: 'middle',
        nameGap: 42,
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0 },
        { type: 'slider', xAxisIndex: 0, height: 18, bottom: 24 }
      ],
      series,
      progressive: 2000,
      progressiveThreshold: 10000,
    }

    chart.setOption(option, true)
  } catch (e) {
    console.error('ECharts render error:', e)
  }
}

function renderBasalChart () {
  try {
    if (!basalChartRef.value) return
    if (!basalChart) {
      basalChart = echarts.init(basalChartRef.value, undefined, { renderer: 'canvas' })
      window.addEventListener('resize', handleBasalResize)
    }

    const years = basalYears.value || []
    const values = basalCoastline.value || []

    if (years.length === 0 || values.length === 0) {
      return
    }

    const option = {
      animation: true,
      title: {
        text: 'Basal Coastline Over Time',
        left: 'center',
        top: 8,
        textStyle: {
          fontSize: 20,
          fontWeight: '600',
        },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params]
          if (arr.length === 0) return ''
          const p = arr[0]
          const year = p.axisValue
          const value = p.value
          if (value == null || !Number.isFinite(value)) return ''
          return `<b>Year: ${year}</b><br/>Basal Coastline: ${value} m`
        },
        showDelay: 0,
        hideDelay: 50,
        confine: true,
      },
      grid: {
        top: 60,
        right: 40,
        bottom: 60,
        left: 70,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        name: 'Year',
        nameLocation: 'middle',
        nameGap: 30,
        data: years,
        axisLabel: {
          rotate: 45,
        },
      },
      yAxis: {
        type: 'value',
        name: 'Cross-shore distance (m)',
        nameLocation: 'middle',
        nameGap: 50,
      },
      series: [
        {
          name: 'Basal Coastline',
          type: 'line',
          data: values,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 6,
          connectNulls: false,
          lineStyle: {
            width: 0, // Hide the line, show only dots
          },
          itemStyle: {
            color: '#9C27B0',
          },
        },
      ],
    }

    basalChart.setOption(option, true)
  } catch (e) {
    console.error('Basal chart render error:', e)
  }
}

function handleResize () {
  if (chart) chart.resize()
  if (basalChart) basalChart.resize()
}

function handleBasalResize () {
  if (basalChart) basalChart.resize()
}

// Debounced render function for better performance
const debouncedRender = debounce(() => {
  if (chartReady.value) {
    nextTick().then(renderChart)
  }
}, 100) // 100ms debounce

async function fetchBasalNow () {
  if (indexNotFound.value) return
  const idx = wantedIndex.value
  await store.fetchBasalCoastline(idx)
}

onMounted(async () => {
  // Fetch in parallel instead of sequentially for faster initial load
  await Promise.all([
    store.fetchTransectIdList(),
    store.fetchAlongshoreList()
  ])

  if (!indexNotFound.value) {
    await Promise.all([
      fetchNow(),
      fetchBasalNow()
    ])
  }
  await nextTick()
  renderChart()
  renderBasalChart()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('resize', handleBasalResize)
  disposeChart()
  disposeBasalChart()
})

// Debounced render for basal chart
const debouncedRenderBasal = debounce(() => {
  if (basalReady.value) {
    nextTick().then(renderBasalChart)
  }
}, 100)

// Re-render when data changes (debounced for better performance)
watch([chartReady, years, crossShore, altitudeByYear], debouncedRender, { 
  deep: false // Shallow watch is faster
})

// Re-render basal chart when data changes
watch([basalReady, basalYears, basalCoastline], debouncedRenderBasal, {
  deep: false
})

// Re-fetch & re-render on route change (different transect) - debounced
watch(() => route.params.transectNum, debounce(async () => {
  if (!store.idList?.length) {
    await store.fetchTransectIdList()
  }
  if (!store.alongshoreList?.length) {
    await store.fetchAlongshoreList()
  }
  if (!indexNotFound.value) {
    await Promise.all([
      fetchNow(),
      fetchBasalNow()
    ])
  }
  await nextTick()
  renderChart()
  renderBasalChart()
}, 150))
</script>

<style scoped>
.layout {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 1200px;
}

.chart-wrap {
  flex: 1;
  min-width: 0;
  padding: 0 24px;
  overflow: visible;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.chart {
  width: 100%;
  height: 600px;
}
</style>
