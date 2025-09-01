<template>
  <div class="pa-4">
    <v-card elevation="1" class="pa-4">
      <div class="text-h6 mb-2">OpenDAP fetch (slug-driven by transect number)</div>

      <div class="d-flex align-center ga-2 mb-3">
        <v-text-field
          v-model="transectNumInput"
          type="number"
          label="Transect number (URL slug)"
          variant="outlined"
          density="comfortable"
          hide-details
          class="flex-grow-1"
          @keyup.enter="goToTransectNum"
        />
        <v-btn color="primary" @click="goToTransectNum">Go</v-btn>
        <v-btn variant="tonal" @click="reload">Refetch</v-btn>
      </div>

      <v-alert v-if="idsError" type="error" variant="tonal" class="mb-3">
        {{ idsError }}
      </v-alert>
      <v-alert v-else-if="loadingIds" type="info" variant="tonal" class="mb-3">
        Loading transect catalog…
      </v-alert>

      <template v-if="!loadingIds && !idsError">
        <v-alert v-if="indexNotFound" type="warning" variant="tonal" class="mb-3">
          Transect number <strong>{{ currentTransectNum }}</strong> not found in catalog.
        </v-alert>

        <v-alert v-else type="info" variant="tonal" class="mb-3">
          Slug <strong>{{ currentTransectNum }}</strong> → index <strong>{{ wantedIndex }}</strong>.
          URL: <span class="text-caption">{{ url }}</span>
        </v-alert>

        <div class="d-flex ga-2 mb-2">
          <v-btn :loading="loading" color="primary" @click="fetchNow" :disabled="indexNotFound">Fetch & Transform</v-btn>
          <v-btn variant="tonal" @click="refreshFromCache" :disabled="indexNotFound">Load From Cache</v-btn>
          <v-btn variant="tonal" color="error" @click="clearCache" :disabled="indexNotFound">Clear Cache</v-btn>
          <v-btn :disabled="!chartReady" variant="tonal" @click="downloadChartJson">Download Chart JSON</v-btn>
        </div>

        <v-alert v-if="error" type="error" variant="tonal" class="mb-2">{{ error }}</v-alert>
        <v-alert v-if="warning" type="warning" variant="tonal" class="mb-2">{{ warning }}</v-alert>

        <div v-if="hasData" class="mb-3">
          <div class="text-subtitle-2 mb-1">
            Raw payload <strong>{{ prettyLen }}</strong> chars
            <span v-if="fetchedAt"> @ {{ new Date(fetchedAt).toLocaleString() }}</span>.
          </div>
          <v-textarea
            :model-value="rawPreview"
            auto-grow
            rows="6"
            readonly
            variant="outlined"
            class="mb-3"
          />
        </div>

        <div v-if="chartReady" class="mb-1">
          <v-alert type="success" variant="tonal">
            Parsed for chart ✓ — cross_shore: <strong>{{ crossShore.length.toLocaleString() }}</strong>,
            years: <strong>{{ years.length }}</strong>.
          </v-alert>
          <v-table class="mt-2">
            <thead>
              <tr>
                <th>Year examples</th>
                <th>First cross_shore</th>
                <th>Sample altitude[year0][0]</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{{ years.slice(0, 5).join(', ') }}{{ years.length > 5 ? '…' : '' }}</td>
                <td>{{ crossShore[0] }}</td>
                <td>{{ altitudeByYear?.[0]?.[0] ?? 'null' }}</td>
              </tr>
            </tbody>
          </v-table>

          <!-- Chart -->
          <div class="mt-4">
            <div class="text-subtitle-2 mb-2">
              Time series of altitude vs cross_shore (one line per year)
            </div>
            <div ref="chartRef" class="chart"></div>
          </div>
        </div>
      </template>
    </v-card>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import * as echarts from 'echarts'

const DEFAULT_TRANSECT_NUMBER = 1000475

const route = useRoute()
const router = useRouter()
const store = useAppStore()

const loading     = computed(() => store.loading)
const error       = computed(() => store.error)
const warning     = computed(() => store.warning)
const hasData     = computed(() => !!store.rawText && store.rawText.length > 0)
const fetchedAt   = computed(() => store.fetchedAt)
const prettyLen   = computed(() => (store.rawText ? store.rawText.length.toLocaleString() : '0'))
const previewCount = 3000
const rawPreview  = computed(() => (store.rawText ? store.rawText.slice(0, previewCount) : ''))

const loadingIds  = computed(() => store.loadingIds)
const idsError    = computed(() => store.idsError)
const idList      = computed(() => store.idList)

// derived for charts
const chartReady     = computed(() => store.chartReady)
const years          = computed(() => store.years)
const crossShore     = computed(() => store.crossShore)
const altitudeByYear = computed(() => store.altitudeByYear)

const currentTransectNum = computed(() => {
  const raw = route.params.transectNum
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TRANSECT_NUMBER
})

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

const transectNumInput = ref(String(currentTransectNum.value))
watch(currentTransectNum, (n) => { transectNumInput.value = String(n) })

function goToTransectNum () {
  const n = Number(transectNumInput.value)
  if (!Number.isFinite(n) || n <= 0) {
    store.error = 'Please enter a positive transect number.'
    return
  }
  store.error = null
  router.push({ name: 'Home', params: { transectNum: Math.floor(n) } })
}

async function fetchNow () {
  if (indexNotFound.value) return
  await store.fetchOpendapAscii(url.value)
}

async function refreshFromCache () {
  if (indexNotFound.value) return
  await store.loadFromCache(url.value)
}

function clearCache () {
  if (indexNotFound.value) return
  store.clearCache(url.value)
}

function downloadChartJson () {
  if (!store.chartReady || !store.chartData) return
  const blob = new Blob([JSON.stringify(store.chartData, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `transect_${currentTransectNum.value}_chart.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

function reload () {
  fetchNow()
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

  // Determine which cross_shore columns have ANY non-null value across years
  const usedXs = []
  for (let i = 0; i < xs.length; i++) {
    let hasData = false
    for (let t = 0; t < byYear.length; t++) {
      const v = byYear[t]?.[i]
      if (v != null && Number.isFinite(v)) {
        hasData = true
        break
      }
    }
    if (hasData) usedXs.push(xs[i])
  }

  if (!usedXs.length) {
    // fallback to full domain if, unexpectedly, all columns are null
    return { min: Math.min(...xs), max: Math.max(...xs) }
  }
  return { min: Math.min(...usedXs), max: Math.max(...usedXs) }
}

function buildSeries () {
  const ys = years.value || []
  const xs = crossShore.value || []
  const byYear = altitudeByYear.value || []
  if (!ys.length || !xs.length || !byYear.length) return []

  // One line per year
  return ys.map((label, tIndex) => {
    const row = byYear[tIndex] || []
    const points = xs.map((x, i) => {
      const y = row[i]
      // Keep nulls so connectNulls can do its job
      return y == null ? [x, null] : [x, y]
    })
    return {
      name: label,
      type: 'line',
      showSymbol: false,
      connectNulls: true, // <-- your change preserved
      data: points,
      // You can add emphasis/animation tweaks here if needed
    }
  })
}

function renderChart () {
  try {
    if (!chartRef.value) return
    if (!chart) {
      chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
      window.addEventListener('resize', handleResize)
    }

    const { min: xMin, max: xMax } = computeXAxisBounds()
    const option = {
      animation: true,
      tooltip: {
        trigger: 'axis',
        valueFormatter: (val) => (val == null ? '—' : String(val)),
      },
      legend: {
        type: 'scroll',
        top: 0,
      },
      grid: { top: 36, right: 42, bottom: 96, left: 56 },
      xAxis: {
        type: 'value',
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
      series: buildSeries(),
      // Optional progressive rendering for performance
      progressive: 2000,
      progressiveThreshold: 10000,
    }

    chart.setOption(option, true)
  } catch (e) {
    // Fail gently so Vue watchers don't crash
    console.error('ECharts render error:', e)
  }
}

function handleResize () {
  if (chart) {
    chart.resize()
  }
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

// Re-render chart when data becomes ready or changes
watch([chartReady, years, crossShore, altitudeByYear], () => {
  if (chartReady.value) {
    nextTick().then(renderChart)
  }
})

// Also re-render if the container size might change due to route param change
watch(() => route.params.transectNum, async () => {
  if (!idList.value || idList.value.length === 0) {
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
.ga-2 { gap: 8px; }
.flex-grow-1 { flex: 1; }
.chart {
  width: 100%;
  height: 520px;
}
</style>
