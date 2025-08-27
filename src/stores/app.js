// Utilities
import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    // Default URL (you can change it at runtime with setTransectUrl)
    transectUrl: 'http://coastal-prod-blue.zdcxwh5vkz.eu-west-1.elasticbeanstalk.com/coastviewer/1.1.0/transects/9010730/plot/eeg',

    // Data + request state
    transectData: null, // raw JSON from the endpoint
    lastFetchedAt: null, // ISO timestamp
    loading: false,
    error: null,
  }),

  getters: {
    // Convenience getter that reshapes the payload into x + series-by-year
    seriesByYear: state => {
      const d = state.transectData?.data
      if (!Array.isArray(d) || d.length < 2) {
        return null
      }

      const [xRow, ...rest] = d
      const x = xRow.slice(1) // drop the "cross_shore" label

      const series = {}
      for (const arr of rest) {
        if (!Array.isArray(arr) || arr.length === 0) {
          continue
        }
        const [label, ...vals] = arr
        series[label] = vals
      }

      return { x, series } // { x: [...], series: { "2010": [...], "2011": [...], ... } }
    },
  },

  actions: {
    setTransectUrl (url) {
      this.transectUrl = url
    },

    async fetchTransectData (url) {
      this.loading = true
      this.error = null
      try {
        const target = url || this.transectUrl
        const res = await fetch(target, { headers: { Accept: 'application/json' } })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`)
        }
        const json = await res.json()

        this.transectData = json
        this.lastFetchedAt = new Date().toISOString()
      } catch (error) {
        this.error = error?.message || String(error)
        this.transectData = null
      } finally {
        this.loading = false
      }
    },
  },
})
