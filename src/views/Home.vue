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
          Choose another number.
        </v-alert>

        <v-alert v-else type="info" variant="tonal" class="mb-3">
          Slug <strong>{{ currentTransectNum }}</strong> maps to index
          <strong>{{ wantedIndex }}</strong>.  
          URL: <span class="text-caption">{{ url }}</span>
        </v-alert>

        <div class="d-flex ga-2 mb-2">
          <v-btn :loading="loading" color="primary" @click="fetchNow" :disabled="indexNotFound">Fetch & Store</v-btn>
          <v-btn variant="tonal" @click="refreshFromCache" :disabled="indexNotFound">Load From Cache</v-btn>
          <v-btn variant="tonal" color="error" @click="clearCache" :disabled="indexNotFound">Clear Cache</v-btn>
          <v-btn :disabled="!hasData" variant="tonal" @click="downloadRaw">Download Raw</v-btn>
        </div>

        <div v-if="error" class="mb-2">
          <v-alert type="error" variant="tonal">{{ error }}</v-alert>
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
      </template>

      <v-expansion-panels>
        <v-expansion-panel>
          <v-expansion-panel-title>How this works</v-expansion-panel-title>
          <v-expansion-panel-text>
            The last URL segment (e.g. <code>/1000475</code>) is the <em>transect number</em>. We first
            load the catalog of all transect numbers, find this number’s position (its index in
            the alongshore axis), then build the OpenDAP <code>.ascii</code> query using that index.
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

const DEFAULT_TRANSECT_NUMBER = 1000475 // pick a sensible default that exists in the catalog

const route = useRoute()
const router = useRouter()
const store = useAppStore()

// store bindings
const loading     = computed(() => store.loading)
const error       = computed(() => store.error)
const hasData     = computed(() => !!store.rawText && store.rawText.length > 0)
const fetchedAt   = computed(() => store.fetchedAt)
const prettyLen   = computed(() => (store.rawText ? store.rawText.length.toLocaleString() : '0'))
const previewCount = 3000
const rawPreview  = computed(() => (store.rawText ? store.rawText.slice(0, previewCount) : ''))

const loadingIds  = computed(() => store.loadingIds)
const idsError    = computed(() => store.idsError)
const idList      = computed(() => store.idList)

// current slug as a number (transect number)
const currentTransectNum = computed(() => {
  const raw = route.params.transectNum
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TRANSECT_NUMBER
})

// find index in id list
const wantedIndex = computed(() => {
  if (!idList.value || idList.value.length === 0) return -1
  return idList.value.indexOf(currentTransectNum.value)
})
const indexNotFound = computed(() => wantedIndex.value < 0)

// build OpenDAP URL using the resolved index
const url = computed(() => {
  if (indexNotFound.value) return ''
  const idx = wantedIndex.value
  return `https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?cross_shore[0:1:2462],time[0:1:59],altitude[0:1:59][${idx}][0:1:2462]`
})

// UI field to jump to a different transect number (kept in sync with slug)
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

function downloadRaw () {
  if (!store.rawText) return
  const blob = new Blob([store.rawText], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `transect_${currentTransectNum.value}.ascii.txt`
  a.click()
  URL.revokeObjectURL(a.href)
}

function reload () {
  fetchNow()
}

// bootstrap: load id list first, then fetch data for current slug
onMounted(async () => {
  await store.fetchTransectIdList()
  if (!indexNotFound.value) {
    await fetchNow()
  }
})

// refetch when the slug changes (after id list is ready)
watch(() => route.params.transectNum, async () => {
  if (!idList.value || idList.value.length === 0) {
    await store.fetchTransectIdList()
  }
  if (!indexNotFound.value) {
    await fetchNow()
  }
})
</script>

<style scoped>
.ga-2 { gap: 8px; }
.flex-grow-1 { flex: 1; }
</style>