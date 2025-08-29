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
          <v-alert type="success" variant="tonal" class="mb-3">
            Parsed for chart ✓ — cross_shore: <strong>{{ crossShore.length.toLocaleString() }}</strong>,
            years: <strong>{{ years.length }}</strong>.
          </v-alert>

          <!-- ECharts card -->
          <v-card variant="tonal" class="pa-3 mb-3">
            <div class="text-subtitle-1 mb-2">Cross-shore profiles by year</div>
            <div ref="chartEl" class="chart-box"></div>
            <div class="text-caption mt-2">
              Tip: use the horizontal zoom to focus on a cross-shore range; toggle years via legend.
            </div>
          </v-card>

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

// If your store already provides `echartsSeries`, we’ll use it. Otherwise, build it locally.
const echartsSeriesFromStore = computed(() => store.echartsSeries)
const echartsSeries = computed(() => {
  if (echartsSeriesFromStore.value && echartsSeriesFromStore.value.length) {
    return echartsSeriesFromStore.value
  }
  // Fallback builder (x=cross_shore, y=altitude)
  if (!years.value?.length || !crossShore.value?.length || !altitudeByYear.value?.length) return []
  return years.value.map((yearLabel, tIndex) => ({
    name: String(yearLabel),
    type: 'line',
    showSymbol: false,
    connectNulls: false,
    data: crossShore.value.map((x, xi) => [x, altitudeByYear.value?.[tIndex]?.[xi] ?? null]),
  }))
})

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

/* --------------------- ECharts setup --------------------- */
const chartEl = ref(null)
let chartInstance = null
let disposed = false

function makeOption () {
  return {
    tooltip: { trigger: 'axis' },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataZoom: {},
        restore: {},
      },
      right: 10
    },
    grid: { left: 56, right: 24, top: 56, bottom: 64 },
    legend: { type: 'scroll', top: 8 },
    xAxis: {
      type: 'value',
      name: 'cross_shore',
      nameLocation: 'middle',
      nameGap: 28,
      splitLine: { show: true }
    },
    yAxis: {
      type: 'value',
      name: 'altitude (m)',
      nameLocation: 'middle',
      nameGap: 40,
      splitLine: { show: true }
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 18, bottom: 24 }
    ],
    series: echartsSeries.value ?? []
  }
}

function ensureChart () {
  if (disposed) return null
  if (!chartEl.value) return null
  if (!chartInstance) {
    chartInstance = echarts.init(chartEl.value)
  }
  return chartInstance
}

function renderChart () {
  if (disposed) return
  // If no data or not ready yet, just clear any previous chart safely
  if (!chartReady.value || !echartsSeries.value?.length) {
    const inst = chartInstance
    if (inst) inst.clear()
    return
  }
  const inst = ensureChart()
  if (!inst) return
  inst.setOption(makeOption(), true)
}

function handleResize () {
  if (disposed) return
  if (chartInstance) chartInstance.resize()
}

onMounted(async () => {
  await store.fetchTransectIdList()
  if (!indexNotFound.value) {
    await fetchNow()
  }

  await nextTick()
  if (chartEl.value && !chartInstance) {
    chartInstance = echarts.init(chartEl.value)
  }
  renderChart()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  disposed = true
  if (chartInstance) {
    try { chartInstance.dispose() } catch {}
    chartInstance = null
  }
})

watch(() => route.params.transectNum, async () => {
  if (!idList.value || idList.value.length === 0) {
    await store.fetchTransectIdList()
  }
  if (!indexNotFound.value) {
    await fetchNow()
  }
})

// Re-render when parsed data changes (defensive: will no-op until mounted)
watch([chartReady, echartsSeries, crossShore, years], () => {
  renderChart()
})
</script>

<style scoped>
.ga-2 { gap: 8px; }
.flex-grow-1 { flex: 1; }
/* ECharts container */
.chart-box {
  width: 100%;
  height: 420px;
}
</style>
