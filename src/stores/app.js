// stores/app.js
// Utilities
import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    loading: false,
    error: null,
    rawText: '',
    fetchedAt: null,
  }),
  actions: {
    async fetchOpendapAscii (url) {
      try {
        this.error = null
        this.loading = true

        // Fetch raw ASCII text directly from OpenDAP (frontend only).
        const res = await fetch(url, { credentials: 'omit' })
        if (!res.ok) {
          throw new Error(`OpenDAP fetch failed: ${res.status} ${res.statusText}`)
        }

        const text = await res.text()

        // Store in state
        this.rawText = text
        this.fetchedAt = Date.now()

        // Persist
        const payload = {
          sourceUrl: url,
          fetchedAt: this.fetchedAt,
          text,
        }
        await saveToStorage(url, payload)
      } catch (error) {
        this.error = error && error.message ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async loadFromCache (url) {
      try {
        this.error = null
        this.loading = true
        const cached = await loadFromStorage(url)
        if (cached) {
          this.rawText = cached.text || ''
          this.fetchedAt = cached.fetchedAt || null
        } else {
          this.error = 'No cache found for this URL.'
        }
      } catch (error) {
        this.error = error && error.message ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    async clearCache (url) {
      try {
        await removeFromStorage(url)
      } catch {
        // ignore, UI clear is still ok
      }
      // clear state too
      this.rawText = ''
      this.fetchedAt = null
      this.error = null
    },
  },
})

/* ---------- Minimal IndexedDB (with localStorage fallback) ---------- */

const KEY_PREFIX = 'opendap-cache:'

function hasIndexedDB () {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

function dbOpen () {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('opendap-db', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbPut (key, value) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

function idbGet (key) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly')
    const req = tx.objectStore('kv').get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

function idbDelete (key) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

async function saveToStorage (url, payload) {
  const key = KEY_PREFIX + url
  if (hasIndexedDB()) {
    await idbPut(key, payload)
  } else {
    localStorage.setItem(key, JSON.stringify(payload))
  }
}

async function loadFromStorage (url) {
  const key = KEY_PREFIX + url
  if (hasIndexedDB()) {
    return await idbGet(key)
  } else {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : null
  }
}

async function removeFromStorage (url) {
  const key = KEY_PREFIX + url
  if (hasIndexedDB()) {
    await idbDelete(key)
  } else {
    localStorage.removeItem(key)
  }
}
