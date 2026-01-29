// stores/app.js
// Utilities
import { defineStore } from 'pinia'

const IDS_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?id[0:1:2464]'

// Fetch alongshore, areacode and areaname in one round-trip each
const ALONG_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?alongshore[0:1:2464]'
const AREA_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?areacode[0:1:2464],areaname[0:1:2464]'

// NEW: fetch rsp_x, rsp_y, rsp_lat, rsp_lon together
const RSP_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?rsp_x[0:1:2464],rsp_y[0:1:2464],rsp_lat[0:1:2464],rsp_lon[0:1:2464]'

// NEW: mean low/high water
const WATER_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?mean_high_water[0:1:2464],mean_low_water[0:1:2464]'

// BKL_TKL_TND dataset for basal coastline
const BKL_BASE_URL = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/BKL_TKL_MKL/BKL_TKL_TND.nc.ascii'

// MKL dataset for momentary coastline
const MKL_BASE_URL = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/BKL_TKL_MKL/MKL.nc.ascii'

// MHW_MLW dataset for mean high/low water
const MHW_MLW_BASE_URL = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/MHW_MLW/MHW_MLW.nc.ascii'

const ID_LIST_CACHE_KEY = 'jarkus_id_list_v1'
const ALONG_CACHE_KEY = 'jarkus_along_list_v1'
const AREA_CACHE_KEY = 'jarkus_area_v1'
const RSP_CACHE_KEY = 'jarkus_rsp_v1' // NEW
const WATER_CACHE_KEY = 'jarkus_water_v1' // NEW

// cache only if the text is smaller than this many chars (~bytes)
const MAX_LOCALSTORAGE_CACHE_SIZE = 500_000 // ~500 KB

// --- Helper: tolerant number tokenizer (float, int, sci, NaN) ---
const NUM_RE = /-?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][+-]?\d+)?|NaN/gi

// Pre-compile regex for better performance
const INDEX_PATTERN = /(^|\n)\s*(?:\[\d+\]){1,4},\s*/g
const NUM_PATTERN = /[-+]?(?:\d+\.\d+|\d+\.|\.\d+|\d+)(?:[eE][-+]?\d+)?/g

function stripOpendapIndices (block) {
  if (!block) {
    return ''
  }
  // Remove leading index tags per line: e.g. "[0][0], " or "[59][0], "
  // (^|\n) keep the break; {1,4} in case 2–3 indices appear
  return block.replace(INDEX_PATTERN, '$1')
}

function tokenizeNumbers (block) {
  if (!block) {
    return []
  }
  // Grab only numeric tokens: optional sign, decimals, and exponent part.
  const matches = block.match(NUM_PATTERN)
  if (!matches) {
    return []
  }
  // Use pre-allocated array for better performance
  const result = Array.from({ length: matches.length })
  for (const [i, match] of matches.entries()) {
    result[i] = Number(match)
  }
  return result
}

// NEW: Tokenizer that preserves NaN positions (maps them to null)
function tokenizeNumbersKeepNaN (block) {
  if (!block) {
    return []
  }
  const matches = block.match(NUM_RE) || []
  return matches.map(tok => (/^nan$/i.test(tok) ? null : Number(tok)))
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

// --- Parse coastline time series data (basal and testing) ---
function parseBasalCoastlineAscii (ascii) {
  // Extract time, basal_coastline, and testing_coastline blocks
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const basalBlock = capturePayloadBlock(ascii, 'basal_coastline')
  const testingBlock = capturePayloadBlock(ascii, 'testing_coastline')

  // Clean out index tags from payloads
  const cleanBasalBlock = stripOpendapIndices(basalBlock)
  const cleanTestingBlock = stripOpendapIndices(testingBlock)

  const timeValues = tokenizeNumbers(timeBlock)
  const basalValues = tokenizeNumbersKeepNaN(cleanBasalBlock)
  const testingValues = cleanTestingBlock ? tokenizeNumbersKeepNaN(cleanTestingBlock) : []

  if (timeValues.length === 0 || basalValues.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse time/basal_coastline arrays from payload. '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  // Convert time to year labels
  const years = toYearLabels(timeValues)

  // Handle missing values (-9999) - NaN is already converted to null by tokenizeNumbersKeepNaN
  const processedBasal = basalValues.map(v => (v === -9999 ? null : v))
  const processedTesting = testingValues.length > 0
    ? testingValues.map(v => (v === -9999 ? null : v))
    : []

  // Create data points: [year, basal_coastline_value]
  const dataPoints = years.map((year, i) => [year, processedBasal[i]])

  return {
    years,
    basalCoastline: processedBasal,
    testingCoastline: processedTesting,
    dataPoints,
  }
}

// --- Parse momentary coastline time series data ---
function parseMomentaryCoastlineAscii (ascii) {
  // Extract time and momentary_coastline blocks
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const momentaryBlock = capturePayloadBlock(ascii, 'momentary_coastline')

  // Clean out index tags from momentary_coastline payload
  const cleanMomentaryBlock = stripOpendapIndices(momentaryBlock)

  const timeValues = tokenizeNumbers(timeBlock)
  const momentaryValues = tokenizeNumbersKeepNaN(cleanMomentaryBlock)

  if (timeValues.length === 0 || momentaryValues.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse time/momentary_coastline arrays from payload. '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  // Convert time to year labels
  const years = toYearLabels(timeValues)

  // Handle missing values (-9999) - NaN is already converted to null by tokenizeNumbersKeepNaN
  const processedMomentary = momentaryValues.map(v => (v === -9999 ? null : v))

  return {
    years,
    momentaryCoastline: processedMomentary,
  }
}

// --- Parse mean high/low water cross time series data ---
function parseMeanHighWaterCrossAscii (ascii) {
  // Extract time, mean_high_water_cross, and mean_low_water_cross blocks
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const mhwBlock = capturePayloadBlock(ascii, 'mean_high_water_cross')
  const mlwBlock = capturePayloadBlock(ascii, 'mean_low_water_cross')

  // Clean out index tags from payloads
  const cleanMhwBlock = stripOpendapIndices(mhwBlock)
  const cleanMlwBlock = stripOpendapIndices(mlwBlock)

  const timeValues = tokenizeNumbers(timeBlock)
  const mhwValues = tokenizeNumbersKeepNaN(cleanMhwBlock)
  const mlwValues = cleanMlwBlock ? tokenizeNumbersKeepNaN(cleanMlwBlock) : []

  if (timeValues.length === 0 || mhwValues.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse time/mean_high_water_cross arrays from payload. '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  // Convert time to year labels
  const years = toYearLabels(timeValues)

  // Handle missing values (-9999) - NaN is already converted to null by tokenizeNumbersKeepNaN
  const processedMhw = mhwValues.map(v => (v === -9999 ? null : v))
  const processedMlw = mlwValues.length > 0
    ? mlwValues.map(v => (v === -9999 ? null : v))
    : []

  return {
    years,
    meanHighWaterCross: processedMhw,
    meanLowWaterCross: processedMlw,
  }
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

    // NEW: RSP info
    loadingRsp: false,
    rspError: null,
    rspXList: [],
    rspYList: [],
    rspLatList: [],
    rspLonList: [],

    // NEW: Mean water levels
    loadingWater: false,
    waterError: null,
    meanLowWaterList: [],
    meanHighWaterList: [],

    // Basal coastline time series data
    loadingBasal: false,
    basalError: null,
    basalYears: [],
    basalCoastline: [],
    testingCoastline: [],
    basalDataPoints: [],
    basalReady: false,
    basalFetchedAt: null,

    // Momentary coastline time series data
    loadingMomentary: false,
    momentaryError: null,
    momentaryYears: [],
    momentaryCoastline: [],
    momentaryReady: false,
    momentaryFetchedAt: null,

    // Mean high/low water cross time series data
    loadingMhw: false,
    mhwError: null,
    mhwYears: [],
    meanHighWaterCross: [],
    meanLowWaterCross: [],
    mhwReady: false,
    mhwFetchedAt: null,

    // fetch cancellation
    _aborter: null,
    _basalAborter: null,
    _momentaryAborter: null,
    _mhwAborter: null,
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

    // NEW --- RSP info (rsp_x, rsp_y, rsp_lat, rsp_lon) ---
    async fetchRspInfo () {
      if (this.rspXList?.length && this.rspYList?.length && this.rspLatList?.length && this.rspLonList?.length) {
        return
      }

      const cached = localStorage.getItem(RSP_CACHE_KEY)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          const ok = Array.isArray(obj.x) && Array.isArray(obj.y) && Array.isArray(obj.lat) && Array.isArray(obj.lon)
          if (ok && obj.x.length > 0 && obj.x.length === obj.y.length && obj.x.length === obj.lat.length && obj.x.length === obj.lon.length) {
            this.rspXList = obj.x
            this.rspYList = obj.y
            this.rspLatList = obj.lat
            this.rspLonList = obj.lon
            return
          }
        } catch { /* ignore */ }
      }

      this.loadingRsp = true
      this.rspError = null
      try {
        const res = await fetch(RSP_URL, { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`Failed to load RSP info (${res.status})`)
        }
        const text = await res.text()

        const xBlock = capturePayloadBlock(text, 'rsp_x')
        const yBlock = capturePayloadBlock(text, 'rsp_y')
        const latBlock = capturePayloadBlock(text, 'rsp_lat')
        const lonBlock = capturePayloadBlock(text, 'rsp_lon')

        const x = tokenizeNumbers(stripOpendapIndices(xBlock))
        const y = tokenizeNumbers(stripOpendapIndices(yBlock))
        const lat = tokenizeNumbers(stripOpendapIndices(latBlock))
        const lon = tokenizeNumbers(stripOpendapIndices(lonBlock))

        const n = x.length
        if (!n || y.length !== n || lat.length !== n || lon.length !== n) {
          throw new Error('RSP arrays size mismatch or empty')
        }

        this.rspXList = x
        this.rspYList = y
        this.rspLatList = lat
        this.rspLonList = lon

        localStorage.setItem(RSP_CACHE_KEY, JSON.stringify({ x, y, lat, lon }))
      } catch (error) {
        this.rspError = error?.message || String(error)
      } finally {
        this.loadingRsp = false
      }
    },

    // NEW --- Mean low/high water arrays ---
    async fetchWaterLevelsInfo () {
      if (this.meanLowWaterList?.length && this.meanHighWaterList?.length) {
        return
      }

      const cached = localStorage.getItem(WATER_CACHE_KEY)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          if (Array.isArray(obj.low) && Array.isArray(obj.high)
            && obj.low.length > 0 && obj.low.length === obj.high.length) {
            this.meanLowWaterList = obj.low
            this.meanHighWaterList = obj.high
            return
          }
        } catch { /* ignore */ }
      }

      this.loadingWater = true
      this.waterError = null
      try {
        const res = await fetch(WATER_URL, { cache: 'no-store' })
        if (!res.ok) {
          throw new Error(`Failed to load mean water levels (${res.status})`)
        }
        const text = await res.text()

        const highBlock = capturePayloadBlock(text, 'mean_high_water')
        const lowBlock = capturePayloadBlock(text, 'mean_low_water')

        const high = tokenizeNumbersKeepNaN(stripOpendapIndices(highBlock))
        const low = tokenizeNumbersKeepNaN(stripOpendapIndices(lowBlock))

        if (high.length === 0 || high.length !== low.length) {
          throw new Error('Water level arrays size mismatch or empty')
        }

        // Normalize: keep numbers; convert NaN to null (already done by tokenizer)
        this.meanHighWaterList = high
        this.meanLowWaterList = low

        localStorage.setItem(WATER_CACHE_KEY, JSON.stringify({ high, low }))
      } catch (error) {
        this.waterError = error?.message || String(error)
      } finally {
        this.loadingWater = false
      }
    },

    // --- Basal coastline time series fetch ---
    async fetchBasalCoastline (transectIndex) {
      if (transectIndex < 0 || transectIndex >= 2465) {
        this.basalError = 'Invalid transect index'
        return
      }

      // Build URL: time[0:1:63], basal_coastline[0:1:63][transectIndex], testing_coastline[0:1:63][transectIndex]
      const url = `${BKL_BASE_URL}?time[0:1:63],basal_coastline[0:1:63][${transectIndex}],testing_coastline[0:1:63][${transectIndex}]`

      // Check cache first
      const cacheKey = `bkl_cache::${url}`
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          const text = obj.data || ''
          if (text) {
            const parsed = parseBasalCoastlineAscii(text)
            this.basalYears = parsed.years
            this.basalCoastline = parsed.basalCoastline
            this.testingCoastline = parsed.testingCoastline
            this.basalDataPoints = parsed.dataPoints
            this.basalReady = true
            this.basalFetchedAt = obj.t || null
            this.basalError = null
            this.loadingBasal = false

            // Refresh cache in background
            this._refreshBasalCacheInBackground(url, cacheKey)
            return
          }
        } catch (error) {
          console.warn('Basal cache parse error, fetching fresh:', error)
        }
      }

      // Cancel any in-flight request
      if (this._basalAborter) {
        try {
          this._basalAborter.abort()
        } catch {
          // Silent abort error
        }
      }
      this._basalAborter = new AbortController()

      this.loadingBasal = true
      this.basalError = null
      this.basalReady = false
      this.basalYears = []
      this.basalCoastline = []
      this.testingCoastline = []
      this.basalDataPoints = []

      try {
        const res = await fetch(url, { cache: 'no-store', signal: this._basalAborter.signal })
        if (!res.ok) {
          throw new Error(`Failed to fetch basal coastline data (${res.status})`)
        }
        const text = await res.text()
        this.basalFetchedAt = Date.now()

        // Parse the data
        const parsed = parseBasalCoastlineAscii(text)
        this.basalYears = parsed.years
        this.basalCoastline = parsed.basalCoastline
        this.testingCoastline = parsed.testingCoastline
        this.basalDataPoints = parsed.dataPoints
        this.basalReady = true

        // Cache if reasonably small
        if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              t: this.basalFetchedAt,
              data: text,
            }))
          } catch {
            // Cache too large or storage full
          }
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          // Silent abort
        } else {
          this.basalError = error?.message || String(error)
        }
      } finally {
        this.loadingBasal = false
      }
    },

    // Background cache refresh for basal coastline
    async _refreshBasalCacheInBackground (url, cacheKey) {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const text = await res.text()
          if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                t: Date.now(),
                data: text,
              }))
            } catch {
              // Silent fail
            }
          }
        }
      } catch {
        // Silent fail for background refresh
      }
    },

    // --- Momentary coastline time series fetch ---
    async fetchMomentaryCoastline (transectIndex) {
      if (transectIndex < 0 || transectIndex >= 2465) {
        this.momentaryError = 'Invalid transect index'
        return
      }

      // Build URL: time[0:1:59], momentary_coastline[0:1:59][transectIndex]
      // Note: MKL dataset has time[time = 60], so range is [0:1:59]
      const url = `${MKL_BASE_URL}?time[0:1:59],momentary_coastline[0:1:59][${transectIndex}]`

      // Check cache first
      const cacheKey = `mkl_cache::${url}`
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          const text = obj.data || ''
          if (text) {
            const parsed = parseMomentaryCoastlineAscii(text)
            this.momentaryYears = parsed.years
            this.momentaryCoastline = parsed.momentaryCoastline
            this.momentaryReady = true
            this.momentaryFetchedAt = obj.t || null
            this.momentaryError = null
            this.loadingMomentary = false

            // Refresh cache in background
            this._refreshMomentaryCacheInBackground(url, cacheKey)
            return
          }
        } catch (error) {
          console.warn('Momentary cache parse error, fetching fresh:', error)
        }
      }

      // Cancel any in-flight request
      if (this._momentaryAborter) {
        try {
          this._momentaryAborter.abort()
        } catch {
          // Silent abort error
        }
      }
      this._momentaryAborter = new AbortController()

      this.loadingMomentary = true
      this.momentaryError = null
      this.momentaryReady = false
      this.momentaryYears = []
      this.momentaryCoastline = []

      try {
        const res = await fetch(url, { cache: 'no-store', signal: this._momentaryAborter.signal })
        if (!res.ok) {
          throw new Error(`Failed to fetch momentary coastline data (${res.status})`)
        }
        const text = await res.text()
        this.momentaryFetchedAt = Date.now()

        // Parse the data
        const parsed = parseMomentaryCoastlineAscii(text)
        this.momentaryYears = parsed.years
        this.momentaryCoastline = parsed.momentaryCoastline
        this.momentaryReady = true

        // Cache if reasonably small
        if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              t: this.momentaryFetchedAt,
              data: text,
            }))
          } catch {
            // Cache too large or storage full
          }
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          // Silent abort
        } else {
          this.momentaryError = error?.message || String(error)
        }
      } finally {
        this.loadingMomentary = false
      }
    },

    // Background cache refresh for momentary coastline
    async _refreshMomentaryCacheInBackground (url, cacheKey) {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const text = await res.text()
          if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                t: Date.now(),
                data: text,
              }))
            } catch {
              // Silent fail
            }
          }
        }
      } catch {
        // Silent fail for background refresh
      }
    },

    // --- Mean high water cross time series fetch ---
    async fetchMeanHighWaterCross (transectIndex) {
      if (transectIndex < 0 || transectIndex >= 2465) {
        this.mhwError = 'Invalid transect index'
        return
      }

      // Build URL: time[0:1:182], mean_high_water_cross[0:1:182][transectIndex], mean_low_water_cross[0:1:182][transectIndex]
      // Note: MHW_MLW dataset has time[time = 183], so range is [0:1:182]
      const url = `${MHW_MLW_BASE_URL}?time[0:1:182],mean_high_water_cross[0:1:182][${transectIndex}],mean_low_water_cross[0:1:182][${transectIndex}]`

      // Check cache first
      const cacheKey = `mhw_cache::${url}`
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          const text = obj.data || ''
          if (text) {
            const parsed = parseMeanHighWaterCrossAscii(text)
            this.mhwYears = parsed.years
            this.meanHighWaterCross = parsed.meanHighWaterCross
            this.meanLowWaterCross = parsed.meanLowWaterCross
            this.mhwReady = true
            this.mhwFetchedAt = obj.t || null
            this.mhwError = null
            this.loadingMhw = false

            // Refresh cache in background
            this._refreshMhwCacheInBackground(url, cacheKey)
            return
          }
        } catch (error) {
          console.warn('MHW cache parse error, fetching fresh:', error)
        }
      }

      // Cancel any in-flight request
      if (this._mhwAborter) {
        try {
          this._mhwAborter.abort()
        } catch {
          // Silent abort error
        }
      }
      this._mhwAborter = new AbortController()

      this.loadingMhw = true
      this.mhwError = null
      this.mhwReady = false
      this.mhwYears = []
      this.meanHighWaterCross = []
      this.meanLowWaterCross = []

      try {
        const res = await fetch(url, { cache: 'no-store', signal: this._mhwAborter.signal })
        if (!res.ok) {
          throw new Error(`Failed to fetch mean high water cross data (${res.status})`)
        }
        const text = await res.text()
        this.mhwFetchedAt = Date.now()

        // Parse the data
        const parsed = parseMeanHighWaterCrossAscii(text)
        this.mhwYears = parsed.years
        this.meanHighWaterCross = parsed.meanHighWaterCross
        this.meanLowWaterCross = parsed.meanLowWaterCross
        this.mhwReady = true

        // Cache if reasonably small
        if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              t: this.mhwFetchedAt,
              data: text,
            }))
          } catch {
            // Cache too large or storage full
          }
        }
      } catch (error) {
        if (error?.name === 'AbortError') {
          // Silent abort
        } else {
          this.mhwError = error?.message || String(error)
        }
      } finally {
        this.loadingMhw = false
      }
    },

    // Background cache refresh for mean high water cross
    async _refreshMhwCacheInBackground (url, cacheKey) {
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const text = await res.text()
          if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
            try {
              localStorage.setItem(cacheKey, JSON.stringify({
                t: Date.now(),
                data: text,
              }))
            } catch {
              // Silent fail
            }
          }
        }
      } catch {
        // Silent fail for background refresh
      }
    },

    // --- OpenDAP data fetch & cautious cache + parsing to chart format ---
    async fetchOpendapAscii (url) {
      if (!url) {
        return
      }

      // Check cache FIRST before making network request for instant loading
      const cacheKey = this._cacheKey(url)
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          const text = obj.data || ''
          if (text) {
            // Parse cached data immediately (synchronous, fast)
            const parsed = parseOpendapAscii(text)
            this.chartData = parsed.chartData
            this.years = parsed.years
            this.crossShore = parsed.crossShore
            this.altitudeByYear = parsed.altitudeByYear
            this.chartReady = true
            this.rawText = text
            this.fetchedAt = obj.t || null
            this.error = null
            this.warning = null
            this.loading = false

            // Still fetch in background to refresh cache (non-blocking)
            this._refreshCacheInBackground(url)
            return
          }
        } catch (error) {
          // Cache corrupted, continue to fetch
          console.warn('Cache parse error, fetching fresh:', error)
        }
      }

      // Cancel any in-flight request
      if (this._aborter) {
        try {
          this._aborter.abort()
        } catch {
          // Silent abort error
        }
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
            localStorage.setItem(cacheKey, JSON.stringify({ t: this.fetchedAt, data: text }))
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

    // Background cache refresh (non-blocking)
    async _refreshCacheInBackground (url) {
      // Silently refresh cache in background without blocking UI
      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (res.ok) {
          const text = await res.text()
          if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
            try {
              localStorage.setItem(this._cacheKey(url), JSON.stringify({
                t: Date.now(),
                data: text,
              }))
            } catch {
              // Silent fail for background refresh
            }
          }
        }
      } catch {
        // Silent fail for background refresh
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
