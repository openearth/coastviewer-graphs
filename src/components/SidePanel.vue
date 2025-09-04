<template>
  <aside class="panel">
      <div class="panel__title" style="font-size: 16px">Transect</div>
      <div class="panel__value panel__value--big with-icon">{{ currentTransectIdDisplay }}
        <span v-if="showMismatchIcon" class="sup-icon">
          <VTooltip :text="tooltipText" location="right">
            <template v-slot:activator="{ props }">
              <VIcon
                v-bind="props"
                :size="20"
                color="rgb(255,143,0)"
                class="summary-info"
                icon="mdi-swap-horizontal"
              />
            </template>
          </VTooltip>
        </span>
      </div>

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
import { computed, onMounted, watch, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'

const DEFAULT_TRANSECT_NUMBER = 1000475

const route = useRoute()
const router = useRouter()
const store = useAppStore()

// Track non-exact slug the user tried (for tooltip), even after URL normalization
const nonExactEntered = ref(null)

// Remember when we just normalized, so we don't clear the flag right away
const didNormalizeOnce = ref(false)

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
  normalizeSlugToClosest()
})

// Current route-based transect number (fallback)
const currentTransectNum = computed(() => {
  const raw = route.params.transectNum
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TRANSECT_NUMBER
})

// Helper: find closest index in an array of numeric IDs
function findClosestIndex (ids, target) {
  if (!ids || !ids.length) return -1
  let bestIdx = 0
  let bestDiff = Math.abs(ids[0] - target)
  for (let i = 1; i < ids.length; i++) {
    const diff = Math.abs(ids[i] - target)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i
    }
  }
  return bestIdx
}

// Index into the lists (closest match if no exact)
const wantedIndex = computed(() => {
  const ids = store.idList || []
  if (!ids.length) return -1
  const exact = ids.indexOf(currentTransectNum.value)
  return exact !== -1 ? exact : findClosestIndex(ids, currentTransectNum.value)
})

const indexNotFound = computed(() => wantedIndex.value < 0)

// Displayed transect id (always from list when available)
const currentTransectIdDisplay = computed(() => {
  if (!indexNotFound.value) {
    return store.idList[wantedIndex.value]
  }
  return currentTransectNum.value
})

// Show tiny icon only when user entered a non-exact, we snapped to nearest
const showMismatchIcon = computed(() => {
  const ids = store.idList || []
  if (!ids.length) return false
  return nonExactEntered.value != null
})

// Tooltip text with the original (invalid) slug
const tooltipText = computed(() => {
  if (nonExactEntered.value == null) return ''
  const val = Number(nonExactEntered.value)
  const shown = Number.isFinite(val) ? String(Math.trunc(val)) : String(nonExactEntered.value)
  return `The selected transect id (${shown}) is not valid. The information being displayed corresponds to its nearest valid transect.`
})

// Canonicalize URL to the closest known ID so the whole app follows it
function normalizeSlugToClosest () {
  const ids = store.idList || []
  if (!ids.length) return

  const target = currentTransectNum.value
  const exact = ids.indexOf(target)
  const idx = exact !== -1 ? exact : findClosestIndex(ids, target)
  if (idx < 0) return
  const closestId = ids[idx]

  if (exact === -1) {
    // user entered an invalid slug; remember it and normalize once
    nonExactEntered.value = target
    didNormalizeOnce.value = true
    if (String(closestId) !== String(route.params.transectNum)) {
      router.replace({
        name: route.name,
        params: { ...route.params, transectNum: String(closestId) },
        query: route.query,
        hash: route.hash,
      })
    }
  } else {
    // exact slug now; if this is the immediate call after our replace, keep the flag
    if (didNormalizeOnce.value) {
      didNormalizeOnce.value = false
      // keep nonExactEntered as-is so the icon still shows for this navigation
    } else {
      // user navigated to an exact ID themselves later -> clear the flag
      nonExactEntered.value = null
    }
  }
}

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
  normalizeSlugToClosest()
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

.panel__value--big { font-size: 32px; }

.with-icon { position: relative; display: inline-block; padding-right: 18px; }
.sup-icon {
  position: absolute;
  top: -4px;
  right: -2px;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.9;
}

.sup-icon:hover .mdi { color: #111; opacity: 1; }

.mt { margin-top: 16px; }
</style>
