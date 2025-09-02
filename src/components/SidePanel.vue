<template>
  <aside class="panel">
    <div class="panel__title">Transect</div>
    <div class="panel__value">{{ transectNum }}</div>

    <div class="panel__title mt">Alongshore</div>
    <div class="panel__value">
      <template v-if="alongshoreAtIndex != null">
        {{ formatNumber(alongshoreAtIndex) }} m
      </template>
      <template v-else>—</template>
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useAppStore } from '@/stores/app'

const props = defineProps({
  transectNum: {
    type: Number,
    required: true,
  },
})

const store = useAppStore()

// Ensure the lists are loaded (cheap no-ops if already loaded)
onMounted(async () => {
  if (!store.idList?.length) {
    await store.fetchTransectIdList()
  }
  if (!store.alongshoreList?.length) {
    await store.fetchAlongshoreList()
  }
})

const wantedIndex = computed(() => {
  if (!store.idList?.length) return -1
  return store.idList.indexOf(props.transectNum)
})

const alongshoreAtIndex = computed(() => {
  const idx = wantedIndex.value
  if (idx < 0) return null
  const arr = store.alongshoreList || []
  return idx < arr.length ? arr[idx] : null
})

function formatNumber (n) {
  // You can tweak this to a fixed precision if needed
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 })
}
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
}

.mt { margin-top: 16px; }
</style>
