/// views/Home.vue
<template>
  <div class="pa-4">
    <v-card elevation="1" class="pa-4">
      <div class="text-h6 mb-2">OpenDAP raw fetch (front-end only)</div>

      <v-text-field
        v-model="url"
        label="OpenDAP .ascii URL"
        variant="outlined"
        density="comfortable"
        class="mb-3"
        hide-details
      />

      <div class="d-flex ga-2 mb-2">
        <v-btn :loading="loading" color="primary" @click="fetchNow">Fetch & Store</v-btn>
        <v-btn variant="tonal" @click="refreshFromCache">Load From Cache</v-btn>
        <v-btn variant="tonal" color="error" @click="clearCache">Clear Cache</v-btn>
        <v-btn :disabled="!hasData" variant="tonal" @click="downloadRaw">Download Raw</v-btn>
      </div>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        class="mb-3"
      >
        {{ error }}
      </v-alert>

      <v-alert
        v-if="hasData"
        type="info"
        variant="tonal"
        class="mb-3"
      >
        Stored <strong>{{ prettyLen }}</strong> characters
        <span v-if="fetchedAt"> at {{ new Date(fetchedAt).toLocaleString() }}</span>.
      </v-alert>

      <div v-if="hasData">
        <div class="text-subtitle-2 mb-1">Preview (first {{ previewCount }} chars):</div>
        <v-textarea
          :model-value="rawPreview"
          auto-grow
          rows="6"
          readonly
          variant="outlined"
          class="mb-3"
        />
      </div>

      <v-expansion-panels>
        <v-expansion-panel>
          <v-expansion-panel-title>What happens next?</v-expansion-panel-title>
          <v-expansion-panel-text>
            This page fetches the raw <code>.ascii</code> response and caches it in IndexedDB (with a
            localStorage fallback). You can process it later in-browser to derive the JSON structure used by your charts.
            Fill values like <code>-9999</code> are preserved as-is for now.
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()

// default to your provided OpenDAP ASCII URL
const url = ref(
  'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?cross_shore[0:1:2462],time[0:1:59],altitude[0:1:59][1551][0:1:2462]'
)

const loading   = computed(() => store.loading)
const error     = computed(() => store.error)
const hasData   = computed(() => !!store.rawText && store.rawText.length > 0)
const fetchedAt = computed(() => store.fetchedAt)
const prettyLen = computed(() => (store.rawText ? store.rawText.length.toLocaleString() : '0'))
const previewCount = 3000
const rawPreview = computed(() => (store.rawText ? store.rawText.slice(0, previewCount) : ''))

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
  a.download = 'transect.opendaP.ascii.txt'
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<style scoped>
.ga-2 { gap: 8px; }
</style>
