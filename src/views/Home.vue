<template>
  <v-container class="py-8" max-width="900">
    <v-row class="align-center justify-space-between">
      <v-col cols="12" md="8">
        <h1 class="text-h5 mb-2">Transect data loader</h1>
        <div class="text-body-2">
          URL: <code>{{ store.transectUrl }}</code>
        </div>
      </v-col>
      <v-col cols="12" md="4" class="text-right">
        <v-btn :loading="store.loading" @click="reload" color="primary">Reload data</v-btn>
      </v-col>
    </v-row>

    <v-divider class="my-4" />

    <div v-if="store.loading" class="d-flex align-center">
      <v-progress-circular indeterminate class="mr-3" />
      <span>Fetching JSON…</span>
    </div>

    <v-alert v-else-if="store.error" type="error" variant="tonal" class="mb-4">
      {{ store.error }}
    </v-alert>

    <v-alert v-else-if="store.transectData" type="success" variant="tonal" class="mb-4">
      Loaded! <strong>{{ pointCount }}</strong> values across <strong>{{ yearCount }}</strong> series.
      <div v-if="store.lastFetchedAt" class="mt-1 text-caption">Last fetched: {{ store.lastFetchedAt }}</div>
    </v-alert>

    <v-card v-if="store.seriesByYear" variant="outlined">
      <v-card-title class="text-subtitle-1">Shape preview</v-card-title>
      <v-card-text class="text-body-2">
        <div>cross_shore points: <strong>{{ store.seriesByYear.x.length }}</strong></div>
        <div>years (keys): <strong>{{ Object.keys(store.seriesByYear.series).length }}</strong></div>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { onMounted, computed } from 'vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()

const reload = () => store.fetchTransectData()

onMounted(() => {
  if (!store.transectData) reload()
})

const pointCount = computed(() => {
  const d = store.transectData?.data
  if (!Array.isArray(d)) return 0
  // Sum lengths minus label per row; rough sanity metric
  return d.reduce((sum, row) => sum + (Array.isArray(row) ? Math.max(0, row.length - 1) : 0), 0)
})

const yearCount = computed(() => {
  const d = store.transectData?.data
  return Array.isArray(d) ? Math.max(0, d.length - 1) : 0
})
</script>