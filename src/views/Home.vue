<template>
  <div class="pa-4">
    <v-card elevation="1" class="pa-4">
      <div class="text-h6 mb-2">OpenDAP raw fetch (slug-driven)</div>

      <div class="d-flex align-center ga-2 mb-3">
        <v-text-field
          v-model="transectInput"
          type="number"
          label="Transect (from URL slug)"
          variant="outlined"
          density="comfortable"
          hide-details
          class="flex-grow-1"
          @keyup.enter="goToTransect"
        />
        <v-btn color="primary" @click="goToTransect">Go</v-btn>
        <v-btn variant="tonal" @click="reload">Refetch</v-btn>
      </div>

      <v-alert v-if="error" type="error" variant="tonal" class="mb-3">
        {{ error }}
      </v-alert>

      <v-alert v-else type="info" variant="tonal" class="mb-3">
        Using slug <strong>{{ currentTransect }}</strong> →
        <span class="text-caption">{{ url }}</span>
      </v-alert>

      <div class="d-flex ga-2 mb-2">
        <v-btn :loading="loading" color="primary" @click="fetchNow">Fetch & Store</v-btn>
        <v-btn variant="tonal" @click="refreshFromCache">Load From Cache</v-btn>
        <v-btn variant="tonal" color="error" @click="clearCache">Clear Cache</v-btn>
        <v-btn :disabled="!hasData" variant="tonal" @click="downloadRaw">Download Raw</v-btn>
      </div>

      <div v-if="hasData">
        <div class="text-subtitle-2 mb-1">
          Stored <strong>{{ prettyLen }}</strong> characters
          <span v-if="fetchedAt"> at {{ new Date(fetchedAt).toLocaleString() }}</span>.
        </div>
        <v-textarea
          :model-value="rawPreview"
          auto-grow
          rows="8"
          readonly
          variant="outlined"
          class="mb-3"
        />
      </div>

      <v-expansion-panels>
        <v-expansion-panel>
          <v-expansion-panel-title>How this works</v-expansion-panel-title>
          <v-expansion-panel-text>
            The last segment of the URL (e.g. <code>/1551</code>) sets the transect index.
            The page builds the OpenDAP <code>.ascii</code> URL with that index and
            fetches it in the browser. Data is cached in IndexedDB for reuse. No backend needed.
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'

const DEFAULT_TRANSECT = 1551

const route = useRoute()
const router = useRouter()
const store = useAppStore()

const loading   = computed(() => store.loading)
const error     = computed(() => store.error)
const hasData   = computed(() => !!store.rawText && store.rawText.length > 0)
const fetchedAt = computed(() => store.fetchedAt)
const prettyLen = computed(() => (store.rawText ? store.rawText.length.toLocaleString() : '0'))
const previewCount = 3000
const rawPreview = computed(() => (store.rawText ? store.rawText.slice(0, previewCount) : ''))

// slug → transect
const currentTransect = computed(() => {
  const raw = route.params.transect
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_TRANSECT
})

// URL built from slug
const url = computed(() => {
  const t = currentTransect.value
  return `https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?cross_shore[0:1:2462],time[0:1:59],altitude[0:1:59][${t}][0:1:2462]`
})

// UI field to jump to another transect (kept in sync with slug)
const transectInput = ref(String(currentTransect.value))
watch(currentTransect, (n) => { transectInput.value = String(n) })

function goToTransect () {
  const n = Number(transectInput.value)
  if (!Number.isFinite(n) || n < 0) {
    store.error = 'Please enter a non-negative transect number.'
    return
  }
  store.error = null
  router.push({ name: 'Home', params: { transect: Math.floor(n) } })
}

async function fetchNow () {
  await store.fetchOpendapAscii(url.value)
}

async function refreshFromCache () {
  await store.loadFromCache(url.value)
}

function clearCache () {
  store.clearCache(url.value)
}

function downloadRaw () {
  if (!store.rawText) return
  const blob = new Blob([store.rawText], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `transect_${currentTransect.value}.ascii.txt`
  a.click()
  URL.revokeObjectURL(a.href)
}

function reload () {
  fetchNow()
}

// auto-fetch when arriving on the page and when the slug changes
onMounted(fetchNow)
watch(() => route.params.transect, () => { fetchNow() })
</script>

<style scoped>
.ga-2 { gap: 8px; }
.flex-grow-1 { flex: 1; }
</style>