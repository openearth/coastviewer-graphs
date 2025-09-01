<template>
  <!-- Only the chart -->
  <div ref="chartRef" class="chart"></div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import * as echarts from 'echarts'

const DEFAULT_TRANSECT_NUMBER = 1000475

const route = useRoute()
const store = useAppStore()

// Store-derived data for charting
const chartReady     = computed(() => store.chartReady)
const years          = computed(() => store.years)
const crossShore     = computed(() => store.crossShore)
const altitudeByYear = computed(() => store.altitudeByYear)

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

function disposeChart () {
  if (chart) {
    chart.dispose()
    chart = null
  }
}

function computeXAxisBounds () {
  const xs = crossShore.value || []
  const byYear = altitudeByYear.value || []
  if (!xs.length || !byYear.length) {
    return { min: null, max: null }
  }

  // Keep only cross_shore positions that contain at least one non-null value
  const used = []
  for (let i = 0; i < xs.length; i++) {
    let ok = false
    for (let t = 0; t < byYear.length; t++) {
      const v = byYear[t]?.[i]
      if (v != null && Number.isFinite(v)) { ok = true; break }
    }
    if (ok) used.push(xs[i])
  }
  if (!used.length) return { min: Math.min(...xs), max: Math.max(...xs) }
  return { min: Math.min(...used), max: Math.max(...used) }
}

// Find the cross_shore position to mark (closest to 0)
function computeRspX () {
  const xs = crossShore.value || []
  if (!xs.length) return null
  let closest = xs[0]
  let best = Math.abs(xs[0])
  for (let i = 1; i < xs.length; i++) {
    const d = Math.abs(xs[i])
    if (d < best) { best = d; closest = xs[i] }
  }
  return closest
}

function buildSeries (rspX) {
  const ys = years.value || []
  const xs = crossShore.value || []
  const byYear = altitudeByYear.value || []
  if (!ys.length || !xs.length || !byYear.length) return []

  return ys.map((label, tIndex) => {
    const row = byYear[tIndex] || []
    const points = xs.map((x, i) => (row[i] == null ? [x, null] : [x, row[i]]))

    // Attach the vertical markLine to the first series so it spans the chart
    const seriesObj = {
      name: label,
      type: 'line',
      showSymbol: false,
      connectNulls: true,
      data: points,
    }

    if (tIndex === 0 && rspX != null && Number.isFinite(rspX)) {
      seriesObj.markLine = {
        symbol: 'none',
        lineStyle: { color: '#000', width: 1.5, type: 'dashed' },
        label: {
          formatter: '{b}',
          position: 'insideEndTop'
        },
        data: [{
          name: 'RSP Lijn',
          xAxis: rspX,               // numeric x-axis value (meters)
          itemStyle: { color: '#000' }
        }]
      }
    }
    return seriesObj
  })
}

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

    const { min: xMin, max: xMax } = computeXAxisBounds()
    const rspX = computeRspX()
    const series = buildSeries(rspX)
    const palette = createJetColormap(series.length)

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
          const header = `cross_shore: ${x}`
          const lines = valid.map(p => {
            const { y } = getXY(p)
            const marker = p.marker || ''
            return `${marker}${p.seriesName}: ${y}`
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
      grid: { top: 142, right: 42, bottom: 96, left: 56 },
      xAxis: {
        type: 'value',                 // numeric axis
        name: 'cross_shore (m)',
        nameLocation: 'middle',
        nameGap: 32,
        min: xMin,
        max: xMax,
        axisLine: { onZero: false },
      },
      yAxis: {
        type: 'value',
        name: 'altitude (m)',
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

function handleResize () {
  if (chart) chart.resize()
}

onMounted(async () => {
  await store.fetchTransectIdList()
  if (!indexNotFound.value) {
    await fetchNow()
  }
  await nextTick()
  renderChart()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  disposeChart()
})

// Re-render when data changes
watch([chartReady, years, crossShore, altitudeByYear], () => {
  if (chartReady.value) nextTick().then(renderChart)
})

// Re-fetch & re-render on route change (different transect)
watch(() => route.params.transectNum, async () => {
  if (!store.idList?.length) {
    await store.fetchTransectIdList()
  }
  if (!indexNotFound.value) {
    await fetchNow()
  }
  await nextTick()
  renderChart()
})
</script>

<style scoped>
.chart {
  padding-left: 80px;
  padding-right: 80px;
  width: 100%;
  height: 600px;
}
</style>
