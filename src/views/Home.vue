<template>
  <!-- Side panel (left) + charts (right) -->
  <div class="layout">
    <SidePanel :transect-num="currentTransectNum" />
    <div class="chart-wrap">
      <div ref="chartRef" class="chart" />
      <div ref="basalChartRef" class="chart" />
      <div ref="mhwChartRef" class="chart" />
      <div class="nourishments-chart-wrap">
        <div class="nourishments-controls">
          <button
            class="nourishments-ctrl-btn"
            type="button"
            @click="toggleNourishmentsEmptyYears"
          >
            {{ nourishmentsHideEmptyYears ? 'Show years with no data' : 'Hide years without data' }}
          </button>
          <button
            class="nourishments-ctrl-btn"
            type="button"
            @click="selectAllNourishmentsSeries"
          >
            All
          </button>
          <button
            v-for="s in NOURISHMENT_SERIES"
            :key="s.key"
            class="nourishments-legend-item"
            :class="{ inactive: !nourishmentsLegendSelected[s.label] }"
            type="button"
            @click="toggleNourishmentsSeries(s.label)"
          >
            <span
              class="nourishments-legend-swatch"
              :style="{ backgroundColor: s.color }"
            />
            {{ s.label }}
          </button>
        </div>
        <div ref="nourishmentsChartRef" class="chart" />
      </div>
    </div>
  </div>
</template>

<script setup>
  import * as echarts from 'echarts'
  import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
  import { useRoute } from 'vue-router'
  import SidePanel from '@/components/SidePanel.vue'
  import { useAppStore } from '@/stores/app'

  const DEFAULT_TRANSECT_NUMBER = 1_000_475

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
  const chartReady = computed(() => store.chartReady)
  const years = computed(() => store.years)
  const crossShore = computed(() => store.crossShore)
  const altitudeByYear = computed(() => store.altitudeByYear)

  // Basal coastline data
  const basalReady = computed(() => store.basalReady)
  const basalYears = computed(() => store.basalYears)
  const basalCoastline = computed(() => store.basalCoastline)
  const testingCoastline = computed(() => store.testingCoastline)

  // Momentary coastline data
  const momentaryReady = computed(() => store.momentaryReady)
  const momentaryCoastline = computed(() => store.momentaryCoastline)

  // Mean high/low water cross data
  const mhwReady = computed(() => store.mhwReady)
  const mhwYears = computed(() => store.mhwYears)
  const meanHighWaterCross = computed(() => store.meanHighWaterCross)
  const meanLowWaterCross = computed(() => store.meanLowWaterCross)

  // Dune foot threeNAP cross data
  const dfReady = computed(() => store.dfReady)
  const duneFootThreeNAPCross = computed(() => store.duneFootThreeNAPCross)

  // Nourishments (volume per type)
  const nourishmentsReady = computed(() => store.nourishmentsReady)
  const nourishmentsYears = computed(() => store.nourishmentsYears)
  const nourishmentsByType = computed(() => store.nourishmentsByType)

  const NOURISHMENT_SERIES = [
    { key: 'beach', label: 'Strand', color: '#e4e472' },
    { key: 'shoreface', label: 'Vooroever', color: '#72a8e4' },
    { key: 'dune', label: 'Duin', color: '#e4a872' },
    { key: 'channel_wall', label: 'Geulwand', color: '#ababab' },
    { key: 'other', label: 'Anders', color: '#e472e4' },
  ]

  const nourishmentsHideEmptyYears = ref(false)
  const nourishmentsLegendSelected = reactive(
    Object.fromEntries(NOURISHMENT_SERIES.map(s => [s.label, true])),
  )

  function toggleNourishmentsEmptyYears () {
    nourishmentsHideEmptyYears.value = !nourishmentsHideEmptyYears.value
    nextTick().then(renderNourishmentsChart)
  }

  function applyNourishmentsLegendSelection () {
    if (!nourishmentsChart) return
    for (const s of NOURISHMENT_SERIES) {
      nourishmentsChart.dispatchAction({
        type: nourishmentsLegendSelected[s.label] ? 'legendSelect' : 'legendUnSelect',
        name: s.label,
      })
    }
  }

  function selectAllNourishmentsSeries () {
    for (const s of NOURISHMENT_SERIES) {
      nourishmentsLegendSelected[s.label] = true
    }
    applyNourishmentsLegendSelection()
  }

  function toggleNourishmentsSeries (label) {
    nourishmentsLegendSelected[label] = !nourishmentsLegendSelected[label]
    applyNourishmentsLegendSelection()
  }

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

  // Get time dimension size from store
  const timeDimensionSize = computed(() => store.timeDimensionSizes.transect ?? 61)

  const url = computed(() => {
    if (indexNotFound.value) return ''
    const idx = wantedIndex.value
    const timeMax = timeDimensionSize.value - 1
    return `https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?cross_shore[0:1:2462],time[0:1:${timeMax}],altitude[0:1:${timeMax}][${idx}][0:1:2462]`
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
      const to255 = x => Math.round(255 * Math.pow(x, gamma))
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

  const mhwChartRef = ref(null)
  let mhwChart = null

  const nourishmentsChartRef = ref(null)
  let nourishmentsChart = null

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

  function disposeMhwChart () {
    if (mhwChart) {
      mhwChart.dispose()
      mhwChart = null
    }
  }

  function disposeNourishmentsChart () {
    if (nourishmentsChart) {
      nourishmentsChart.dispose()
      nourishmentsChart = null
    }
  }

  // Memoize expensive computations using computed properties
  const xAxisBounds = computed(() => {
    const xs = crossShore.value || []
    const byYear = altitudeByYear.value || []
    if (xs.length === 0 || byYear.length === 0) {
      return { min: null, max: null }
    }

    // Optimize: use Set for faster lookup, single pass
    const used = new Set()
    for (const row of byYear) {
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
    if (xs.length === 0) return null
    let closest = xs[0]
    let best = Math.abs(xs[0])
    for (let i = 1; i < xs.length; i++) {
      const d = Math.abs(xs[i])
      if (d < best) {
        best = d
        closest = xs[i]
      }
    }
    return closest
  })

  // Memoize series data
  const seriesData = computed(() => {
    const ys = years.value || []
    const xs = crossShore.value || []
    const byYear = altitudeByYear.value || []
    if (ys.length === 0 || xs.length === 0 || byYear.length === 0) return []

    const rspXVal = rspX.value

    return ys.map((label, tIndex) => {
      const row = byYear[tIndex] || []
      // Pre-allocate array for better performance
      const points = Array.from({ length: xs.length })
      for (const [i, x] of xs.entries()) {
        points[i] = row[i] == null ? [x, null] : [x, row[i]]
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
            position: 'insideEndTop',
          },
          data: [{
            name: 'RSP Lijn',
            xAxis: rspXVal,
            itemStyle: { color: '#000' },
          }],
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
    if (Array.isArray(p?.data)) return { x: p.data[0], y: p.data[1] }
    return { x: p?.axisValue, y: p?.value }
  }

  function renderChart () {
    try {
      if (!chartRef.value) return
      if (!chart) {
        chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
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
          formatter: params => {
            const arr = Array.isArray(params) ? params : [params]
            const valid = arr.filter(p => {
              const { y } = getXY(p)
              return y != null && Number.isFinite(Number(y))
            })
            if (valid.length === 0) return ''
            const { x } = getXY(valid[0])
            const header = `<b>Cross-shore: ${x} m</b>`

            // Split into columns of 25 items each
            const itemsPerColumn = 25
            const columns = []
            for (let i = 0; i < valid.length; i += itemsPerColumn) {
              const column = valid.slice(i, i + itemsPerColumn)
              const columnLines = column.map(p => {
                const { y } = getXY(p)
                const marker = p.marker || ''
                return `<b>${marker}${p.seriesName}</b>: ${y} m`
              })
              columns.push(columnLines)
            }

            // Format as columns using table
            if (columns.length === 1) {
              // Single column: simple format
              return [header, ...columns[0]].join('<br/>')
            } else {
              // Multiple columns: use table layout
              const maxRows = Math.max(...columns.map(col => col.length))
              let tableRows = `<tr><td colspan="${columns.length}" style="padding-bottom: 8px; border-bottom: 1px solid #ddd;"><b>Cross-shore: ${x} m</b></td></tr>`

              for (let row = 0; row < maxRows; row++) {
                tableRows += '<tr>'
                for (const column of columns) {
                  const cell = column[row] || ''
                  tableRows += `<td style="padding: 2px 12px; vertical-align: top;">${cell}</td>`
                }
                tableRows += '</tr>'
              }

              return `<table style="border-collapse: collapse;">${tableRows}</table>`
            }
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
          top: 172,
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
          { type: 'slider', xAxisIndex: 0, height: 18, bottom: 24 },
        ],
        series,
        progressive: 2000,
        progressiveThreshold: 10_000,
      }

      chart.setOption(option, true)
    } catch (error) {
      console.error('ECharts render error:', error)
    }
  }

  // Helper function to find first valid (non-null, non-NaN) index across multiple series
  function findFirstValidIndex (...seriesArrays) {
    const maxLength = Math.max(...seriesArrays.map(arr => arr?.length || 0))
    for (let i = 0; i < maxLength; i++) {
      for (const series of seriesArrays) {
        if (series && series[i] != null && Number.isFinite(series[i])) {
          return i
        }
      }
    }
    return 0 // Default to start if no valid values found
  }

  function renderBasalChart () {
    try {
      if (!basalChartRef.value) return
      if (!basalChart) {
        basalChart = echarts.init(basalChartRef.value, undefined, { renderer: 'canvas' })
      }

      const years = basalYears.value || []
      const basalValues = basalCoastline.value || []
      const testingValues = testingCoastline.value || []
      const momentaryValues = momentaryCoastline.value || []

      if (years.length === 0 || basalValues.length === 0) {
        return
      }

      // Find first valid index across all series
      const firstValidIndex = findFirstValidIndex(basalValues, testingValues, momentaryValues)

      // Slice arrays from first valid index
      const slicedYears = years.slice(firstValidIndex)
      const slicedBasalValues = basalValues.slice(firstValidIndex)
      const slicedTestingValues = testingValues.length > 0 ? testingValues.slice(firstValidIndex) : []
      const slicedMomentaryValues = momentaryValues.length > 0 ? momentaryValues.slice(firstValidIndex) : []

      const option = {
        animation: true,
        title: {
          text: 'Coastline Over Time',
          left: 'center',
          top: 0,
          textStyle: {
            fontSize: 20,
            fontWeight: '600',
          },
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line' },
          formatter: params => {
            const arr = Array.isArray(params) ? params : [params]
            const valid = arr.filter(p => {
              const value = p.value
              return value != null && Number.isFinite(value)
            })
            if (valid.length === 0) return ''
            const year = valid[0].axisValue
            const header = `<b>Year: ${year}</b>`
            const lines = valid.map(p => {
              const value = p.value
              const marker = p.marker || ''
              return `${marker}${p.seriesName}: ${value} m`
            })
            return [header, ...lines].join('<br/>')
          },
          showDelay: 0,
          hideDelay: 50,
          confine: true,
        },
        legend: {
          top: 32,
          selector: [{ title: 'All' }],
          selectorPosition: 'start',
        },
        grid: {
          top: 80,
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
          data: slicedYears,
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
            name: 'Basiskustlijn (BKL)',
            type: 'line',
            data: slicedBasalValues,
            showSymbol: true,
            symbol: 'circle',
            symbolSize: 6,
            connectNulls: false,
            lineStyle: {
              width: 0, // Hide the line, show only dots
            },
            itemStyle: {
              color: '#9C27B0', // Purple
            },
          },
          {
            name: 'Toetsing Kustlijn (TKL)',
            type: 'line',
            data: slicedTestingValues.length > 0 ? slicedTestingValues : [],
            showSymbol: true,
            symbol: 'circle',
            symbolSize: 6,
            connectNulls: false,
            lineStyle: {
              width: 0, // Hide the line, show only dots
            },
            itemStyle: {
              color: '#4CAF50', // Green
            },
          },
          {
            name: 'Momentane Kustlijn (MKL)',
            type: 'line',
            data: slicedMomentaryValues.length > 0 ? slicedMomentaryValues : [],
            showSymbol: true,
            symbol: 'circle',
            symbolSize: 6,
            connectNulls: false,
            lineStyle: {
              width: 0, // Hide the line, show only dots
            },
            itemStyle: {
              color: '#2196F3', // Blue
            },
          },
        ],
      }

      basalChart.setOption(option, true)
    } catch (error) {
      console.error('Basal chart render error:', error)
    }
  }

  function renderMhwChart () {
    try {
      if (!mhwChartRef.value) return
      if (!mhwChart) {
        mhwChart = echarts.init(mhwChartRef.value, undefined, { renderer: 'canvas' })
      }

      const years = mhwYears.value || []
      const mhwValues = meanHighWaterCross.value || []
      const mlwValues = meanLowWaterCross.value || []

      if (years.length === 0 || mhwValues.length === 0) {
        return
      }

      const dfValues = duneFootThreeNAPCross.value || []

      // Find first valid index across all series (including dune foot if available)
      const firstValidIndex = findFirstValidIndex(mhwValues, mlwValues, dfValues)

      // Slice arrays from first valid index
      const slicedYears = years.slice(firstValidIndex)
      const slicedMhwValues = mhwValues.slice(firstValidIndex)
      const slicedMlwValues = mlwValues.length > 0 ? mlwValues.slice(firstValidIndex) : []
      const slicedDfValues = dfValues.length > 0 ? dfValues.slice(firstValidIndex) : []

      const option = {
        animation: true,
        title: {
          text: 'Cross shore distance [m]',
          left: 'center',
          top: 0,
          textStyle: {
            fontSize: 20,
            fontWeight: '600',
          },
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'line' },
          formatter: params => {
            const arr = Array.isArray(params) ? params : [params]
            const valid = arr.filter(p => {
              const value = p.value
              return value != null && Number.isFinite(value)
            })
            if (valid.length === 0) return ''
            const year = valid[0].axisValue
            const header = `<b>Year: ${year}</b>`
            const lines = valid.map(p => {
              const value = p.value
              const marker = p.marker || ''
              return `${marker}${p.seriesName}: ${value} m`
            })
            return [header, ...lines].join('<br/>')
          },
          showDelay: 0,
          hideDelay: 50,
          confine: true,
        },
        legend: {
          top: 32,
          selector: [{ title: 'All' }],
          selectorPosition: 'start',
        },
        grid: {
          top: 80,
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
          data: slicedYears,
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
            name: 'Mean High Water',
            type: 'line',
            data: slicedMhwValues,
            showSymbol: true,
            symbol: 'circle',
            symbolSize: 6,
            connectNulls: false,
            lineStyle: {
              width: 0, // Hide the line, show only dots
            },
            itemStyle: {
              color: '#F44336', // Red
            },
          },
          {
            name: 'Mean Low Water',
            type: 'line',
            data: slicedMlwValues.length > 0 ? slicedMlwValues : [],
            showSymbol: true,
            symbol: 'circle',
            symbolSize: 6,
            connectNulls: false,
            lineStyle: {
              width: 0, // Hide the line, show only dots
            },
            itemStyle: {
              color: '#2196F3', // Blue
            },
          },
          {
            name: 'Dune Foot 3NAP',
            type: 'line',
            data: slicedDfValues.length > 0 ? slicedDfValues : [],
            showSymbol: true,
            symbol: 'circle',
            symbolSize: 6,
            connectNulls: false,
            lineStyle: {
              width: 0, // Hide the line, show only dots
            },
            itemStyle: {
              color: '#4CAF50', // Green
            },
          },
        ],
      }

      mhwChart.setOption(option, true)
    } catch (error) {
      console.error('MHW chart render error:', error)
    }
  }

  function renderNourishmentsChart () {
    try {
      if (!nourishmentsChartRef.value) return
      if (!nourishmentsChart) {
        nourishmentsChart = echarts.init(nourishmentsChartRef.value, undefined, { renderer: 'canvas' })
      }

      const years = nourishmentsYears.value || []
      const byType = nourishmentsByType.value || {}

      if (years.length === 0) {
        return
      }

      const seriesArrays = NOURISHMENT_SERIES.map(s => byType[s.key] || [])
      const hasAnyData = seriesArrays.some(arr =>
        arr.some(v => v != null && Number.isFinite(v)),
      )

      if (!hasAnyData) {
        nourishmentsChart.clear()
        nourishmentsChart.setOption({
          title: {
            text: 'Nourishments',
            left: 'center',
            top: 0,
            textStyle: { fontSize: 20, fontWeight: '600' },
          },
          graphic: {
            type: 'text',
            left: 'center',
            top: 'middle',
            style: {
              text: 'No nourishments for this transect',
              fill: '#888',
              fontSize: 14,
            },
          },
        }, true)
        return
      }

      let yearIndexes = years.map((_, i) => i)
      if (nourishmentsHideEmptyYears.value) {
        yearIndexes = yearIndexes.filter(i =>
          seriesArrays.some(arr => arr[i] != null && Number.isFinite(arr[i])),
        )
      }

      const axisYears = yearIndexes.map(i => years[i])
      const series = NOURISHMENT_SERIES.map((s, seriesIdx) => ({
        name: s.label,
        type: 'bar',
        data: yearIndexes.map(i => {
          const v = seriesArrays[seriesIdx][i]
          return v == null ? null : Math.round(v * 10) / 10
        }),
        itemStyle: { color: s.color },
        barMaxWidth: 18,
      }))

      const option = {
        animation: true,
        title: {
          text: 'Nourishments',
          left: 'center',
          top: 0,
          textStyle: {
            fontSize: 20,
            fontWeight: '600',
          },
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: params => {
            const arr = Array.isArray(params) ? params : [params]
            const valid = arr.filter(p => p.value != null && Number.isFinite(p.value))
            if (valid.length === 0) return ''
            const year = valid[0].axisValue
            const header = `<b>Year: ${year}</b>`
            const lines = valid.map(p => {
              const marker = p.marker || ''
              return `${marker}${p.seriesName}: ${p.value} m³/m`
            })
            return [header, ...lines].join('<br/>')
          },
          showDelay: 0,
          hideDelay: 50,
          confine: true,
        },
        legend: { show: false },
        grid: {
          top: 80,
          right: 40,
          bottom: 80,
          left: 70,
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          name: 'Year',
          nameLocation: 'middle',
          nameGap: 30,
          data: axisYears,
          axisLabel: {
            rotate: 45,
          },
        },
        yAxis: {
          type: 'value',
          name: 'Nourishments [m³/m]',
          nameLocation: 'middle',
          nameGap: 50,
        },
        dataZoom: [
          { type: 'inside', xAxisIndex: 0 },
          { type: 'slider', xAxisIndex: 0, height: 18, bottom: 16 },
        ],
        series,
      }

      nourishmentsChart.setOption(option, true)
      applyNourishmentsLegendSelection()
    } catch (error) {
      console.error('Nourishments chart render error:', error)
    }
  }

  function handleResize () {
    if (chart) chart.resize()
    if (basalChart) basalChart.resize()
    if (mhwChart) mhwChart.resize()
    if (nourishmentsChart) nourishmentsChart.resize()
  }

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

  async function fetchMomentaryNow () {
    if (indexNotFound.value) return
    const idx = wantedIndex.value
    await store.fetchMomentaryCoastline(idx)
  }

  async function fetchMhwNow () {
    if (indexNotFound.value) return
    const idx = wantedIndex.value
    await store.fetchMeanHighWaterCross(idx)
  }

  async function fetchDfNow () {
    if (indexNotFound.value) return
    const idx = wantedIndex.value
    await store.fetchDuneFootThreeNAPCross(idx)
  }

  async function fetchNourishmentsNow () {
    if (indexNotFound.value) return
    const idx = wantedIndex.value
    await store.fetchNourishments(idx)
  }

  onMounted(async () => {
    window.addEventListener('resize', handleResize)

    await Promise.all([
      store.fetchTransectIdList(),
      store.fetchAlongshoreList(),
      store.fetchAllDatasetTimeDimensions(),
    ])

    await nextTick()

    if (!indexNotFound.value) {
      await Promise.all([
        fetchNow(),
        fetchBasalNow(),
        fetchMomentaryNow(),
        fetchMhwNow(),
        fetchDfNow(),
        fetchNourishmentsNow(),
      ])
    }
    await nextTick()
    renderChart()
    renderBasalChart()
    renderMhwChart()
    renderNourishmentsChart()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
    disposeChart()
    disposeBasalChart()
    disposeMhwChart()
    disposeNourishmentsChart()
  })

  // Debounced render for basal chart
  const debouncedRenderBasal = debounce(() => {
    if (basalReady.value) {
      nextTick().then(renderBasalChart)
    }
  }, 100)

  // Re-render when data changes (debounced for better performance)
  watch([chartReady, years, crossShore, altitudeByYear], debouncedRender, {
    deep: false, // Shallow watch is faster
  })

  // Debounced render for MHW chart
  const debouncedRenderMhw = debounce(() => {
    if (mhwReady.value) {
      nextTick().then(renderMhwChart)
    }
  }, 100)

  // Re-render basal chart when data changes
  watch([basalReady, basalYears, basalCoastline, testingCoastline, momentaryReady, momentaryCoastline], debouncedRenderBasal, {
    deep: false,
  })

  // Re-render MHW chart when data changes
  watch([mhwReady, mhwYears, meanHighWaterCross, meanLowWaterCross, dfReady, duneFootThreeNAPCross], debouncedRenderMhw, {
    deep: false,
  })

  const debouncedRenderNourishments = debounce(() => {
    if (nourishmentsReady.value) {
      nextTick().then(renderNourishmentsChart)
    }
  }, 100)

  watch([nourishmentsReady, nourishmentsYears, nourishmentsByType], debouncedRenderNourishments, {
    deep: true,
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
        fetchBasalNow(),
        fetchMomentaryNow(),
        fetchMhwNow(),
        fetchDfNow(),
        fetchNourishmentsNow(),
      ])
    }
    await nextTick()
    renderChart()
    renderBasalChart()
    renderMhwChart()
    renderNourishmentsChart()
  }, 150))
</script>

<style scoped>
.layout {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 2400px;
}

.chart-wrap {
  flex: 1;
  min-width: 0;
  padding: 0 24px;
  margin-left: 220px; /* Account for fixed side panel width */
  overflow: visible;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.chart {
  width: 100%;
  height: 600px;
}

.nourishments-chart-wrap {
  position: relative;
  width: 100%;
}

.nourishments-controls {
  position: absolute;
  top: 32px;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 12px;
  pointer-events: none;
}

.nourishments-controls > * {
  pointer-events: auto;
}

.nourishments-ctrl-btn {
  margin: 0;
  padding: 0 8px;
  height: 22px;
  border: 1px solid rgb(204, 204, 204);
  border-radius: 10px;
  background: #fff;
  color: rgb(102, 102, 102);
  font-size: 12px;
  font-family: sans-serif;
  line-height: 20px;
  cursor: pointer;
  white-space: nowrap;
}

.nourishments-ctrl-btn:hover {
  color: rgb(51, 51, 51);
  border-color: rgb(153, 153, 153);
}

.nourishments-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: rgb(51, 51, 51);
  font-size: 12px;
  font-family: sans-serif;
  line-height: 20px;
  cursor: pointer;
  white-space: nowrap;
}

.nourishments-legend-item.inactive {
  color: rgb(170, 170, 170);
}

.nourishments-legend-item.inactive .nourishments-legend-swatch {
  opacity: 0.35;
}

.nourishments-legend-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
}
</style>
