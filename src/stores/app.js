// Utilities
import { defineStore } from 'pinia'

const IDS_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?id[0:1:2464]'

const ID_LIST_CACHE_KEY = 'jarkus_id_list_v1'

export const useAppStore = defineStore('app', {
  state: () => ({
    // data fetch
    loading: false,
    error: null,
    rawText: '',
    fetchedAt: null,

    // id list (transect numbers)
    loadingIds: false,
    idsError: null,
    idList: [],
    idsFetchedAt: null,
  }),

  actions: {
    // --- Transect ID list (numbers) ---
    async fetchTransectIdList () {
      if (this.idList && this.idList.length > 0) {
        return
      }

      // try localStorage cache first
      const cached = localStorage.getItem(ID_LIST_CACHE_KEY)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          if (Array.isArray(obj.list) && obj.list.length > 0) {
            this.idList = obj.list
            this.idsFetchedAt = obj.when || null
            return
          }
        } catch { /* ignore */ }
      }

      // fetch fresh
      this.loadingIds = true
      this.idsError = null
      try {
        const res = await fetch(IDS_URL, { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`Failed to load transect catalog (${res.status})`)
        }
        const text = await res.text()
        const list = this._parseIdList(text)
        if (!list || list.length === 0) {
          throw new Error('Could not parse transect catalog')
        }
        this.idList = list
        this.idsFetchedAt = Date.now()
        localStorage.setItem(ID_LIST_CACHE_KEY, JSON.stringify({ list, when: this.idsFetchedAt }))
      } catch (error) {
        this.idsError = error?.message || String(error)
      } finally {
        this.loadingIds = false
      }
    },

    _parseIdList (ascii) {
      // Find the line that starts with "id[" then parse all integers after it.
      // The payload can be long and wrapped; we’ll just grab all numbers after the first "id[" occurrence.
      const anchor = ascii.indexOf('id[')
      const start = anchor === -1 ? 0 : ascii.indexOf('\n', anchor) + 1
      const tail = ascii.slice(start)
      const nums = tail.match(/-?\d+/g) || []
      // Convert to integers
      return nums.map(n => Number.parseInt(n, 10)).filter(Number.isFinite)
    },

    // --- OpenDAP data fetch & simple cache ---
    async fetchOpendapAscii (url) {
      if (!url) {
        return
      }
      this.loading = true
      this.error = null
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`Failed to fetch OpenDAP data (${res.status})`)
        }
        const text = await res.text()
        this.rawText = text
        this.fetchedAt = Date.now()
        // simple localStorage cache
        localStorage.setItem(this._cacheKey(url), JSON.stringify({ t: this.fetchedAt, data: text }))
      } catch (error) {
        this.error = error?.message || String(error)
      } finally {
        this.loading = false
      }
    },

    async loadFromCache (url) {
      if (!url) {
        return
      }
      try {
        const cache = localStorage.getItem(this._cacheKey(url))
        if (!cache) {
          this.error = 'No cached data for this URL.'
          return
        }
        const obj = JSON.parse(cache)
        this.rawText = obj.data || ''
        this.fetchedAt = obj.t || null
        this.error = null
      } catch {
        this.error = 'Failed to load from cache.'
      }
    },

    clearCache (url) {
      if (!url) {
        return
      }
      localStorage.removeItem(this._cacheKey(url))
    },

    _cacheKey (url) {
      return `opendap_cache::${url}`
    },
  },
})
