import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BatteryCharging,
  CalendarRange,
  CircleCheck,
  Clock,
  Factory,
  Gauge,
  Landmark,
  Leaf,
  Link2,
  MapPin,
  Mountain,
  Percent,
  PiggyBank,
  Printer,
  RefreshCcw,
  RotateCcw,
  Scale,
  ShieldCheck,
  Snowflake,
  Sun,
  TrendingUp,
  Wind,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  BRAND                                                              */
/* ------------------------------------------------------------------ */

const NEON = '#CCFF00'
const STEEL = '#64748B'
const AMBER = '#F59E0B'
const SKY = '#38BDF8'
const SOLAR_YELLOW = '#FDE047'

/** The RheEnergise blob mark — "Rhe" inside the four-lobed clover. */
function RheBlobMark({ blob, text, size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g fill={blob}>
        <circle cx="50" cy="50" r="32" />
        <circle cx="50" cy="27" r="23" />
        <circle cx="50" cy="73" r="23" />
        <circle cx="27" cy="50" r="23" />
        <circle cx="73" cy="50" r="23" />
      </g>
      <text
        x="50"
        y="61"
        textAnchor="middle"
        fontFamily="inherit"
        fontWeight="800"
        fontSize="32"
        fill={text}
      >
        Rhe
      </text>
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  CLIENT-FACING DATA ENGINE                                          */
/*  Calibrated to late-2025/26 market evidence — see the assumptions   */
/*  panel rendered at the bottom of the page.                          */
/* ------------------------------------------------------------------ */

const TECH = {
  hdHydro: {
    name: 'RheEnergise HD Hydro',
    powerCapexPerKW: 850, // £/kW — pump-turbines, R-19 loop
    energyCapexPerKWh: 125, // £/kWh — 60% smaller tanks & pipes vs water
    fixedOMRate: 0.015, // % of capex per year
    rte: 0.8, // round-trip efficiency, flat for life
    lifeYears: 60,
    refurbYear: 30, // machinery refurbishment provision
    refurbCostShare: 0.15, // of initial capex, once, if window exceeds it
  },
  lithium: {
    name: 'Lithium-ion BESS',
    powerCapexPerKW: 80,
    energyCapexPerKWh: 170, // current European installed pricing
    fixedOMRate: 0.02,
    rte: 0.85, // starting RTE — degrades ~2%/yr
    lifeYears: 20, // typical merchant financing horizon
    augmentationIntervalYears: 11, // stack replacement every 10–12 yrs
    augmentationCostShare: 0.3, // of initial energy capex, per event
    avgCapacityFactor: 0.9, // average usable capacity between augmentations
  },
  convHydro: {
    name: 'Conventional Pumped Hydro',
    powerCapexPerKW: 1500, // mountain-scale civil works
    energyCapexPerKWh: 90,
    fixedOMRate: 0.01,
    rte: 0.78,
    lifeYears: 80,
  },
}

const CYCLES_PER_YEAR = 330 // one full cycle per day with maintenance margin
const GAS_CO2_T_PER_MWH = 0.35 // unabated CCGT displaced at firming hours

// Sensitivity: where do Lithium-ion prices go from here?
const LI_OUTLOOKS = [
  { id: 'flat', label: 'Today’s prices', factor: 1 },
  { id: 'down25', label: 'Fall 25%', factor: 0.75 },
  { id: 'down50', label: 'Fall 50%', factor: 0.5 },
]

// Capital recovery factor — turns upfront capex into a flat annual payment.
function crf(rate, years) {
  const f = Math.pow(1 + rate, years)
  return (rate * f) / (f - 1)
}

function lithiumAugmentations(years) {
  return Math.floor(Math.max(0, years - 1) / TECH.lithium.augmentationIntervalYears)
}

function techCapex(techKey, powerMW, durationHours, liPriceFactor = 1) {
  const t = TECH[techKey]
  const energyRate =
    techKey === 'lithium' ? t.energyCapexPerKWh * liPriceFactor : t.energyCapexPerKWh
  return powerMW * 1000 * t.powerCapexPerKW + powerMW * durationHours * 1000 * energyRate
}

/**
 * Levelized Cost of Storage (£/MWh discharged).
 * Annual cost = financed capex + fixed O&M + technology-specific lifecycle
 * spend (Li-ion stack augmentation; HD Hydro mid-life refurbishment),
 * divided by the energy actually delivered each year.
 */
function calcLcos(techKey, powerMW, durationHours, years, { liFactor = 1, rate = 0.07 } = {}) {
  const t = TECH[techKey]
  const energyMWh = powerMW * durationHours
  const capex = techCapex(techKey, powerMW, durationHours, liFactor)
  const financeTerm = Math.min(years, t.lifeYears)
  let annualCost = capex * crf(rate, financeTerm) + capex * t.fixedOMRate

  let capacityFactor = 1
  if (techKey === 'lithium') {
    const energyRate = t.energyCapexPerKWh * liFactor
    annualCost +=
      (lithiumAugmentations(years) * t.augmentationCostShare * energyMWh * 1000 * energyRate) /
      years
    capacityFactor = t.avgCapacityFactor
  }
  if (techKey === 'hdHydro' && years > t.refurbYear) {
    annualCost += (t.refurbCostShare * capex) / years
  }

  const annualDischargeMWh = CYCLES_PER_YEAR * energyMWh * t.rte * capacityFactor
  if (annualDischargeMWh <= 0) return 0
  return annualCost / annualDischargeMWh
}

/**
 * Year-by-year cash cost (undiscounted £) for one technology: upfront capex,
 * then O&M, plus augmentation / refurbishment in the years they fall due.
 * Returns an array indexed by year 0..years.
 */
function cashCostSchedule(techKey, powerMW, durationHours, years, liFactor = 1) {
  const t = TECH[techKey]
  const capex = techCapex(techKey, powerMW, durationHours, liFactor)
  const flows = [capex]
  for (let y = 1; y <= years; y += 1) {
    let cost = capex * t.fixedOMRate
    if (techKey === 'lithium' && y % t.augmentationIntervalYears === 0 && y < years) {
      cost +=
        t.augmentationCostShare * powerMW * durationHours * 1000 * t.energyCapexPerKWh * liFactor
    }
    if (techKey === 'hdHydro' && y === t.refurbYear && years > t.refurbYear) {
      cost += t.refurbCostShare * capex
    }
    flows.push(cost)
  }
  return flows
}

/**
 * Cumulative cash out the door (£M), year by year — Li-ion's augmentation
 * staircase vs HD Hydro's flat line.
 */
function cumulativeCashCurve(powerMW, durationHours, years, liFactor) {
  const hd = cashCostSchedule('hdHydro', powerMW, durationHours, years)
  const li = cashCostSchedule('lithium', powerMW, durationHours, years, liFactor)
  const ps = cashCostSchedule('convHydro', powerMW, durationHours, years)
  const rows = []
  let a = 0
  let b = 0
  let c = 0
  for (let y = 0; y <= years; y += 1) {
    a += hd[y]
    b += li[y]
    c += ps[y]
    rows.push({ year: y, hdHydro: a / 1e6, lithium: b / 1e6, convHydro: c / 1e6 })
  }
  return rows
}

/**
 * The investment case for HD Hydro vs Lithium-ion: IRR earned on the extra
 * upfront capital, repaid by Li-ion's avoided O&M and stack augmentations.
 * Returns { irr, paybackYear, upfrontPremium } — irr/payback null when the
 * differential never pays back inside the window.
 */
function hdVsLiInvestmentCase(powerMW, durationHours, years, liFactor) {
  const hd = cashCostSchedule('hdHydro', powerMW, durationHours, years)
  const li = cashCostSchedule('lithium', powerMW, durationHours, years, liFactor)
  const diff = hd.map((c, y) => li[y] - c) // positive = HD saves cash that year

  const upfrontPremium = -diff[0]
  let paybackYear = null
  let cum = 0
  for (let y = 0; y < diff.length; y += 1) {
    cum += diff[y]
    if (cum >= 0 && y > 0) {
      paybackYear = y
      break
    }
  }

  let irr = null
  const npv = (r) => diff.reduce((a, c, t) => a + c / Math.pow(1 + r, t), 0)
  if (upfrontPremium > 0 && npv(0) > 0) {
    let lo = 0
    let hi = 1
    while (npv(hi) > 0 && hi < 10) hi *= 2
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2
      if (npv(mid) > 0) lo = mid
      else hi = mid
    }
    irr = (lo + hi) / 2
  }
  return { irr, paybackYear, upfrontPremium }
}

/* ------------------------------------------------------------------ */
/*  NORTH WALES LOCATION PRESETS                                       */
/* ------------------------------------------------------------------ */

const PRESETS = {
  anglesey: {
    id: 'anglesey',
    label: 'Anglesey Co-located Hub',
    tagline: 'Coastal wind & solar · firm green export',
    icon: MapPin,
    defaultWindMW: 120,
    defaultSolarMW: 40,
    defaultDemandMW: 50,
    demandLabel: 'Contracted Firm Block',
    demandSublabel: 'The 24/7 green block you sell to your offtaker',
    windCapacityFactor: 0.42, // high coastal wind
    solarPeakShare: 0.75,
    // Gusty coastal profile — big overnight & evening spikes, deep midday lull.
    windShape: [
      0.7, 0.78, 0.85, 0.9, 0.85, 0.75, 0.6, 0.42, 0.25, 0.15, 0.12, 0.1, 0.1,
      0.12, 0.15, 0.2, 0.35, 0.55, 0.75, 0.9, 0.95, 0.92, 0.85, 0.78,
    ],
    loadDescription: 'Firm 24h green export block sold at a premium',
    gridChargingAllowed: false,
  },
  deeside: {
    id: 'deeside',
    label: 'Deeside Industrial Firming',
    tagline: 'Virtual PPA · grid-connected factory firming',
    icon: Factory,
    defaultWindMW: 40,
    defaultSolarMW: 60,
    defaultDemandMW: 70,
    demandLabel: 'Factory Peak Demand',
    demandSublabel: 'Your site’s maximum draw during day shifts',
    windCapacityFactor: 0.33, // steadier inland wind
    solarPeakShare: 0.72,
    windShape: [
      0.4, 0.42, 0.45, 0.48, 0.5, 0.48, 0.44, 0.4, 0.36, 0.33, 0.3, 0.28, 0.28,
      0.3, 0.33, 0.36, 0.4, 0.44, 0.48, 0.52, 0.5, 0.47, 0.44, 0.42,
    ],
    loadDescription: 'Manufacturing load shielded from peak network charges',
    gridChargingAllowed: true, // hillside store soaks up cheap off-peak grid power
  },
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const OFF_PEAK = (h) => h <= 5 || h === 23

// Industrial day-shift demand shape for Deeside (peaks 07:00–18:00).
const INDUSTRIAL_SHAPE = HOURS.map((h) => {
  if (h >= 7 && h <= 18) return 1
  if (h >= 19 && h <= 21) return 0.7
  return 0.55
})

function solarShape(h, peakShare) {
  if (h < 6 || h > 19) return 0
  return Math.sin((Math.PI * (h - 6)) / 13) * peakShare
}

// Winter stress week: windy start, a three-day wind lull mid-week, weak
// seasonal solar, and a quieter factory weekend at Deeside.
const WINTER_WIND_DAY_FACTORS = [1.2, 1.15, 0.9, 0.3, 0.22, 0.6, 1.1]
const WINTER_SOLAR_FACTOR = 0.35
const WEEK_DEMAND_FACTORS = [1, 1, 1, 1, 1, 0.75, 0.7] // Deeside weekend only

/* ------------------------------------------------------------------ */
/*  STORAGE SIMULATION (any horizon)                                   */
/* ------------------------------------------------------------------ */

function buildDayProfiles(preset, windMW, solarMW, demandMW) {
  const shapeAvg = preset.windShape.reduce((a, b) => a + b, 0) / 24
  const wind = HOURS.map(
    (h) => windMW * preset.windShape[h] * (preset.windCapacityFactor / shapeAvg),
  )
  const solar = HOURS.map((h) => solarMW * solarShape(h, preset.solarPeakShare))
  const load =
    preset.id === 'anglesey'
      ? HOURS.map(() => demandMW)
      : INDUSTRIAL_SHAPE.map((s) => s * demandMW)
  const labels = HOURS.map((h) => `${String(h).padStart(2, '0')}:00`)
  return { wind, solar, load, labels }
}

function buildWeekProfiles(preset, windMW, solarMW, demandMW) {
  const day = buildDayProfiles(preset, windMW, solarMW, demandMW)
  const wind = []
  const solar = []
  const load = []
  const labels = []
  for (let d = 0; d < 7; d += 1) {
    for (const h of HOURS) {
      wind.push(Math.min(windMW, day.wind[h] * WINTER_WIND_DAY_FACTORS[d]))
      solar.push(day.solar[h] * WINTER_SOLAR_FACTOR)
      load.push(preset.id === 'deeside' ? day.load[h] * WEEK_DEMAND_FACTORS[d] : day.load[h])
      labels.push(`D${d + 1} ${String(h).padStart(2, '0')}:00`)
    }
  }
  return { wind, solar, load, labels }
}

/**
 * Run the store against any generation/load horizon (24h day or 168h week).
 * The horizon is repeated until the state of charge reaches a cyclic steady
 * state, then the settled pass is reported.
 */
function runStorageSim(preset, profiles, storagePowerMW, durationHours) {
  const { wind, solar, load, labels } = profiles
  const N = load.length
  const oneWayEff = Math.sqrt(TECH.hdHydro.rte) // 80% RTE split across charge/discharge
  const energyCapMWh = storagePowerMW * durationHours

  let soc = energyCapMWh * 0.5
  let greenIn = 0
  let gridIn = 0
  let day = []

  let prevStartSoc = -Infinity
  for (let d = 0; d < 30; d += 1) {
    const settled = Math.abs(soc - prevStartSoc) < energyCapMWh * 0.001
    prevStartSoc = soc
    if (settled || d === 29) {
      greenIn = 0
      gridIn = 0
      day = runPass(true)
      break
    }
    runPass(false)
  }

  function runPass(record) {
    const rows = []
    for (let i = 0; i < N; i += 1) {
      const h = i % 24
      const gen = wind[i] + solar[i]
      const L = load[i]
      const direct = Math.min(gen, L)
      const surplus = gen - direct
      const deficit = L - direct

      // Catch excess renewable power.
      const charge = Math.min(surplus, storagePowerMW, (energyCapMWh - soc) / oneWayEff)
      soc += charge * oneWayEff
      greenIn += charge * oneWayEff

      // Deeside: top up from cheap off-peak grid energy overnight.
      let gridCharge = 0
      if (preset.gridChargingAllowed && OFF_PEAK(h) && soc < energyCapMWh * 0.95) {
        gridCharge = Math.min(storagePowerMW - charge, (energyCapMWh - soc) / oneWayEff)
        soc += gridCharge * oneWayEff
        gridIn += gridCharge * oneWayEff
      }

      // Deploy during deficits (off-peak deficits ride on cheap grid instead).
      let discharge = 0
      const ridingGrid = preset.gridChargingAllowed && OFF_PEAK(h)
      if (deficit > 0 && !ridingGrid) {
        discharge = Math.min(deficit, storagePowerMW, soc * oneWayEff)
        soc -= discharge / oneWayEff
      }

      if (record) {
        rows.push({
          hour: h,
          label: labels[i],
          wind: wind[i],
          solar: solar[i],
          load: L,
          discharge,
          charge: -(charge + gridCharge),
          direct,
          deficit,
          soc,
        })
      }
    }
    return rows
  }

  const totalIn = greenIn + gridIn
  const greenShare = totalIn > 0 ? greenIn / totalIn : 1
  const totalLoad = day.reduce((a, r) => a + r.load, 0)
  const totalGen = day.reduce((a, r) => a + r.wind + r.solar, 0)
  const directServed = day.reduce((a, r) => a + r.direct, 0)
  const greenServed = day.reduce((a, r) => a + r.direct + r.discharge * greenShare, 0)
  const firmingFactor = totalLoad > 0 ? Math.min(100, (greenServed / totalLoad) * 100) : 0
  const bareCoverage = totalLoad > 0 ? Math.min(100, (directServed / totalLoad) * 100) : 0
  const genCoverage = totalLoad > 0 ? totalGen / totalLoad : 0

  // Factory KPI (Deeside): share of peak-window (07:00–18:00) power that must
  // be bought from the grid at peak prices, before vs after storage.
  const peak = day.filter((r) => r.hour >= 7 && r.hour <= 18)
  const peakLoad = peak.reduce((a, r) => a + r.load, 0)
  const peakDirect = peak.reduce((a, r) => a + r.direct, 0)
  const peakDischarge = peak.reduce((a, r) => a + r.discharge, 0)
  const peakGridBefore = peakLoad > 0 ? ((peakLoad - peakDirect) / peakLoad) * 100 : 0
  const peakGridAfter =
    peakLoad > 0 ? (Math.max(0, peakLoad - peakDirect - peakDischarge) / peakLoad) * 100 : 0

  const daysSimulated = N / 24
  return {
    day,
    firmingFactor,
    bareCoverage,
    genCoverage,
    peakGridBefore,
    peakGridAfter,
    dailyGreenCharge: greenIn / daysSimulated, // renewable surplus captured per day (MWh)
    dailyGreenServed: greenServed / daysSimulated, // green energy delivered per day (MWh)
    energyCapMWh,
    storagePowerMW,
  }
}

/* ------------------------------------------------------------------ */
/*  FORMATTING                                                         */
/* ------------------------------------------------------------------ */

const fmtMW = (v) =>
  v >= 1000
    ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)} GW`
    : `${Math.round(v).toLocaleString('en-GB')} MW`

const fmtMWh = (v) =>
  v >= 1000
    ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)} GWh`
    : `${Math.round(v).toLocaleString('en-GB')} MWh`

const fmtPerMWh = (v) => `£${Math.round(v).toLocaleString('en-GB')}/MWh`
const fmtTonnes = (v) => `${Math.round(v).toLocaleString('en-GB')} t`

function fmtMillions(value) {
  const m = value / 1e6
  if (Math.abs(m) >= 1000) return `£${(m / 1000).toFixed(2)}B`
  return `£${m.toFixed(1)}M`
}

/* ------------------------------------------------------------------ */
/*  SHAREABLE SCENARIO LINKS                                           */
/* ------------------------------------------------------------------ */

function initialStateFromUrl() {
  const q = new URLSearchParams(window.location.search)
  const num = (key, def, min, max) => {
    const raw = q.get(key)
    const v = Number(raw)
    return raw !== null && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
  }
  const presetId = PRESETS[q.get('p')] ? q.get('p') : 'anglesey'
  const d = PRESETS[presetId]
  return {
    presetId,
    windMW: num('w', d.defaultWindMW, 0, 1000),
    solarMW: num('s', d.defaultSolarMW, 0, 1000),
    demandMW: num('d', d.defaultDemandMW, 10, 1000),
    storageMW: num('sp', d.defaultDemandMW, 10, 1000),
    durationHours: num('h', 8, 4, 16),
    years: num('y', 25, 10, 60),
    discountPct: num('r', 7, 4, 12),
    liOutlookId: LI_OUTLOOKS.some((o) => o.id === q.get('li')) ? q.get('li') : 'flat',
    viewMode: q.get('v') === 'week' ? 'week' : 'day',
  }
}

const INIT = initialStateFromUrl()

/* ------------------------------------------------------------------ */
/*  UI PRIMITIVES                                                      */
/* ------------------------------------------------------------------ */

function Slider({ icon: Icon, label, sublabel, value, min, max, step = 1, unit, onChange }) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-slate-200">{label}</div>
            {sublabel && <div className="text-xs text-slate-500">{sublabel}</div>}
          </div>
        </div>
        <div className="rounded border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-2 py-0.5 font-mono text-sm font-bold text-[#CCFF00]">
          {unit(value)}
        </div>
      </div>
      <input
        type="range"
        className="rhe-slider"
        style={{ '--fill': `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-600">
        <span>{unit(min)}</span>
        <span>{unit(max)}</span>
      </div>
    </div>
  )
}

function PanelTitle({ step, title }) {
  return (
    <div className="mb-4 flex items-center gap-2 border-b border-slate-800 pb-2">
      <span className="flex h-5 w-5 items-center justify-center border border-[#CCFF00]/50 font-mono text-[10px] font-bold text-[#CCFF00]">
        {step}
      </span>
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{title}</h3>
    </div>
  )
}

/** Numbered chapter headings that pace the customer conversation. */
function SectionHeader({ n, title, cue }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b-2 border-[#CCFF00]/30 pb-1.5">
      <span className="font-mono text-xl font-black leading-none text-[#CCFF00]">{n}</span>
      <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">{title}</h2>
      {cue && <span className="text-[11px] text-slate-500">{cue}</span>}
    </div>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-mono font-bold text-slate-300">{label}</div>
      {payload
        .filter((p) => Math.abs(p.value) > 0.01)
        .map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-4">
            <span style={{ color: p.color }}>{p.name}</span>
            <span className="font-mono text-slate-200">
              {Math.abs(p.value).toFixed(0)} {p.unit ?? 'MW'}
            </span>
          </div>
        ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  MAIN COMPONENT                                                     */
/* ------------------------------------------------------------------ */

export default function FirmingCalculator() {
  const [presetId, setPresetId] = useState(INIT.presetId)
  const [windMW, setWindMW] = useState(INIT.windMW)
  const [solarMW, setSolarMW] = useState(INIT.solarMW)
  const [demandMW, setDemandMW] = useState(INIT.demandMW)
  const [storageMW, setStorageMW] = useState(INIT.storageMW)
  const [durationHours, setDurationHours] = useState(INIT.durationHours)
  const [years, setYears] = useState(INIT.years)
  const [discountPct, setDiscountPct] = useState(INIT.discountPct)
  const [liOutlookId, setLiOutlookId] = useState(INIT.liOutlookId)
  const [viewMode, setViewMode] = useState(INIT.viewMode)
  const [linkCopied, setLinkCopied] = useState(false)

  const preset = PRESETS[presetId]
  const liOutlook = LI_OUTLOOKS.find((o) => o.id === liOutlookId)
  const finance = { liFactor: liOutlook.factor, rate: discountPct / 100 }

  const selectPreset = (id) => {
    setPresetId(id)
    setWindMW(PRESETS[id].defaultWindMW)
    setSolarMW(PRESETS[id].defaultSolarMW)
    setDemandMW(PRESETS[id].defaultDemandMW)
    setStorageMW(PRESETS[id].defaultDemandMW)
  }

  // Keep the URL in sync so any configuration can be shared as a link.
  useEffect(() => {
    const q = new URLSearchParams({
      p: presetId,
      w: windMW,
      s: solarMW,
      d: demandMW,
      sp: storageMW,
      h: durationHours,
      y: years,
      r: discountPct,
      li: liOutlookId,
      v: viewMode,
    })
    window.history.replaceState(null, '', `?${q.toString()}`)
  }, [presetId, windMW, solarMW, demandMW, storageMW, durationHours, years, discountPct, liOutlookId, viewMode])

  const scenarioQuery = new URLSearchParams({
    p: presetId,
    w: windMW,
    s: solarMW,
    d: demandMW,
    sp: storageMW,
    h: durationHours,
    y: years,
    r: discountPct,
    li: liOutlookId,
    v: viewMode,
  }).toString()
  const scenarioLink = `${window.location.origin}${window.location.pathname}?${scenarioQuery}`

  const copyScenarioLink = async () => {
    try {
      await navigator.clipboard.writeText(scenarioLink)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      window.prompt('Copy this scenario link:', scenarioLink)
    }
  }

  const energyCapMWh = storageMW * durationHours

  // Typical-day simulation always runs: it anchors annualised metrics.
  const simDay = useMemo(
    () =>
      runStorageSim(
        preset,
        buildDayProfiles(preset, windMW, solarMW, demandMW),
        storageMW,
        durationHours,
      ),
    [preset, windMW, solarMW, demandMW, storageMW, durationHours],
  )

  const simWeek = useMemo(
    () =>
      viewMode === 'week'
        ? runStorageSim(
            preset,
            buildWeekProfiles(preset, windMW, solarMW, demandMW),
            storageMW,
            durationHours,
          )
        : null,
    [viewMode, preset, windMW, solarMW, demandMW, storageMW, durationHours],
  )

  const sim = viewMode === 'week' && simWeek ? simWeek : simDay

  const lcos = useMemo(
    () => ({
      hdHydro: calcLcos('hdHydro', storageMW, durationHours, years, finance),
      lithium: calcLcos('lithium', storageMW, durationHours, years, finance),
      convHydro: calcLcos('convHydro', storageMW, durationHours, years, finance),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageMW, durationHours, years, liOutlookId, discountPct],
  )

  const lcosCurve = useMemo(
    () =>
      [4, 6, 8, 10, 12, 14, 16].map((d) => ({
        duration: d,
        hdHydro: calcLcos('hdHydro', storageMW, d, years, finance),
        lithium: calcLcos('lithium', storageMW, d, years, finance),
        convHydro: calcLcos('convHydro', storageMW, d, years, finance),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageMW, years, liOutlookId, discountPct],
  )

  // Cumulative cash out the door, year by year — Li-ion's augmentation
  // staircase vs HD Hydro's flat line.
  const cashCurve = useMemo(
    () => cumulativeCashCurve(storageMW, durationHours, years, liOutlook.factor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageMW, durationHours, years, liOutlookId],
  )

  const investment = useMemo(
    () => hdVsLiInvestmentCase(storageMW, durationHours, years, liOutlook.factor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageMW, durationHours, years, liOutlookId],
  )

  // Executive metrics (annualised from the typical day) ---------------
  const annualDischargeHD = CYCLES_PER_YEAR * energyCapMWh * TECH.hdHydro.rte
  const lifetimeSavings = (lcos.lithium - lcos.hdHydro) * annualDischargeHD * years
  const augmentations = lithiumAugmentations(years)
  const reinvestmentLiability =
    augmentations *
    TECH.lithium.augmentationCostShare *
    energyCapMWh *
    1000 *
    TECH.lithium.energyCapexPerKWh *
    liOutlook.factor
  const hdAdvantagePct =
    lcos.lithium > 0 ? ((lcos.lithium - lcos.hdHydro) / lcos.lithium) * 100 : 0
  const annualCO2Avoided = simDay.dailyGreenServed * 365 * GAS_CO2_T_PER_MWH
  const annualCurtailmentGWh = (simDay.dailyGreenCharge * 365) / 1000

  const storageVsDemand = storageMW / Math.max(demandMW, 1)
  const capFloorEligible = durationHours >= 8

  const advice =
    durationHours <= 5
      ? {
          tone: 'neutral',
          title: 'Short-Duration: Lithium-ion Territory',
          body: 'At this duration Lithium-ion is the right tool — fast, proven and cheapest for rapid grid response. The HD Hydro case opens from around 6 hours; drag the duration slider to see where the economics pivot.',
        }
      : durationHours <= 9
        ? {
            tone: 'positive',
            title: 'The LDES Pivot',
            body: 'From here, adding hours means bigger tanks and more R-19 fluid — not more battery cells. HD Hydro removes degradation and stack-replacement liabilities from your cost line, the right match for stable corporate PPAs.',
          }
        : {
            tone: 'dominant',
            title: 'Long-Duration Dominance',
            body: 'Volumetric efficiency and a 60-year infrastructure lifecycle mean RheEnergise provides the lowest cost, zero-degradation baseload hedge on the market.',
          }

  const kpiBefore = presetId === 'anglesey' ? sim.bareCoverage : sim.peakGridBefore
  const kpiAfter = presetId === 'anglesey' ? sim.firmingFactor : sim.peakGridAfter

  return (
    <>
    <div className="min-h-screen bg-[#0F172A] pb-10 font-sans text-slate-200 print:hidden">
      {/* ============ HEADER ============ */}
      <header className="border-b border-slate-800 bg-[#121824]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <RheBlobMark blob={NEON} text="#0F172A" size={44} />
            <div>
              <div className="text-xl font-bold leading-tight tracking-tight text-white">
                Energise
              </div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                HD Hydro · Firming &amp; LCOS Calculator
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <button
              type="button"
              onClick={copyScenarioLink}
              className="flex items-center gap-1.5 border border-slate-600 px-2.5 py-1 text-slate-300 transition-colors hover:border-[#CCFF00] hover:text-[#CCFF00]"
            >
              <Link2 size={12} aria-hidden="true" />
              {linkCopied ? 'Link copied!' : 'Copy Scenario Link'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 border border-[#CCFF00]/60 bg-[#CCFF00]/10 px-2.5 py-1 text-[#CCFF00] transition-colors hover:bg-[#CCFF00]/20"
            >
              <Printer size={12} aria-hidden="true" />
              Export PDF Summary
            </button>
            <span className="hidden border border-[#CCFF00]/50 bg-[#CCFF00]/10 px-2.5 py-1 text-[#CCFF00] sm:inline">
              0% Degradation · 60-Year Life
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pt-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* ============ LEFT: DESIGN YOUR SYSTEM ============ */}
          <section className="lg:col-span-4" aria-label="Design your system">
            <div className="border border-slate-800 bg-[#121824] p-5 lg:sticky lg:top-4">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-base font-bold text-white">Design Your System</h2>
                <button
                  type="button"
                  onClick={() => selectPreset(presetId)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 transition-colors hover:text-[#CCFF00]"
                >
                  <RotateCcw size={11} aria-hidden="true" /> Reset
                </button>
              </div>
              <p className="mb-5 text-xs text-slate-500">
                Start with what you need to power. Everything on the right updates live.
              </p>

              {/* Location */}
              <PanelTitle step="1" title="Choose Your Location" />
              <div className="mb-6 space-y-2">
                {Object.values(PRESETS).map((p) => {
                  const Icon = p.icon
                  const active = p.id === presetId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectPreset(p.id)}
                      aria-pressed={active}
                      className={`w-full border p-3 text-left transition-colors ${
                        active
                          ? 'border-[#CCFF00] bg-[#CCFF00]/10'
                          : 'border-slate-700 bg-transparent hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          size={16}
                          className={active ? 'text-[#CCFF00]' : 'text-slate-500'}
                          aria-hidden="true"
                        />
                        <span
                          className={`text-sm font-bold ${active ? 'text-[#CCFF00]' : 'text-slate-300'}`}
                        >
                          {p.label}
                        </span>
                      </div>
                      <div className="mt-1 pl-6 text-xs text-slate-500">{p.tagline}</div>
                    </button>
                  )
                })}
              </div>

              {/* Customer power need */}
              <PanelTitle step="2" title="Your Power Need" />
              <div className="mb-6">
                <Slider
                  icon={Gauge}
                  label={preset.demandLabel}
                  sublabel={preset.demandSublabel}
                  value={demandMW}
                  min={10}
                  max={1000}
                  step={10}
                  unit={fmtMW}
                  onChange={setDemandMW}
                />
              </div>

              {/* Generation mix */}
              <PanelTitle step="3" title="Your Generation Mix" />
              <div className="mb-6 space-y-5">
                <Slider
                  icon={Wind}
                  label="Wind Capacity"
                  sublabel={`${Math.round(preset.windCapacityFactor * 100)}% capacity factor at this site`}
                  value={windMW}
                  min={0}
                  max={1000}
                  step={10}
                  unit={fmtMW}
                  onChange={setWindMW}
                />
                <Slider
                  icon={Sun}
                  label="Solar Capacity"
                  sublabel="Seasonal daytime generation"
                  value={solarMW}
                  min={0}
                  max={1000}
                  step={10}
                  unit={fmtMW}
                  onChange={setSolarMW}
                />
              </div>

              {/* Storage design */}
              <PanelTitle step="4" title="Your Storage Design" />
              <div className="mb-6 space-y-5">
                <Slider
                  icon={BatteryCharging}
                  label="Storage Power Rating"
                  sublabel="How much of your demand the store can carry at once"
                  value={storageMW}
                  min={10}
                  max={1000}
                  step={10}
                  unit={fmtMW}
                  onChange={setStorageMW}
                />
                <Slider
                  icon={Clock}
                  label="Discharge Duration"
                  sublabel="How long do you need power to last?"
                  value={durationHours}
                  min={4}
                  max={16}
                  unit={(v) => `${v}${v >= 16 ? '+' : ''} hrs`}
                  onChange={setDurationHours}
                />
              </div>

              {/* Financials */}
              <PanelTitle step="5" title="Your Financials" />
              <div className="space-y-5">
                <Slider
                  icon={CalendarRange}
                  label="Project Evaluation Window"
                  sublabel="How long do you want to secure this asset?"
                  value={years}
                  min={10}
                  max={60}
                  step={5}
                  unit={(v) => `${v} yrs`}
                  onChange={setYears}
                />
                <Slider
                  icon={Percent}
                  label="Your Cost of Capital"
                  sublabel="Discount rate applied to every technology equally"
                  value={discountPct}
                  min={4}
                  max={12}
                  step={0.5}
                  unit={(v) => `${v}%`}
                  onChange={setDiscountPct}
                />
              </div>

              {/* Configured system summary */}
              <div className="mt-6 border border-[#CCFF00]/40 bg-[#0B1120] p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <BatteryCharging size={13} aria-hidden="true" />
                  Your HD Hydro Store
                </div>
                <div className="text-center font-mono text-2xl font-black text-[#CCFF00]">
                  {fmtMW(storageMW)} <span className="text-slate-600">·</span>{' '}
                  {fmtMWh(energyCapMWh)}
                </div>
                <div className="mt-1 text-center text-[10px] uppercase tracking-wider text-slate-500">
                  Power Rating · Energy Capacity
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  {storageVsDemand >= 1
                    ? `Rated to carry your full ${fmtMW(demandMW)} demand for ${durationHours} hours on its own.`
                    : `Covers ${Math.round(storageVsDemand * 100)}% of your ${fmtMW(demandMW)} peak demand — raise the power rating for full backup.`}{' '}
                  R-19 fluid is 2.5× denser than water — the same energy in 60% smaller
                  pipes and tanks, unlocked by a hill of just 100&nbsp;m.
                </p>
              </div>
            </div>
          </section>

          {/* ============ RIGHT: THE STORY ============ */}
          <section className="space-y-8 lg:col-span-8" aria-label="The RheEnergise advantage">
            {/* Headline strip — the whole story at a glance */}
            <div className="grid grid-cols-3 gap-2">
              <div className="border border-slate-700 bg-[#121824] p-3 text-center">
                <div className="font-mono text-lg font-black leading-tight text-white">
                  <span className="text-slate-500">{kpiBefore.toFixed(0)}%</span>
                  <ArrowRight size={14} className="mx-1 inline text-slate-500" aria-hidden="true" />
                  <span className="rhe-glow text-[#CCFF00]">{kpiAfter.toFixed(0)}%</span>
                </div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {presetId === 'anglesey' ? 'Continuous green power' : 'Peak grid exposure'}
                </div>
              </div>
              <div className="border border-slate-700 bg-[#121824] p-3 text-center">
                <div className="rhe-glow font-mono text-lg font-black leading-tight text-[#CCFF00]">
                  {fmtPerMWh(lcos.hdHydro)}
                  <span className="ml-1.5 text-xs font-bold text-slate-500">
                    vs {fmtPerMWh(lcos.lithium)} Li-ion
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Cost per MWh delivered
                </div>
              </div>
              <div className="border border-slate-700 bg-[#121824] p-3 text-center">
                <div
                  className={`rhe-glow font-mono text-lg font-black leading-tight ${
                    lifetimeSavings >= 0 ? 'text-[#CCFF00]' : 'text-amber-500'
                  }`}
                >
                  {fmtMillions(lifetimeSavings)}
                </div>
                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Saved vs Li-ion over {years} yrs
                </div>
              </div>
            </div>

            {/* ---- 01 · Your power, firmed ---- */}
            <div className="space-y-4">
              <SectionHeader
                n="01"
                title="Your Power, Firmed"
                cue="what the store does for you, hour by hour"
              />
              <div className="border border-slate-800 bg-[#121824] p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewMode('day')}
                      aria-pressed={viewMode === 'day'}
                      className={`flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                        viewMode === 'day'
                          ? 'border-[#CCFF00] bg-[#CCFF00]/10 text-[#CCFF00]'
                          : 'border-slate-700 text-slate-500 hover:border-slate-500'
                      }`}
                    >
                      <Clock size={12} aria-hidden="true" /> Typical Day
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('week')}
                      aria-pressed={viewMode === 'week'}
                      className={`flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                        viewMode === 'week'
                          ? 'border-[#CCFF00] bg-[#CCFF00]/10 text-[#CCFF00]'
                          : 'border-slate-700 text-slate-500 hover:border-slate-500'
                      }`}
                    >
                      <Snowflake size={12} aria-hidden="true" /> Winter Stress Week
                    </button>
                    <span className="font-mono text-[11px] text-slate-500">
                      {fmtMW(storageMW)} / {fmtMWh(energyCapMWh)} store
                    </span>
                  </div>
                  <div>
                    <div className="flex items-stretch gap-2">
                      <div className="border border-slate-700 px-3 py-1.5 text-right">
                        <div className="font-mono text-xl font-black leading-none text-slate-500">
                          {kpiBefore.toFixed(0)}%
                        </div>
                        <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">
                          {presetId === 'anglesey' ? 'Green, no storage' : 'Peak draw, no storage'}
                        </div>
                      </div>
                      <div className="flex items-center text-slate-500" aria-hidden="true">
                        <ArrowRight size={16} />
                      </div>
                      <div className="border border-[#CCFF00] bg-[#CCFF00]/10 px-3 py-1.5 text-right">
                        <div className="rhe-glow font-mono text-xl font-black leading-none text-[#CCFF00]">
                          {kpiAfter.toFixed(0)}%
                        </div>
                        <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
                          With HD Hydro
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={sim.day} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                      <CartesianGrid stroke="#1E293B" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#64748B', fontSize: 10 }}
                        tickLine={false}
                        axisLine={{ stroke: '#334155' }}
                        interval={viewMode === 'day' ? 3 : 23}
                        tickFormatter={(v) => (viewMode === 'week' ? v.replace(' 00:00', '') : v)}
                      />
                      <YAxis
                        tick={{ fill: '#64748B', fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        label={{
                          value: 'MW',
                          angle: -90,
                          position: 'insideLeft',
                          fill: '#64748B',
                          fontSize: 10,
                        }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="plainline" />
                      <ReferenceLine y={0} stroke="#334155" />
                      <Area
                        name="Wind"
                        dataKey="wind"
                        stackId="gen"
                        type="monotone"
                        stroke={SKY}
                        fill={SKY}
                        fillOpacity={0.18}
                        strokeWidth={1.5}
                      />
                      <Area
                        name="Solar"
                        dataKey="solar"
                        stackId="gen"
                        type="monotone"
                        stroke={SOLAR_YELLOW}
                        fill={SOLAR_YELLOW}
                        fillOpacity={0.18}
                        strokeWidth={1.5}
                      />
                      <Bar
                        name="Storage Deploying"
                        dataKey="discharge"
                        fill={NEON}
                        fillOpacity={0.9}
                        barSize={viewMode === 'day' ? 10 : 2}
                      />
                      <Bar
                        name="Storage Catching Excess"
                        dataKey="charge"
                        fill={NEON}
                        fillOpacity={0.3}
                        barSize={viewMode === 'day' ? 10 : 2}
                      />
                      <Line
                        name="Your Demand"
                        dataKey="load"
                        type="stepAfter"
                        stroke="#F8FAFC"
                        strokeWidth={viewMode === 'day' ? 2 : 1.5}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Bright green: the store deploying through deficits. Dim green below the
                  line: catching excess power that would otherwise be curtailed.
                  {viewMode === 'week' &&
                    ' Days 4–5 are a wind lull — slide the duration up to ride further into it.'}
                </p>
                {presetId === 'anglesey' && sim.genCoverage > 0 && sim.genCoverage < 0.95 && (
                  <p className="mt-2 flex items-start gap-1.5 border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-snug text-amber-400/90">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {viewMode === 'week'
                      ? `In this winter week your generation produces ${(sim.genCoverage * 100).toFixed(0)}% of the energy you need — no store of any technology can bridge a multi-day lull alone. Deep duration extends the ride-through; extra generation closes the gap.`
                      : `Your generation mix produces ${(sim.genCoverage * 100).toFixed(0)}% of your daily energy need. Storage firms what you generate — add wind or solar capacity to raise the green ceiling.`}
                  </p>
                )}
              </div>
            </div>

            {/* ---- 02 · What it costs ---- */}
            <div className="space-y-4">
              <SectionHeader
                n="02"
                title="What It Costs"
                cue="cost per MWh, and total cash over the life of the deal"
              />
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {/* LCOS card */}
                <div className="border border-slate-800 bg-[#121824] p-5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-white">
                      Cost per MWh Delivered (LCOS)
                    </div>
                    {hdAdvantagePct >= 1 ? (
                      <div className="border border-[#CCFF00]/50 bg-[#CCFF00]/10 px-2 py-1 text-[10px] font-bold text-[#CCFF00]">
                        HD Hydro {hdAdvantagePct.toFixed(0)}% below Li-ion
                      </div>
                    ) : (
                      <div className="border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[10px] font-bold text-amber-500">
                        Li-ion leads at this design
                      </div>
                    )}
                  </div>
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Li-ion prices:
                    </span>
                    {LI_OUTLOOKS.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setLiOutlookId(o.id)}
                        aria-pressed={o.id === liOutlookId}
                        className={`border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                          o.id === liOutlookId
                            ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                            : 'border-slate-700 text-slate-500 hover:border-slate-500'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lcosCurve} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                        <CartesianGrid stroke="#1E293B" vertical={false} />
                        <XAxis
                          dataKey="duration"
                          tick={{ fill: '#64748B', fontSize: 10 }}
                          tickLine={false}
                          axisLine={{ stroke: '#334155' }}
                          tickFormatter={(d) => `${d}h`}
                        />
                        <YAxis
                          tick={{ fill: '#64748B', fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => `£${v.toFixed(0)}`}
                        />
                        <Tooltip
                          content={({ active, payload, label }) =>
                            active && payload?.length ? (
                              <div className="border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs shadow-xl">
                                <div className="mb-1 font-mono font-bold text-slate-300">
                                  {label}-hour duration
                                </div>
                                {payload.map((p) => (
                                  <div key={p.name} className="flex items-center justify-between gap-4">
                                    <span style={{ color: p.color }}>{p.name}</span>
                                    <span className="font-mono text-slate-200">
                                      {fmtPerMWh(p.value)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : null
                          }
                        />
                        <ReferenceLine
                          x={Math.min(durationHours, 16)}
                          stroke={NEON}
                          strokeDasharray="4 4"
                          label={{
                            value: 'Your design',
                            fill: NEON,
                            fontSize: 10,
                            position: 'insideTopRight',
                          }}
                        />
                        <Line
                          name="Lithium-ion BESS"
                          dataKey="lithium"
                          stroke={AMBER}
                          strokeWidth={2}
                          dot={{ r: 3, fill: AMBER, strokeWidth: 0 }}
                        />
                        <Line
                          name="Conventional Hydro"
                          dataKey="convHydro"
                          stroke={STEEL}
                          strokeWidth={2}
                          strokeDasharray="6 4"
                          dot={{ r: 3, fill: STEEL, strokeWidth: 0 }}
                        />
                        <Line
                          name="RheEnergise HD Hydro"
                          dataKey="hdHydro"
                          stroke={NEON}
                          strokeWidth={3}
                          dot={{ r: 4, fill: NEON, strokeWidth: 0 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="border border-[#CCFF00]/60 bg-[#CCFF00]/5 p-2 text-center">
                      <div className="rhe-glow font-mono text-base font-black text-[#CCFF00]">
                        {fmtPerMWh(lcos.hdHydro)}
                      </div>
                      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        HD Hydro
                      </div>
                    </div>
                    <div className="border border-amber-500/40 p-2 text-center">
                      <div className="font-mono text-base font-black text-amber-500">
                        {fmtPerMWh(lcos.lithium)}
                      </div>
                      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        Lithium-ion
                      </div>
                    </div>
                    <div className="border border-slate-700 p-2 text-center">
                      <div className="font-mono text-base font-black text-slate-400">
                        {fmtPerMWh(lcos.convHydro)}
                      </div>
                      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        Conv. Hydro
                      </div>
                    </div>
                  </div>
                </div>

                {/* Cash curve card */}
                <div className="border border-slate-800 bg-[#121824] p-5">
                  <div className="mb-2 text-sm font-bold text-white">
                    Total Cash Out the Door — {years} Years
                  </div>
                  <p className="mb-3 text-[11px] text-slate-500">
                    Cumulative, undiscounted. Lithium-ion steps up at every stack
                    augmentation; HD Hydro stays flat.
                  </p>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={cashCurve} margin={{ top: 5, right: 5, bottom: 0, left: -5 }}>
                        <CartesianGrid stroke="#1E293B" vertical={false} />
                        <XAxis
                          dataKey="year"
                          tick={{ fill: '#64748B', fontSize: 10 }}
                          tickLine={false}
                          axisLine={{ stroke: '#334155' }}
                          tickFormatter={(y) => `Yr ${y}`}
                        />
                        <YAxis
                          tick={{ fill: '#64748B', fontSize: 10 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => (v >= 1000 ? `£${(v / 1000).toFixed(1)}B` : `£${v.toFixed(0)}M`)}
                        />
                        <Tooltip
                          content={({ active, payload, label }) =>
                            active && payload?.length ? (
                              <div className="border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs shadow-xl">
                                <div className="mb-1 font-mono font-bold text-slate-300">
                                  Year {label}
                                </div>
                                {payload.map((p) => (
                                  <div key={p.name} className="flex items-center justify-between gap-4">
                                    <span style={{ color: p.color }}>{p.name}</span>
                                    <span className="font-mono text-slate-200">
                                      £{p.value.toFixed(1)}M
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : null
                          }
                        />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="plainline" />
                        <Line
                          name="Lithium-ion BESS"
                          dataKey="lithium"
                          type="stepAfter"
                          stroke={AMBER}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          name="Conventional Hydro"
                          dataKey="convHydro"
                          type="monotone"
                          stroke={STEEL}
                          strokeWidth={2}
                          strokeDasharray="6 4"
                          dot={false}
                        />
                        <Line
                          name="RheEnergise HD Hydro"
                          dataKey="hdHydro"
                          type="monotone"
                          stroke={NEON}
                          strokeWidth={3}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Cap & floor — one slim policy line */}
              <div
                className={`flex flex-wrap items-center justify-between gap-3 border px-4 py-3 ${
                  capFloorEligible ? 'border-[#CCFF00]/60 bg-[#CCFF00]/5' : 'border-slate-700 bg-[#121824]'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <BadgeCheck
                    size={16}
                    className={capFloorEligible ? 'text-[#CCFF00]' : 'text-slate-500'}
                    aria-hidden="true"
                  />
                  <p className="text-xs leading-snug text-slate-400">
                    <span
                      className={`font-black uppercase tracking-wide ${
                        capFloorEligible ? 'text-[#CCFF00]' : 'text-slate-300'
                      }`}
                    >
                      Ofgem LDES Cap &amp; Floor:{' '}
                    </span>
                    {capFloorEligible
                      ? `your ${durationHours}-hour design meets the 8-hour threshold — eligible to apply for 20–25 years of revenue-floor protection, exactly the horizon where HD Hydro dominates. (8h Li-ion qualifies too; HD differentiates on cost at duration, zero degradation, and 35+ years of life after the scheme.)`
                      : `at ${durationHours} hours you're below the 8-hour threshold for 20–25 years of revenue-floor support.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDurationHours(Math.max(8, durationHours))
                    setYears(25)
                  }}
                  className={`shrink-0 border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    capFloorEligible && years === 25
                      ? 'border-slate-700 text-slate-600'
                      : 'border-[#CCFF00]/60 bg-[#CCFF00]/10 text-[#CCFF00] hover:bg-[#CCFF00]/20'
                  }`}
                >
                  {capFloorEligible && years === 25
                    ? 'Framed for the scheme ✓'
                    : 'Frame for the scheme: 8h+ / 25 yrs'}
                </button>
              </div>
            </div>

            {/* ---- 03 · The executive case ---- */}
            <div className="space-y-4">
              <SectionHeader
                n="03"
                title="The Executive Case"
                cue="the four numbers your board will ask for"
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Investment case */}
                <div className="border border-slate-800 bg-[#121824] p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                    <PiggyBank size={14} className="text-[#CCFF00]" aria-hidden="true" />
                    The Investment Case vs Lithium-ion
                  </div>
                  <div
                    className={`rhe-glow font-mono text-3xl font-black ${
                      lifetimeSavings >= 0 ? 'text-[#CCFF00]' : 'text-amber-500'
                    }`}
                  >
                    {fmtMillions(lifetimeSavings)}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {investment.irr !== null && (
                      <span className="flex items-center gap-1 border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-2 py-0.5 font-mono text-[11px] font-bold text-[#CCFF00]">
                        <TrendingUp size={11} aria-hidden="true" />
                        {(investment.irr * 100).toFixed(1)}% IRR
                      </span>
                    )}
                    {investment.paybackYear !== null && (
                      <span className="border border-slate-600 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-300">
                        Payback by year {investment.paybackYear}
                      </span>
                    )}
                    {investment.upfrontPremium <= 0 && (
                      <span className="border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-2 py-0.5 font-mono text-[11px] font-bold text-[#CCFF00]">
                        Cheaper from day one
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                    {lifetimeSavings >= 0
                      ? investment.irr !== null
                        ? `Savings over ${years} years. The IRR is the return on HD Hydro's ${fmtMillions(investment.upfrontPremium)} upfront premium, repaid by Lithium-ion's avoided augmentations and O&M.`
                        : `Cumulative savings over your ${years}-year window by choosing HD Hydro.`
                      : 'Lithium-ion holds a short-duration edge here — extend duration or window to flip it.'}
                  </p>
                </div>

                {/* Re-investment liability */}
                <div className="border border-slate-800 bg-[#121824] p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                    <RefreshCcw size={14} className="text-amber-500" aria-hidden="true" />
                    Future Re-Investment Liability
                  </div>
                  <div className="flex items-baseline gap-3">
                    <div>
                      <span className="rhe-glow font-mono text-3xl font-black text-[#CCFF00]">
                        £0
                      </span>
                      <span className="ml-1.5 text-[10px] font-bold uppercase text-slate-500">
                        HD Hydro
                      </span>
                    </div>
                    <div>
                      <span className="font-mono text-xl font-black text-amber-500">
                        {fmtMillions(reinvestmentLiability)}
                      </span>
                      <span className="ml-1.5 text-[10px] font-bold uppercase text-slate-500">
                        Li-ion
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-slate-500">
                    <AlertTriangle
                      size={12}
                      className="mt-0.5 shrink-0 text-amber-500"
                      aria-hidden="true"
                    />
                    {augmentations > 0
                      ? `Budgeted stack replacement${augmentations > 1 ? 's' : ''} (${augmentations}×) to keep Lithium-ion at contract capacity over ${years} years — a planned cost in any honest BESS model, and a line item HD Hydro simply doesn't have.`
                      : 'Within ~10 years Li-ion avoids replacement — but degrades ~2% every year regardless.'}
                  </p>
                </div>

                {/* Land & footprint */}
                <div className="border border-slate-800 bg-[#121824] p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                    <Leaf size={14} className="text-[#CCFF00]" aria-hidden="true" />
                    Land &amp; Footprint Reduction
                  </div>
                  <div className="rhe-glow font-mono text-3xl font-black text-[#CCFF00]">60%</div>
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                    Smaller environmental footprint vs. standard hydro — 2.5× denser R-19
                    fluid means 60% smaller pipes, tanks and land disruption.
                  </p>
                </div>

                {/* Deployment feasibility */}
                <div className="border border-slate-800 bg-[#121824] p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                    <ShieldCheck size={14} className="text-[#CCFF00]" aria-hidden="true" />
                    Deployment Reality
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2 border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-2.5 py-1.5">
                      <span className="flex items-center gap-1.5 font-bold text-[#CCFF00]">
                        <Landmark size={13} aria-hidden="true" /> HD Hydro
                      </span>
                      <span className="font-mono font-bold text-[#CCFF00]">
                        100m hills · ~2–3 yr build
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border border-slate-700 px-2.5 py-1.5">
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <BatteryCharging size={13} aria-hidden="true" /> Lithium-ion
                      </span>
                      <span className="font-mono text-slate-400">Anywhere · ~1–2 yr build</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border border-slate-700 px-2.5 py-1.5">
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <Mountain size={13} aria-hidden="true" /> Conventional Hydro
                      </span>
                      <span className="font-mono text-slate-500">300m+ mountains · 8+ yrs</span>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                    HD Hydro opens an order of magnitude more UK sites than mountain-locked
                    pumped hydro — small North Wales hillsides, not ranges.
                  </p>
                </div>
              </div>
            </div>

            {/* ---- 04 · The bottom line ---- */}
            <div className="space-y-4">
              <SectionHeader n="04" title="The Bottom Line" cue="why HD Hydro, in your numbers" />
              <div className="border-2 border-[#CCFF00] bg-[#CCFF00]/5 p-5">
                <div
                  className={`text-sm font-black uppercase tracking-wide ${
                    advice.tone === 'neutral' ? 'text-slate-200' : 'text-[#CCFF00]'
                  }`}
                >
                  {advice.title}
                </div>
                <p className="mb-4 mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-400">
                  {advice.body}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <div className="border border-[#CCFF00]/40 bg-[#0B1120] p-3">
                    <div
                      className={`rhe-glow font-mono text-xl font-black ${
                        lifetimeSavings >= 0 ? 'text-[#CCFF00]' : 'text-amber-500'
                      }`}
                    >
                      {fmtMillions(lifetimeSavings)}
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Cash saved vs Lithium-ion over {years} years
                    </div>
                  </div>
                  <div className="border border-[#CCFF00]/40 bg-[#0B1120] p-3">
                    <div className="rhe-glow font-mono text-xl font-black text-[#CCFF00]">
                      {investment.irr !== null
                        ? `${(investment.irr * 100).toFixed(1)}%`
                        : `${Math.max(0, hdAdvantagePct).toFixed(0)}%`}
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {investment.irr !== null
                        ? 'IRR on the upfront premium vs Li-ion'
                        : 'Lower cost per MWh than Lithium-ion'}
                    </div>
                  </div>
                  <div className="border border-[#CCFF00]/40 bg-[#0B1120] p-3">
                    <div className="rhe-glow font-mono text-xl font-black text-[#CCFF00]">
                      {presetId === 'anglesey'
                        ? `+${(simDay.firmingFactor - simDay.bareCoverage).toFixed(0)}pts`
                        : `−${(simDay.peakGridBefore - simDay.peakGridAfter).toFixed(0)}pts`}
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {presetId === 'anglesey'
                        ? `Continuous green power (${simDay.bareCoverage.toFixed(0)}% → ${simDay.firmingFactor.toFixed(0)}%)`
                        : `Peak-price grid exposure (${simDay.peakGridBefore.toFixed(0)}% → ${simDay.peakGridAfter.toFixed(0)}%)`}
                    </div>
                  </div>
                  <div className="border border-[#CCFF00]/40 bg-[#0B1120] p-3">
                    <div className="rhe-glow font-mono text-xl font-black text-[#CCFF00]">
                      {annualCurtailmentGWh.toFixed(1)} GWh
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Surplus power captured per year, not curtailed
                    </div>
                  </div>
                  <div className="border border-[#CCFF00]/40 bg-[#0B1120] p-3">
                    <div className="rhe-glow font-mono text-xl font-black text-[#CCFF00]">
                      {fmtTonnes(annualCO2Avoided)}
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      CO₂e avoided each year vs gas-fired firming
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[11px] leading-snug text-slate-400 sm:grid-cols-2">
                  {[
                    `One build, ${TECH.hdHydro.lifeYears} years of service — at ${fmtPerMWh(lcos.hdHydro)} vs ${fmtPerMWh(lcos.lithium)} for Lithium-ion at your design`,
                    `£0 of stack-replacement liability vs ${fmtMillions(reinvestmentLiability)} budgeted for Lithium-ion`,
                    '0% performance degradation — the capacity you contract in year 1 is the capacity you hold in year 60',
                    'Built on a 100m Welsh hillside with a 60% smaller footprint than conventional hydro — and zero exposure to battery supply chains',
                  ].map((line) => (
                    <div key={line} className="flex items-start gap-1.5">
                      <CircleCheck
                        size={12}
                        className="mt-0.5 shrink-0 text-[#CCFF00]"
                        aria-hidden="true"
                      />
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ---- Reference drawers ---- */}
            <details className="group border border-slate-800 bg-[#121824]">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-slate-400 transition-colors hover:text-slate-200">
                <Scale size={13} aria-hidden="true" />
                Straight Talk — when each technology is the right call
              </summary>
              <div className="border-t border-slate-800 p-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="border border-slate-700 p-3">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Where Lithium-ion is the right call
                    </div>
                    <ul className="space-y-1.5 text-[11px] leading-snug text-slate-500">
                      {[
                        'Durations of ~6 hours or less',
                        'Power needed on-grid within ~24 months',
                        'Revenue built on rapid frequency response',
                        'Small or urban sites with no usable hill',
                      ].map((item) => (
                        <li key={item} className="flex items-start gap-1.5">
                          <CircleCheck
                            size={12}
                            className="mt-0.5 shrink-0 text-slate-500"
                            aria-hidden="true"
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="border border-[#CCFF00]/40 bg-[#CCFF00]/5 p-3">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#CCFF00]">
                      Where HD Hydro is the right call
                    </div>
                    <ul className="space-y-1.5 text-[11px] leading-snug text-slate-400">
                      {[
                        'Firming for 8+ hours, day after day',
                        'Contracts and horizons of 20+ years',
                        'Zero-degradation contracted capacity',
                        'A hedge against cell-price & supply-chain risk',
                      ].map((item) => (
                        <li key={item} className="flex items-start gap-1.5">
                          <CircleCheck
                            size={12}
                            className="mt-0.5 shrink-0 text-[#CCFF00]"
                            aria-hidden="true"
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-snug text-slate-500">
                  The strongest portfolios use both: a fast battery for power services,
                  co-located with HD Hydro for deep, zero-degradation energy. We're happy to
                  design the hybrid.
                </p>
              </div>
            </details>

            <details className="group border border-slate-800 bg-[#121824]">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-slate-400 transition-colors hover:text-slate-200">
                <BadgeCheck size={13} aria-hidden="true" />
                Our Modelling Assumptions — open book
              </summary>
              <div className="grid grid-cols-1 gap-4 border-t border-slate-800 p-5 text-[11px] leading-relaxed text-slate-500 sm:grid-cols-3">
                <div>
                  <div className="mb-1 font-bold text-[#CCFF00]">RheEnergise HD Hydro</div>
                  £850/kW + £125/kWh installed (target cost) · 80% round-trip efficiency ·
                  60-year life, 0% degradation · 1.5%/yr O&amp;M · 15% machinery
                  refurbishment provision at year 30.
                </div>
                <div>
                  <div className="mb-1 font-bold text-amber-500">Lithium-ion BESS</div>
                  £80/kW + £170/kWh installed (current European pricing, adjustable with the
                  outlook toggle) · 85% round-trip efficiency, −2%/yr degradation (90% average
                  usable) · financed over 20 years · stack augmentation every ~11 years at 30%
                  of energy capex.
                </div>
                <div>
                  <div className="mb-1 font-bold text-slate-400">Shared &amp; Scenario</div>
                  Conventional pumped hydro £1,500/kW + £90/kWh, 78% RTE, 80-year life, 1%/yr
                  O&amp;M · 330 cycles/yr · your selected cost of capital ({discountPct}%)
                  applied equally · CO₂e at {GAS_CO2_T_PER_MWH} t/MWh vs unabated gas firming ·
                  winter week: 3-day wind lull at ~25% output, solar at 35% seasonal · IRR
                  &amp; cash chart undiscounted GBP, real terms.
                </div>
              </div>
            </details>
          </section>
        </div>

        <footer className="mt-8 border-t border-slate-800 pt-4 text-center text-[10px] text-slate-600">
          RheEnergise HD Hydro Client Proposal Tool · Indicative modelling for commercial
          discussion — not a binding quotation. All figures in GBP (£), real terms.
        </footer>
      </main>
    </div>

    {/* ============ PRINT-ONLY ONE-PAGE SUMMARY ============ */}
    <div className="hidden bg-white p-8 font-sans text-slate-900 print:block">
      <div className="flex items-center justify-between border-b-4 border-[#9BC400] pb-3">
        <div className="flex items-center gap-2">
          <RheBlobMark blob="#9BC400" text="#ffffff" size={48} />
          <div>
            <div className="text-2xl font-bold tracking-tight">Energise</div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              HD Hydro · Firming &amp; Storage Proposal Summary
            </div>
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div className="font-bold text-slate-700">{preset.label}</div>
          <div>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
      </div>

      <h2 className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">
        Your Configuration
      </h2>
      <div className="mt-1 grid grid-cols-4 gap-2 text-[11px]">
        {[
          [preset.demandLabel, fmtMW(demandMW)],
          ['Wind / Solar', `${fmtMW(windMW)} / ${fmtMW(solarMW)}`],
          ['HD Hydro Store', `${fmtMW(storageMW)} · ${fmtMWh(energyCapMWh)}`],
          ['Discharge Duration', `${durationHours} hours`],
          ['Evaluation Window', `${years} years`],
          ['Cost of Capital', `${discountPct}%`],
          ['Li-ion Price Outlook', liOutlook.label],
          [
            'Ofgem LDES Cap & Floor',
            capFloorEligible ? 'Meets 8h threshold — eligible to apply' : 'Below 8h threshold',
          ],
        ].map(([k, v]) => (
          <div key={k} className="border border-slate-300 p-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{k}</div>
            <div className="font-mono font-bold">{v}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">
        The Outcome for You
      </h2>
      <div className="mt-1 grid grid-cols-3 gap-2 text-center">
        <div className="border-2 border-[#9BC400] bg-[#F5FBE0] p-3">
          <div className="font-mono text-2xl font-black text-[#5C7A00]">
            {presetId === 'anglesey'
              ? `${simDay.bareCoverage.toFixed(0)}% → ${simDay.firmingFactor.toFixed(0)}%`
              : `${simDay.peakGridBefore.toFixed(0)}% → ${simDay.peakGridAfter.toFixed(0)}%`}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
            {presetId === 'anglesey'
              ? 'Continuous green power, without → with HD Hydro'
              : 'Peak-price grid draw, without → with HD Hydro'}
          </div>
        </div>
        <div className="border-2 border-[#9BC400] bg-[#F5FBE0] p-3">
          <div className="font-mono text-2xl font-black text-[#5C7A00]">
            {fmtMillions(lifetimeSavings)}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
            Saved vs Lithium-ion over {years} years
            {investment.irr !== null
              ? ` · ${(investment.irr * 100).toFixed(1)}% IRR${investment.paybackYear !== null ? `, payback yr ${investment.paybackYear}` : ''}`
              : ''}
          </div>
        </div>
        <div className="border-2 border-[#9BC400] bg-[#F5FBE0] p-3">
          <div className="font-mono text-2xl font-black text-[#5C7A00]">
            {fmtTonnes(annualCO2Avoided)}
          </div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
            CO₂e avoided per year vs gas-fired firming
          </div>
        </div>
      </div>

      <h2 className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">
        Levelized Cost of Storage at Your Design
      </h2>
      <table className="mt-1 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2 border-slate-400 text-left">
            <th className="py-1 pr-2">Technology</th>
            <th className="py-1 pr-2">LCOS</th>
            <th className="py-1 pr-2">Asset life</th>
            <th className="py-1 pr-2">Degradation</th>
            <th className="py-1">Re-investment over {years} yrs</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-200 bg-[#F5FBE0] font-bold">
            <td className="py-1 pr-2">RheEnergise HD Hydro</td>
            <td className="py-1 pr-2 font-mono">{fmtPerMWh(lcos.hdHydro)}</td>
            <td className="py-1 pr-2">60 years</td>
            <td className="py-1 pr-2">0%</td>
            <td className="py-1 font-mono">£0</td>
          </tr>
          <tr className="border-b border-slate-200">
            <td className="py-1 pr-2">Lithium-ion BESS</td>
            <td className="py-1 pr-2 font-mono">{fmtPerMWh(lcos.lithium)}</td>
            <td className="py-1 pr-2">~15–20 years</td>
            <td className="py-1 pr-2">−2% per year</td>
            <td className="py-1 font-mono">{fmtMillions(reinvestmentLiability)}</td>
          </tr>
          <tr>
            <td className="py-1 pr-2">Conventional Pumped Hydro</td>
            <td className="py-1 pr-2 font-mono">{fmtPerMWh(lcos.convHydro)}</td>
            <td className="py-1 pr-2">80 years</td>
            <td className="py-1 pr-2">0%</td>
            <td className="py-1">Requires 300m+ mountain site</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">
        Why HD Hydro Here
      </h2>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[11px] leading-snug">
        <li>
          One build, 60 years of zero-degradation service — the capacity contracted in year
          1 is the capacity held in year 60.
        </li>
        <li>
          {annualCurtailmentGWh.toFixed(1)} GWh of surplus renewable power captured each
          year instead of curtailed.
        </li>
        <li>
          Adding hours means bigger tanks and more R-19 fluid (2.5× denser than water) —
          not more battery cells: 60% smaller footprint than conventional hydro, sited on
          100&nbsp;m hills, not 300&nbsp;m+ mountains.
        </li>
        <li>
          Zero exposure to battery cell prices and supply chains; costs are steel, civils
          and fluid.
        </li>
      </ul>

      <p className="mt-4 border-t border-slate-300 pt-2 text-[9px] leading-snug text-slate-500">
        Indicative modelling for commercial discussion — not a binding quotation. GBP, real
        terms. Assumptions: HD Hydro £850/kW + £125/kWh, 80% RTE, 1.5%/yr O&amp;M, year-30
        refurbishment provision · Li-ion £80/kW + £170/kWh ({liOutlook.label.toLowerCase()}),
        85% RTE −2%/yr, augmentation every ~11 yrs at 30% of energy capex · 330 cycles/yr ·
        {discountPct}% cost of capital · CO₂e at {GAS_CO2_T_PER_MWH} t/MWh vs unabated gas
        firming. Scenario link: {scenarioLink}
      </p>
    </div>
    </>
  )
}
