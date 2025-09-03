<template>
  <aside class="panel">
      <div class="panel__title" style="font-size: 16px">Transect</div>
      <div class="panel__value" style="font-size: 32px">{{ currentTransectIdDisplay }}</div>

    <div v-if="alongshoreForTransect !== null">
      <div class="panel__title mt">Alongshore</div>
      <div class="panel__value">{{ alongshoreForTransect }} m</div>
    </div>

    <div v-if="areaDisplay">
      <div class="panel__title mt">Area</div>
      <div class="panel__value">{{ areaDisplay }}</div>
    </div>

    <div v-if="rspLatLon">
      <div class="panel__title mt">RSP (lat, lon)</div>
      <div class="panel__value" style="white-space: pre-line">{{ rspLatLon }}</div>
    </div>

    <div v-if="rspXY">
      <div class="panel__title mt">RSP (x, y)</div>
      <div class="panel__value" style="white-space: pre-line">{{ rspXY }}</div>
    </div>

    <div v-if="meanLowForTransect !== null">
      <div class="panel__title mt">Mean low water</div>
      <div class="panel__value">{{ meanLowForTransect }} m</div>
    </div>

    <div v-if="meanHighForTransect !== null">
      <div class="panel__title mt">Mean high water</div>
      <div class="panel__value">{{ meanHighForTransect }} m</div>
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'

const DEFAULT_TRANSECT_NUMBER = 1000475

const route = useRoute()
const store = useAppStore()

// Ensure we have base lists
onMounted(async () => {
  await Promise.all([
    // id list is needed to resolve the index of the current transect
    store.fetchTransectIdList(),
    // alongshore list
    store.fetchAlongshoreList(),
    // area info (areacode + areaname)
    store.fetchAreaInfo(),
    // rsp_x, rsp_y, rsp_lat, rsp_lon
    store.fetchRspInfo(),
    // mean_low_water, mean_high_water
    store.fetchWaterLevelsInfo(),
  ])
})

// Current route-based transect number (fallback)
const currentTransectNum = computed(() => {
  const raw = route.params.transectNum
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TRANSECT_NUMBER
})

// Index into the lists
const wantedIndex = computed(() => {
  const ids = store.idList || []
  if (!ids.length) return -1
  return ids.indexOf(currentTransectNum.value)
})

const indexNotFound = computed(() => wantedIndex.value < 0)

// Displayed transect id (from the ids list if present, else the route param)
const currentTransectIdDisplay = computed(() => {
  if (!indexNotFound.value) {
    return store.idList[wantedIndex.value]
  }
  return currentTransectNum.value
})

// Alongshore value for current transect
const alongshoreForTransect = computed(() => {
  const idx = wantedIndex.value
  const list = store.alongshoreList || []
  if (idx < 0 || idx >= list.length) return null
  return list[idx]
})

// Area: "<code>: <name>"
const areaDisplay = computed(() => {
  const idx = wantedIndex.value
  const codes = store.areacodeList || []
  const names = store.areanameList || []
  if (idx < 0 || idx >= codes.length || idx >= names.length) return ''
  const code = codes[idx]
  const name = (names[idx] || '').trim()
  return `${code}: ${name}`
})

// Helpers to format numbers for display
function fmtLatLon (v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(6) : ''
}
function fmtXY (v) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : ''
}

// RSP pairs (lat,lon) and (x,y) for current transect
const rspLatLon = computed(() => {
  const idx = wantedIndex.value
  const lat = store.rspLatList || []
  const lon = store.rspLonList || []
  if (idx < 0 || idx >= lat.length || idx >= lon.length) return ''
  return `${fmtLatLon(lat[idx])}°N, \n${fmtLatLon(lon[idx])}°E`
})

const rspXY = computed(() => {
  const idx = wantedIndex.value
  const xs = store.rspXList || []
  const ys = store.rspYList || []
  if (idx < 0 || idx >= xs.length || idx >= ys.length) return ''
  return `${fmtXY(xs[idx])} m E, \n${fmtXY(ys[idx])} m N \n(EPSG:28992)`
})

// mean water values for current transect
function fmtWater (v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toFixed(2)
}

const meanLowForTransect = computed(() => {
  const idx = wantedIndex.value
  const list = store.meanLowWaterList || []
  if (idx < 0 || idx >= list.length) return null
  return fmtWater(list[idx])
})

const meanHighForTransect = computed(() => {
  const idx = wantedIndex.value
  const list = store.meanHighWaterList || []
  if (idx < 0 || idx >= list.length) return null
  return fmtWater(list[idx])
})

// Keep info in sync if route changes later
watch(() => route.params.transectNum, async () => {
  if (!store.idList?.length) await store.fetchTransectIdList()
  if (!store.alongshoreList?.length) await store.fetchAlongshoreList()
  if (!store.areacodeList?.length || !store.areanameList?.length) await store.fetchAreaInfo()
  if (!store.rspXList?.length || !store.rspYList?.length || !store.rspLatList?.length || !store.rspLonList?.length) {
    await store.fetchRspInfo()
  }
  if (!store.meanLowWaterList?.length || !store.meanHighWaterList?.length) {
    await store.fetchWaterLevelsInfo()
  }
})
</script>

<style scoped>
.panel {
  width: 220px;
  min-width: 220px;
  padding: 16px 12px;
  border-right: 1px solid rgba(0,0,0,0.08);
  background: #fafafa;
}

.panel__title {
  font-size: 12px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: #666;
  margin-bottom: 4px;
}

.panel__value {
  font-size: 20px;
  font-weight: 600;
  color: #222;
  word-break: break-word;
}

.mt { margin-top: 16px; }
</style>
