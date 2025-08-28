// stores/app.js
// Utilities
import { defineStore } from 'pinia'

const IDS_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?id[0:1:2464]'

const ID_LIST_CACHE_KEY = 'jarkus_id_list_v1'

// cache only if the text is smaller than this many chars (~bytes)
const MAX_LOCALSTORAGE_CACHE_SIZE = 500_000 // ~500 KB

// --- Helper: tolerant number tokenizer (float, int, sci, NaN) ---
const NUM_RE = /-?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][+-]?\d+)?|NaN/gi

function stripOpendapIndices (block) {
  if (!block) {
    return ''
  }
  // Remove leading index tags per line: e.g. "[0][0], " or "[59][0], "
  // (^|\n) keep the break; {1,4} in case 2–3 indices appear
  return block.replace(/(^|\n)\s*(?:\[\d+\]){1,4},\s*/g, '$1')
}

function tokenizeNumbers (text) {
  const out = []
  let m
  while ((m = NUM_RE.exec(text)) !== null) {
    const token = m[0]
    if (token === 'NaN') {
      out.push(null)
    } else {
      const v = Number(token)
      out.push(Number.isFinite(v) ? v : null)
    }
  }
  return out
}

/**
 * Robustly grab only the numeric payload that follows a header like:
 *   altitude[time = 60][alongshore = 1][cross_shore = 2463]
 *   cross_shore[2463]
 *   cross_shore [0:1:2462]
 *
 * IMPORTANT: OpenDAP .ascii has a preamble ("Dataset { ... }") and then
 * a dashed separator line. Only AFTER that line do the numeric payload
 * headers appear. We must ignore/pre-skip the preamble to avoid matching
 * its structural/metadata headers.
 */
function capturePayloadBlock (asciiRaw, varName) {
  if (!asciiRaw) {
    return ''
  }

  // Normalize endings
  const ascii = asciiRaw.replace(/\r\n/g, '\n')

  // 1) Find the dashed separator line and work only on the tail
  const sepMatch = /^\s*-{5,}\s*$/m.exec(ascii)
  const searchBase = sepMatch
    ? ascii.slice(sepMatch.index + sepMatch[0].length)
    : ascii // fallback: no separator found; search whole text

  // 2) In the payload section, find the header line for this var
  // accept things like: altitude.altitude[60][1][2463]
  // and also possible namespaces like foo.bar.altitude[...]
  const headerRe = new RegExp(
    String.raw`^\s*(?:[\w]+\.)*${varName}\s*(?:\[[^\n]*\]\s*)+\s*$`,
    'm',
  )
  const m = headerRe.exec(searchBase)
  if (!m) {
    return ''
  }

  const start = m.index + m[0].length
  const tail = searchBase.slice(start)

  // 3) Capture until the next payload header or EOF
  // next header may also be dotted
  const nextHeaderRe = /^\s*[\w.]+\s*(?:\[[^\n]*\]\s*)+\s*$/m
  const n = nextHeaderRe.exec(tail)
  const end = n ? n.index : tail.length

  return tail.slice(0, end)
}

// --- Helper: build chart rows in requested format ---
function buildChartData (crossShore, times, altitude2D) {
  // Years (string labels)
  const years = times.map(t => {
    if (t != null && Math.abs(t) >= 1500 && Math.abs(t) <= 3000) {
      return String(Math.round(t))
    }
    return `t${Math.round(t ?? 0)}`
  })

  // Compose rows: first row is cross_shore axis
  const rows = []
  rows.push(['cross_shore', ...crossShore])

  // For each time slice, add a row ["YYYY", ...altRow]
  for (const [ti, year] of years.entries()) {
    rows.push([year, ...(altitude2D[ti] || [])])
  }

  return {
    crossShore,
    years,
    altitudeByYear: altitude2D,
    chartData: { data: rows },
  }
}

// --- Parse full ASCII payload into arrays we need ---
function parseOpendapAscii (ascii) {
  // Extract payload blocks by variable name (tolerant to spaces/CRLF)
  const crossBlock = capturePayloadBlock(ascii, 'cross_shore')
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const altBlock = capturePayloadBlock(ascii, 'altitude')

  // Clean out index tags from altitude payload before tokenizing
  const cleanAltBlock = stripOpendapIndices(altBlock)

  const cross = tokenizeNumbers(crossBlock)
  const time = tokenizeNumbers(timeBlock)

  if (cross.length === 0 || time.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse cross_shore/time arrays from payload. '
      + 'Check that the .ascii response includes headers like "cross_shore[...]" and "time[...]". '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  // altitude is a flat list; we reshape to [time.length][cross.length]
  const flatAlt = tokenizeNumbers(cleanAltBlock)
  const T = time.length
  const X = cross.length

  for (let i = 0; i < flatAlt.length; i++) {
    if (flatAlt[i] === -9999 || flatAlt[i] === -9999) {
      flatAlt[i] = null
    }
  }

  if (flatAlt.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse altitude array from payload. '
      + 'Ensure the .ascii request includes "altitude[...]". '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  let altitude2D

  // Expected layout: T rows, each with X values (alongshore=1 collapses away)
  switch (flatAlt.length) {
    case T * X: {
      altitude2D = new Array(T)
      let p = 0
      for (let t = 0; t < T; t++) {
        const row = new Array(X)
        for (let x = 0; x < X; x++, p++) {
          row[x] = flatAlt[p] ?? null
        }
        altitude2D[t] = row
      }

      break
    }
    case X * T: {
    // Some servers may emit the other order; try transpose
      altitude2D = new Array(T)
      for (let t = 0; t < T; t++) {
        const row = new Array(X)
        for (let x = 0; x < X; x++) {
          row[x] = flatAlt[x * T + t] ?? null
        }
        altitude2D[t] = row
      }

      break
    }
    case T * 1 * X: {
    // Safety: if alongshore dimension leaked into the flat stream
      altitude2D = new Array(T)
      let p = 0
      for (let t = 0; t < T; t++) {
        const row = new Array(X)
        for (let a = 0; a < 1; a++) {
          for (let x = 0; x < X; x++, p++) {
            row[x] = flatAlt[p] ?? null
          }
        }
        altitude2D[t] = row
      }

      break
    }
    default: {
      throw new Error(
        `Altitude size mismatch: got ${flatAlt.length}, expected ${T}×${X}=${T * X}.`,
      )
    }
  }

  return buildChartData(cross, time, altitude2D)
}

export const useAppStore = defineStore('app', {
  state: () => ({
    // data fetch
    loading: false,
    error: null,
    warning: null, // non-blocking issues (e.g., cache skipped)
    rawText: '',
    fetchedAt: null,

    // derived for charts
    chartReady: false,
    chartData: null, // { data: [...] } in your requested structure
    years: [], // e.g., ["2010","2011",...]
    crossShore: [], // number[]
    altitudeByYear: [], // number[][] with nulls preserved

    // id list (transect numbers)
    loadingIds: false,
    idsError: null,
    idList: [],
    idsFetchedAt: null,

    // fetch cancellation
    _aborter: null,
  }),

  actions: {
    // --- Transect ID list (numbers) ---
    async fetchTransectIdList () {
      if (this.idList && this.idList.length > 0) {
        return
      }

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
      const anchor = ascii.indexOf('id[')
      const start = anchor === -1 ? 0 : ascii.indexOf('\n', anchor) + 1
      const tail = (ascii || '').slice(start)
      const nums = tail.match(/-?\d+/g) || []
      return nums.map(n => Number.parseInt(n, 10)).filter(Number.isFinite)
    },

    // --- OpenDAP data fetch & cautious cache + parsing to chart format ---
    async fetchOpendapAscii (url) {
      if (!url) {
        return
      }
      // Cancel any in-flight request
      if (this._aborter) {
        try {
          this._aborter.abort()
        } catch {}
      }
      this._aborter = new AbortController()

      this.loading = true
      this.error = null
      this.warning = null
      this.chartReady = false
      this.chartData = null
      this.years = []
      this.crossShore = []
      this.altitudeByYear = []
      try {
        const res = await fetch(url, { cache: 'no-store', signal: this._aborter.signal })
        if (!res.ok) {
          throw new Error(`Failed to fetch OpenDAP data (${res.status})`)
        }
        const text = await res.text()
        this.rawText = text
        this.fetchedAt = Date.now()

        // Parse immediately to target format
        const parsed = parseOpendapAscii(text)
        this.chartData = parsed.chartData
        this.years = parsed.years
        this.crossShore = parsed.crossShore
        this.altitudeByYear = parsed.altitudeByYear
        this.chartReady = true

        // Try to cache only if reasonably small
        if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
          try {
            localStorage.setItem(this._cacheKey(url), JSON.stringify({ t: this.fetchedAt, data: text }))
          } catch {
            this.warning = 'Data fetched and parsed, but too large to cache locally. It will not be stored for offline reuse.'
          }
        } else {
          this.warning = 'Data fetched and parsed, but skipped local caching due to size.'
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          // Silent abort
        } else {
          this.error = error?.message || String(error)
        }
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
        const text = obj.data || ''
        this.rawText = text
        this.fetchedAt = obj.t || null
        this.error = null
        this.warning = null

        // also parse cached text to chartData
        const parsed = parseOpendapAscii(text)
        this.chartData = parsed.chartData
        this.years = parsed.years
        this.crossShore = parsed.crossShore
        this.altitudeByYear = parsed.altitudeByYear
        this.chartReady = true
      } catch (error) {
        this.error = error?.message || 'Failed to load/parse cache.'
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
