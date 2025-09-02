<template>
  <aside class="side-panel">
    <div class="panel-inner">
      <div class="label">Transect</div>
      <div class="value">{{ transectNum }}</div>
    </div>
  </aside>
</template>

<script setup>
const props = defineProps({
  transectNum: {
    type: Number,
    required: true,
  },
})
</script>

<style scoped>
.side-panel {
  width: 220px;
  min-width: 200px;
  max-width: 280px;
  border-right: 1px solid rgba(0,0,0,0.08);
  background: #fafafa;
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-inner {
  padding: 16px;
  width: 100%;
  text-align: center;
}

.label {
  font-size: 12px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: #777;
  margin-bottom: 6px;
}

.value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  color: #111;
  word-break: break-word;
}
</style>
