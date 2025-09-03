// Utilities
import { defineStore } from 'pinia'

const IDS_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?id[0:1:2464]'

// Fetch alongshore, areacode and areaname in one round-trip each
const ALONG_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?alongshore[0:1:2464]'
const AREA_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?areacode[0:1:2464],areaname[0:1:2464]'

const ID_LIST_CACHE_KEY = 'jarkus_id_list_v1'
const ALONG_CACHE_KEY = 'jarkus_along_list_v1'
const AREA_CACHE_KEY = 'jarkus_area_v1'

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

function tokenizeNumbers (block) {
  if (!block) {
    return []
  }
  // Grab only numeric tokens: optional sign, decimals, and exponent part.
  const matches = block.match(/[-+]?(?:\d+\.\d+|\d+\.|\.\d+|\d+)(?:[eE][-+]?\d+)?/g)
  if (!matches) {
    return []
  }
  return matches.map(Number)
}

function toYearLabels (timeVals) {
  if (!Array.isArray(timeVals) || timeVals.length === 0) {
    return []
  }

  const min = Math.min(...timeVals)
  const max = Math.max(...timeVals)

  // Heuristic: if the data already looks like calendar years, keep as-is
  if (min >= 1800 && max <= 2100) {
    return timeVals.map(v => String(Math.trunc(v)))
  }

  // Otherwise assume "days since 1970-01-01 00:00:00"
  const MS_PER_DAY = 86_400_000
  const epoch = Date.UTC(1970, 0, 1)

  return timeVals.map(d => {
    const t = new Date(epoch + d * MS_PER_DAY)
    return String(t.getUTCFullYear())
  })
}

/**
 * Robustly grab only the numeric/text payload that follows a header like:
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
  const rawTime = tokenizeNumbers(timeBlock)
  const time = toYearLabels(rawTime)

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
    if (flatAlt[i] === -9999) {
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

// --- helpers: parse strings list from payload (e.g., areaname) ---
function parseQuotedStringArray (payload) {
  if (!payload) {
    return []
  }
  const clean = stripOpendapIndices(payload)
  const matches = clean.match(/"([^"]*)"/g) || []
  return matches.map(s => s.replace(/^"/, '').replace(/"$/, '').trim())
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

    // alongshore
    loadingAlong: false,
    alongError: null,
    alongshoreList: [],

    // area info
    loadingArea: false,
    areaError: null,
    areacodeList: [],
    areanameList: [],

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

    // Parse only from the payload, ignoring the preamble "id[2465]"
    _parseIdList (ascii) {
      const payload = capturePayloadBlock(ascii, 'id')
      const clean = stripOpendapIndices(payload)
      const nums = tokenizeNumbers(clean)
      return nums.map(n => Number.parseInt(String(n), 10)).filter(Number.isFinite)
    },

    // --- Alongshore list (index per transect) ---
    async fetchAlongshoreList () {
      if (this.alongshoreList?.length) {
        return
      }

      const cached = localStorage.getItem(ALONG_CACHE_KEY)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          if (Array.isArray(obj.list) && obj.list.length > 0) {
            this.alongshoreList = obj.list
            return
          }
        } catch { /* ignore */ }
      }

      this.loadingAlong = true
      this.alongError = null
      try {
        const res = await fetch(ALONG_URL, { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`Failed to load alongshore list (${res.status})`)
        }
        const text = await res.text()
        const payload = capturePayloadBlock(text, 'alongshore')
        const clean = stripOpendapIndices(payload)
        const nums = tokenizeNumbers(clean)
        const list = nums.map(n => Number.parseInt(String(n), 10)).filter(Number.isFinite)
        if (list.length === 0) {
          throw new Error('Could not parse alongshore list')
        }
        this.alongshoreList = list
        localStorage.setItem(ALONG_CACHE_KEY, JSON.stringify({ list }))
      } catch (error) {
        this.alongError = error?.message || String(error)
      } finally {
        this.loadingAlong = false
      }
    },

    // --- Area info (areacode + areaname) ---
    async fetchAreaInfo () {
      if (this.areacodeList?.length && this.areanameList?.length) {
        return
      }

      const cached = localStorage.getItem(AREA_CACHE_KEY)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          if (Array.isArray(obj.codes) && Array.isArray(obj.names)
            && obj.codes.length > 0 && obj.codes.length === obj.names.length) {
            this.areacodeList = obj.codes
            this.areanameList = obj.names
            return
          }
        } catch { /* ignore */ }
      }

      this.loadingArea = true
      this.areaError = null
      try {
        const res = await fetch(AREA_URL, { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`Failed to load area info (${res.status})`)
        }
        const text = await res.text()

        const codeBlock = capturePayloadBlock(text, 'areacode')
        const nameBlock = capturePayloadBlock(text, 'areaname')

        const cleanCodes = stripOpendapIndices(codeBlock)
        const codes = tokenizeNumbers(cleanCodes)
          .map(n => Number.parseInt(String(n), 10))
          .filter(Number.isFinite)

        const names = parseQuotedStringArray(nameBlock)

        if (codes.length === 0 || names.length === 0 || codes.length !== names.length) {
          throw new Error('Area arrays size mismatch or empty')
        }

        this.areacodeList = codes
        this.areanameList = names

        localStorage.setItem(AREA_CACHE_KEY, JSON.stringify({ codes, names }))
      } catch (error) {
        this.areaError = error?.message || String(error)
      } finally {
        this.loadingArea = false
      }
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
