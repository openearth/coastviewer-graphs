import { defineStore } from 'pinia'

const IDS_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?id[0:1:2464]'
const ALONG_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?alongshore[0:1:2464]'
const AREA_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?areacode[0:1:2464],areaname[0:1:2464]'
const RSP_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?rsp_x[0:1:2464],rsp_y[0:1:2464],rsp_lat[0:1:2464],rsp_lon[0:1:2464]'
const WATER_URL
  = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc.ascii?mean_high_water[0:1:2464],mean_low_water[0:1:2464]'

const BKL_BASE_URL = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/BKL_TKL_MKL/BKL_TKL_TND.nc.ascii'
const MKL_BASE_URL = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/BKL_TKL_MKL/MKL.nc.ascii'
const MHW_MLW_BASE_URL = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/MHW_MLW/MHW_MLW.nc.ascii'
const DF_BASE_URL = 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/DuneFoot/DF.nc.ascii'

const ID_LIST_CACHE_KEY = 'jarkus_id_list_v1'
const ALONG_CACHE_KEY = 'jarkus_along_list_v1'
const AREA_CACHE_KEY = 'jarkus_area_v1'
const RSP_CACHE_KEY = 'jarkus_rsp_v1'
const WATER_CACHE_KEY = 'jarkus_water_v1'
const TIME_DIMENSION_CACHE_KEY = 'jarkus_time_dimension_v1'

// Per-dataset time dimension lookup (DDS + 24h cache)
const DATASET_TIME_CONFIG = {
  transect: {
    ncBaseUrl: 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/jarkus/profiles/transect.nc',
    cacheKey: TIME_DIMENSION_CACHE_KEY,
    fallbackSize: 61,
  },
  bkl: {
    ncBaseUrl: 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/BKL_TKL_MKL/BKL_TKL_TND.nc',
    cacheKey: 'jarkus_bkl_time_dimension_v1',
    fallbackSize: 66,
  },
  mkl: {
    ncBaseUrl: 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/BKL_TKL_MKL/MKL.nc',
    cacheKey: 'jarkus_mkl_time_dimension_v1',
    fallbackSize: 61,
  },
  mhw: {
    ncBaseUrl: 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/MHW_MLW/MHW_MLW.nc',
    cacheKey: 'jarkus_mhw_time_dimension_v1',
    fallbackSize: 183,
  },
  df: {
    ncBaseUrl: 'https://opendap.deltares.nl/thredds/dodsC/opendap/rijkswaterstaat/DuneFoot/DF.nc',
    cacheKey: 'jarkus_df_time_dimension_v1',
    fallbackSize: 183,
  },
}

const TIME_DIMENSION_CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000
const MAX_LOCALSTORAGE_CACHE_SIZE = 500_000

const NUM_RE = /-?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][+-]?\d+)?|NaN/gi
const INDEX_PATTERN = /(^|\n)\s*(?:\[\d+\]){1,4},\s*/g
const NUM_PATTERN = /[-+]?(?:\d+\.\d+|\d+\.|\.\d+|\d+)(?:[eE][-+]?\d+)?/g

function stripOpendapIndices (block) {
  if (!block) {
    return ''
  }
  return block.replace(INDEX_PATTERN, '$1')
}

function tokenizeNumbers (block) {
  if (!block) {
    return []
  }
  const matches = block.match(NUM_PATTERN)
  if (!matches) {
    return []
  }
  return matches.map(Number)
}

function tokenizeNumbersKeepNaN (block) {
  if (!block) {
    return []
  }
  const matches = block.match(NUM_RE) || []
  return matches.map(tok => (/^nan$/i.test(tok) ? null : Number(tok)))
}

function parseTimeDimensionFromDds (ddsText) {
  const timeDimMatch = ddsText.match(/time\s*\[time\s*=\s*(\d+)\s*\]/i)
  if (timeDimMatch?.[1]) {
    const size = Number.parseInt(timeDimMatch[1], 10)
    if (size > 0) {
      return size
    }
  }
  return null
}

async function parseTimeDimensionFromAsciiError (asciiBaseUrl) {
  const testUrl = `${asciiBaseUrl}?time[0:1:9999]`
  const res = await fetch(testUrl, { cache: 'no-store' })
  if (!res.ok) {
    const errorText = await res.text()
    const sizeMatch = errorText.match(/stop\s*>=\s*size:\s*\d+:\s*(\d+)/i)
    if (sizeMatch?.[1]) {
      const size = Number.parseInt(sizeMatch[1], 10)
      if (size > 0) {
        return size
      }
    }
  }
  return null
}

async function resolveDatasetTimeDimensionSize (config) {
  const cached = localStorage.getItem(config.cacheKey)
  if (cached) {
    try {
      const obj = JSON.parse(cached)
      const age = Date.now() - (obj.timestamp || 0)
      if (typeof obj.size === 'number' && obj.size > 0 && age < TIME_DIMENSION_CACHE_EXPIRATION_MS) {
        return obj.size
      }
    } catch { /* ignore */ }
  }

  try {
    const ddsUrl = `${config.ncBaseUrl}.dds`
    const res = await fetch(ddsUrl, { cache: 'no-store' })
    if (res.ok) {
      const ddsText = await res.text()
      const size = parseTimeDimensionFromDds(ddsText)
      if (size) {
        localStorage.setItem(config.cacheKey, JSON.stringify({ size, timestamp: Date.now() }))
        return size
      }
    }
  } catch { /* try fallback below */ }

  try {
    const size = await parseTimeDimensionFromAsciiError(`${config.ncBaseUrl}.ascii`)
    if (size) {
      localStorage.setItem(config.cacheKey, JSON.stringify({ size, timestamp: Date.now() }))
      return size
    }
  } catch { /* use hardcoded fallback */ }

  return config.fallbackSize
}

/** @type {Map<string, Promise<number>>} */
const timeDimensionInflight = new Map()

function refreshAsciiCacheInBackground (url, cacheKey) {
  fetch(url, { cache: 'no-store' })
    .then(res => (res.ok ? res.text() : null))
    .then(text => {
      if (text && text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: text }))
        } catch { /* storage full */ }
      }
    })
    .catch(() => {})
}

function nullifySentinel (values) {
  return values.map(v => (v === -9999 ? null : v))
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

function buildChartData (crossShore, times, altitude2D) {
  const years = times.map(t => {
    if (t != null && Math.abs(t) >= 1500 && Math.abs(t) <= 3000) {
      return String(Math.round(t))
    }
    return `t${Math.round(t ?? 0)}`
  })

  return {
    crossShore,
    years,
    altitudeByYear: altitude2D,
  }
}

function parseOpendapAscii (ascii) {
  const crossBlock = capturePayloadBlock(ascii, 'cross_shore')
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const altBlock = capturePayloadBlock(ascii, 'altitude')

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

  // altitude is a flat list reshaped to [time][cross_shore]
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

function parseQuotedStringArray (payload) {
  if (!payload) {
    return []
  }
  const clean = stripOpendapIndices(payload)
  const matches = clean.match(/"([^"]*)"/g) || []
  return matches.map(s => s.replace(/^"/, '').replace(/"$/, '').trim())
}

function parseBasalCoastlineAscii (ascii) {
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const basalBlock = capturePayloadBlock(ascii, 'basal_coastline')
  const testingBlock = capturePayloadBlock(ascii, 'testing_coastline')

  const timeValues = tokenizeNumbers(timeBlock)
  const basalValues = tokenizeNumbersKeepNaN(stripOpendapIndices(basalBlock))
  const testingValues = testingBlock
    ? tokenizeNumbersKeepNaN(stripOpendapIndices(testingBlock))
    : []

  if (timeValues.length === 0 || basalValues.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse time/basal_coastline arrays from payload. '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  return {
    years: toYearLabels(timeValues),
    basalCoastline: nullifySentinel(basalValues),
    testingCoastline: testingValues.length > 0 ? nullifySentinel(testingValues) : [],
  }
}

function parseMomentaryCoastlineAscii (ascii) {
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const momentaryBlock = capturePayloadBlock(ascii, 'momentary_coastline')

  const timeValues = tokenizeNumbers(timeBlock)
  const momentaryValues = tokenizeNumbersKeepNaN(stripOpendapIndices(momentaryBlock))

  if (timeValues.length === 0 || momentaryValues.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse time/momentary_coastline arrays from payload. '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  return {
    momentaryCoastline: nullifySentinel(momentaryValues),
  }
}

function parseMeanHighWaterCrossAscii (ascii) {
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const mhwBlock = capturePayloadBlock(ascii, 'mean_high_water_cross')
  const mlwBlock = capturePayloadBlock(ascii, 'mean_low_water_cross')

  const timeValues = tokenizeNumbers(timeBlock)
  const mhwValues = tokenizeNumbersKeepNaN(stripOpendapIndices(mhwBlock))
  const mlwValues = mlwBlock ? tokenizeNumbersKeepNaN(stripOpendapIndices(mlwBlock)) : []

  if (timeValues.length === 0 || mhwValues.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse time/mean_high_water_cross arrays from payload. '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  return {
    years: toYearLabels(timeValues),
    meanHighWaterCross: nullifySentinel(mhwValues),
    meanLowWaterCross: mlwValues.length > 0 ? nullifySentinel(mlwValues) : [],
  }
}

function parseDuneFootThreeNAPCrossAscii (ascii) {
  const timeBlock = capturePayloadBlock(ascii, 'time')
  const dfBlock = capturePayloadBlock(ascii, 'dune_foot_threeNAP_cross')

  const timeValues = tokenizeNumbers(timeBlock)
  const dfValues = tokenizeNumbersKeepNaN(stripOpendapIndices(dfBlock))

  if (timeValues.length === 0 || dfValues.length === 0) {
    const head = (ascii || '').slice(0, 500)
    throw new Error(
      'Could not parse time/dune_foot_threeNAP_cross arrays from payload. '
      + 'Response (first 500 chars):\n' + head,
    )
  }

  return {
    duneFootThreeNAPCross: nullifySentinel(dfValues),
  }
}

export const useAppStore = defineStore('app', {
  state: () => ({
    loading: false,
    error: null,
    warning: null,
    rawText: '',
    fetchedAt: null,

    chartReady: false,
    years: [],
    crossShore: [],
    altitudeByYear: [],

    loadingIds: false,
    idsError: null,
    idList: [],
    idsFetchedAt: null,

    loadingAlong: false,
    alongError: null,
    alongshoreList: [],

    loadingArea: false,
    areaError: null,
    areacodeList: [],
    areanameList: [],

    loadingRsp: false,
    rspError: null,
    rspXList: [],
    rspYList: [],
    rspLatList: [],
    rspLonList: [],

    loadingWater: false,
    waterError: null,
    meanLowWaterList: [],
    meanHighWaterList: [],

    loadingBasal: false,
    basalError: null,
    basalYears: [],
    basalCoastline: [],
    testingCoastline: [],
    basalReady: false,
    basalFetchedAt: null,

    loadingMomentary: false,
    momentaryError: null,
    momentaryCoastline: [],
    momentaryReady: false,
    momentaryFetchedAt: null,

    loadingMhw: false,
    mhwError: null,
    mhwYears: [],
    meanHighWaterCross: [],
    meanLowWaterCross: [],
    mhwReady: false,
    mhwFetchedAt: null,

    loadingDf: false,
    dfError: null,
    duneFootThreeNAPCross: [],
    dfReady: false,
    dfFetchedAt: null,

    timeDimensionSizes: {},

    _aborter: null,
    _basalAborter: null,
    _momentaryAborter: null,
    _mhwAborter: null,
    _dfAborter: null,
  }),

  actions: {
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

        this.meanHighWaterList = high
        this.meanLowWaterList = low

        localStorage.setItem(WATER_CACHE_KEY, JSON.stringify({ high, low }))
      } catch (error) {
        this.waterError = error?.message || String(error)
      } finally {
        this.loadingWater = false
      }
    },

    async fetchDatasetTimeDimensionSize (datasetKey) {
      const config = DATASET_TIME_CONFIG[datasetKey]
      if (!config) {
        throw new Error(`Unknown dataset key: ${datasetKey}`)
      }

      const cachedSize = this.timeDimensionSizes[datasetKey]
      if (typeof cachedSize === 'number' && cachedSize > 0) {
        return cachedSize
      }

      let inflight = timeDimensionInflight.get(datasetKey)
      if (!inflight) {
        inflight = resolveDatasetTimeDimensionSize(config)
        timeDimensionInflight.set(datasetKey, inflight)
        inflight.finally(() => {
          timeDimensionInflight.delete(datasetKey)
        })
      }

      const size = await inflight
      this.timeDimensionSizes[datasetKey] = size
      return size
    },

    async fetchAllDatasetTimeDimensions () {
      await Promise.all(
        Object.keys(DATASET_TIME_CONFIG).map(key => this.fetchDatasetTimeDimensionSize(key)),
      )
    },

    async _timeMaxIndex (datasetKey) {
      const size = await this.fetchDatasetTimeDimensionSize(datasetKey)
      return size > 0 ? size - 1 : 0
    },

    async fetchBasalCoastline (transectIndex) {
      if (transectIndex < 0 || transectIndex >= 2465) {
        this.basalError = 'Invalid transect index'
        return
      }

      const timeMax = await this._timeMaxIndex('bkl')
      const url = `${BKL_BASE_URL}?time[0:1:${timeMax}],basal_coastline[0:1:${timeMax}][${transectIndex}],testing_coastline[0:1:${timeMax}][${transectIndex}]`

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
            this.basalReady = true
            this.basalFetchedAt = obj.t || null
            this.basalError = null
            this.loadingBasal = false

            refreshAsciiCacheInBackground(url, cacheKey)
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

    async fetchMomentaryCoastline (transectIndex) {
      if (transectIndex < 0 || transectIndex >= 2465) {
        this.momentaryError = 'Invalid transect index'
        return
      }

      const timeMax = await this._timeMaxIndex('mkl')
      const url = `${MKL_BASE_URL}?time[0:1:${timeMax}],momentary_coastline[0:1:${timeMax}][${transectIndex}]`

      // Check cache first
      const cacheKey = `mkl_cache::${url}`
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          const text = obj.data || ''
          if (text) {
            const parsed = parseMomentaryCoastlineAscii(text)
            this.momentaryCoastline = parsed.momentaryCoastline
            this.momentaryReady = true
            this.momentaryFetchedAt = obj.t || null
            this.momentaryError = null
            this.loadingMomentary = false

            refreshAsciiCacheInBackground(url, cacheKey)
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

    async fetchMeanHighWaterCross (transectIndex) {
      if (transectIndex < 0 || transectIndex >= 2465) {
        this.mhwError = 'Invalid transect index'
        return
      }

      const timeMax = await this._timeMaxIndex('mhw')
      const url = `${MHW_MLW_BASE_URL}?time[0:1:${timeMax}],mean_high_water_cross[0:1:${timeMax}][${transectIndex}],mean_low_water_cross[0:1:${timeMax}][${transectIndex}]`

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
            refreshAsciiCacheInBackground(url, cacheKey)
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

    async fetchDuneFootThreeNAPCross (transectIndex) {
      if (transectIndex < 0 || transectIndex >= 2465) {
        this.dfError = 'Invalid transect index'
        return
      }

      const timeMax = await this._timeMaxIndex('df')
      const url = `${DF_BASE_URL}?time[0:1:${timeMax}],dune_foot_threeNAP_cross[0:1:${timeMax}][${transectIndex}]`

      // Check cache first
      const cacheKey = `df_cache::${url}`
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          const obj = JSON.parse(cached)
          const text = obj.data || ''
          if (text) {
            const parsed = parseDuneFootThreeNAPCrossAscii(text)
            this.duneFootThreeNAPCross = parsed.duneFootThreeNAPCross
            this.dfReady = true
            this.dfFetchedAt = obj.t || null
            this.dfError = null
            this.loadingDf = false

            refreshAsciiCacheInBackground(url, cacheKey)
            return
          }
        } catch (error) {
          console.warn('DF cache parse error, fetching fresh:', error)
        }
      }

      // Cancel any in-flight request
      if (this._dfAborter) {
        try {
          this._dfAborter.abort()
        } catch {
          // Silent abort error
        }
      }
      this._dfAborter = new AbortController()

      this.loadingDf = true
      this.dfError = null
      this.dfReady = false
      this.duneFootThreeNAPCross = []

      try {
        const res = await fetch(url, { cache: 'no-store', signal: this._dfAborter.signal })
        if (!res.ok) {
          throw new Error(`Failed to fetch dune foot threeNAP cross data (${res.status})`)
        }
        const text = await res.text()
        this.dfFetchedAt = Date.now()

        // Parse the data
        const parsed = parseDuneFootThreeNAPCrossAscii(text)
        this.duneFootThreeNAPCross = parsed.duneFootThreeNAPCross
        this.dfReady = true

        // Cache if reasonably small
        if (text.length <= MAX_LOCALSTORAGE_CACHE_SIZE) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              t: this.dfFetchedAt,
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
          this.dfError = error?.message || String(error)
        }
      } finally {
        this.loadingDf = false
      }
    },

    _applyAltitudeChart (parsed) {
      this.years = parsed.years
      this.crossShore = parsed.crossShore
      this.altitudeByYear = parsed.altitudeByYear
      this.chartReady = true
    },

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
            const parsed = parseOpendapAscii(text)
            this._applyAltitudeChart(parsed)
            this.rawText = text
            this.fetchedAt = obj.t || null
            this.error = null
            this.warning = null
            this.loading = false

            refreshAsciiCacheInBackground(url, cacheKey)
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

        this._applyAltitudeChart(parseOpendapAscii(text))

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

        this._applyAltitudeChart(parseOpendapAscii(text))
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
