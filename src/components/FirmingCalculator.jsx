import { useMemo, useState } from 'react'
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
  BatteryCharging,
  CalendarRange,
  CircleCheck,
  Clock,
  Factory,
  Gauge,
  Landmark,
  Leaf,
  MapPin,
  Mountain,
  Percent,
  PiggyBank,
  RefreshCcw,
  Scale,
  ShieldCheck,
  Sun,
  TrendingUp,
  Wind,
  Zap,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  BRAND                                                              */
/* ------------------------------------------------------------------ */

const NEON = '#CCFF00'
const STEEL = '#64748B'
const AMBER = '#F59E0B'
const SKY = '#38BDF8'
const SOLAR_YELLOW = '#FDE047'

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
  const hd = cashCostSchedule('hdHydro', powerMW, durationHours, years, liFactor)
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

/* ------------------------------------------------------------------ */
/*  24-HOUR FIRMING SIMULATION                                         */
/* ------------------------------------------------------------------ */

function simulateDay(preset, windMW, solarMW, demandMW, storagePowerMW, durationHours) {
  const oneWayEff = Math.sqrt(TECH.hdHydro.rte) // 80% RTE split across charge/discharge
  const energyCapMWh = storagePowerMW * durationHours

  const shapeAvg = preset.windShape.reduce((a, b) => a + b, 0) / 24
  const wind = HOURS.map(
    (h) => windMW * preset.windShape[h] * (preset.windCapacityFactor / shapeAvg),
  )
  const solar = HOURS.map((h) => solarMW * solarShape(h, preset.solarPeakShare))
  const gen = HOURS.map((h) => wind[h] + solar[h])

  // Customer demand: a flat contracted block (Anglesey) or the factory's
  // day-shift profile scaled to its peak (Deeside).
  const load =
    preset.id === 'anglesey'
      ? HOURS.map(() => demandMW)
      : INDUSTRIAL_SHAPE.map((s) => s * demandMW)

  // Repeat identical days until the state of charge reaches a cyclic steady
  // state (start-of-day SoC stops moving), then report that settled day.
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
      day = runDay(true)
      break
    }
    runDay(false)
  }

  function runDay(record) {
    const rows = []
    for (const h of HOURS) {
      const L = load[h]
      const direct = Math.min(gen[h], L)
      const surplus = gen[h] - direct
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
          label: `${String(h).padStart(2, '0')}:00`,
          wind: wind[h],
          solar: solar[h],
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

  return {
    day,
    firmingFactor,
    bareCoverage,
    genCoverage,
    peakGridBefore,
    peakGridAfter,
    dailyGreenCharge: greenIn, // renewable surplus captured per day (MWh)
    energyCapMWh,
    storagePowerMW,
  }
}

/* ------------------------------------------------------------------ */
/*  FORMATTING                                                         */
/* ------------------------------------------------------------------ */

const fmtMW = (v) => `${Math.round(v).toLocaleString('en-GB')} MW`
const fmtMWh = (v) => `${Math.round(v).toLocaleString('en-GB')} MWh`
const fmtPerMWh = (v) => `£${Math.round(v).toLocaleString('en-GB')}/MWh`

function fmtMillions(value) {
  const m = value / 1e6
  if (Math.abs(m) >= 1000) return `£${(m / 1000).toFixed(2)}B`
  return `£${m.toFixed(1)}M`
}

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
  const [presetId, setPresetId] = useState('anglesey')
  const [windMW, setWindMW] = useState(PRESETS.anglesey.defaultWindMW)
  const [solarMW, setSolarMW] = useState(PRESETS.anglesey.defaultSolarMW)
  const [demandMW, setDemandMW] = useState(PRESETS.anglesey.defaultDemandMW)
  const [storageMW, setStorageMW] = useState(PRESETS.anglesey.defaultDemandMW)
  const [durationHours, setDurationHours] = useState(8)
  const [years, setYears] = useState(25)
  const [discountPct, setDiscountPct] = useState(7)
  const [liOutlookId, setLiOutlookId] = useState('flat')

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

  const energyCapMWh = storageMW * durationHours

  const sim = useMemo(
    () => simulateDay(preset, windMW, solarMW, demandMW, storageMW, durationHours),
    [preset, windMW, solarMW, demandMW, storageMW, durationHours],
  )

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

  // Executive metrics ------------------------------------------------
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

  const storageVsDemand = storageMW / Math.max(demandMW, 1)

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

  return (
    <div className="min-h-screen bg-[#0F172A] pb-10 font-sans text-slate-200">
      {/* ============ HEADER ============ */}
      <header className="border-b border-slate-800 bg-[#121824]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border border-[#CCFF00] bg-[#CCFF00]/10">
              <Zap size={20} className="text-[#CCFF00]" aria-hidden="true" />
            </div>
            <div>
              <div className="text-lg font-black uppercase leading-tight tracking-wider text-white">
                Rhe<span className="text-[#CCFF00]">Energise</span>
              </div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                HD Hydro · Firming &amp; LCOS Calculator
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-semibold">
            <span className="border border-slate-700 px-2.5 py-1 text-slate-400">
              80% Round-Trip Efficiency
            </span>
            <span className="border border-slate-700 px-2.5 py-1 text-slate-400">
              60-Year Asset Life
            </span>
            <span className="border border-[#CCFF00]/50 bg-[#CCFF00]/10 px-2.5 py-1 text-[#CCFF00]">
              0% Degradation
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pt-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* ============ LEFT: DESIGN YOUR SYSTEM ============ */}
          <section className="lg:col-span-4" aria-label="Design your system">
            <div className="border border-slate-800 bg-[#121824] p-5">
              <h2 className="mb-1 text-base font-bold text-white">Design Your System</h2>
              <p className="mb-5 text-xs text-slate-500">
                Start with what you need to power. Live economics on the right.
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
                  max={150}
                  step={5}
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
                  max={200}
                  step={5}
                  unit={fmtMW}
                  onChange={setWindMW}
                />
                <Slider
                  icon={Sun}
                  label="Solar Capacity"
                  sublabel="Seasonal daytime generation"
                  value={solarMW}
                  min={0}
                  max={100}
                  step={5}
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
                  max={150}
                  step={5}
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

          {/* ============ RIGHT: THE RHEENERGISE ADVANTAGE ============ */}
          <section className="space-y-6 lg:col-span-8" aria-label="The RheEnergise advantage">
            {/* ---- 1. 24-hour firming look ---- */}
            <div className="border border-slate-800 bg-[#121824] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white">The 24-Hour Firming Look</h2>
                  <p className="text-xs text-slate-500">
                    {preset.loadDescription} ·{' '}
                    <span className="font-mono text-slate-400">
                      {fmtMW(storageMW)} / {fmtMWh(energyCapMWh)} store
                    </span>
                  </p>
                </div>
                {/* Before / after in the customer's own KPI: green firming for
                    the export hub, peak-price exposure for the factory */}
                <div>
                  <div className="flex items-stretch gap-2">
                    <div className="border border-slate-700 px-3 py-2 text-right">
                      <div className="font-mono text-2xl font-black leading-none text-slate-500">
                        {(presetId === 'anglesey'
                          ? sim.bareCoverage
                          : sim.peakGridBefore
                        ).toFixed(0)}
                        %
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-600">
                        {presetId === 'anglesey' ? 'Green, No Storage' : 'Peak Grid Draw, No Storage'}
                      </div>
                    </div>
                    <div className="flex items-center text-slate-500" aria-hidden="true">
                      <ArrowRight size={18} />
                    </div>
                    <div className="border border-[#CCFF00] bg-[#CCFF00]/10 px-4 py-2 text-right">
                      <div className="rhe-glow font-mono text-2xl font-black leading-none text-[#CCFF00]">
                        {(presetId === 'anglesey'
                          ? sim.firmingFactor
                          : sim.peakGridAfter
                        ).toFixed(0)}
                        %
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                        With HD Hydro
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 text-right text-[10px] text-slate-600">
                    {presetId === 'anglesey'
                      ? 'Green Firming Factor — your path to 100% continuous green power'
                      : 'Share of peak-window power bought from the grid at peak prices'}
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
                      interval={3}
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
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      iconType="plainline"
                    />
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
                      barSize={10}
                    />
                    <Bar
                      name="Storage Catching Excess"
                      dataKey="charge"
                      fill={NEON}
                      fillOpacity={0.3}
                      barSize={10}
                    />
                    <Line
                      name="Your Demand"
                      dataKey="load"
                      type="stepAfter"
                      stroke="#F8FAFC"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Bright green blocks: the HD Hydro store deploying through generation
                deficits. Dim green below the line: catching excess power that would
                otherwise be curtailed.
              </p>
              {presetId === 'anglesey' && sim.genCoverage > 0 && sim.genCoverage < 0.95 && (
                <p className="mt-2 flex items-start gap-1.5 border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-snug text-amber-400/90">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  Your generation mix produces {(sim.genCoverage * 100).toFixed(0)}% of your
                  daily energy need. Storage firms what you generate — add wind or solar
                  capacity to raise the green ceiling.
                </p>
              )}
            </div>

            {/* ---- 2. Financial profile ---- */}
            <div className="border border-slate-800 bg-[#121824] p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Levelized Cost of Storage (LCOS)
                  </h2>
                  <p className="text-xs text-slate-500">
                    £ per MWh delivered, across discharge durations, over your{' '}
                    {years}-year window at {discountPct}% cost of capital
                  </p>
                </div>
                {hdAdvantagePct >= 1 ? (
                  <div className="border border-[#CCFF00]/50 bg-[#CCFF00]/10 px-3 py-1.5 text-xs font-bold text-[#CCFF00]">
                    HD Hydro {hdAdvantagePct.toFixed(0)}% below Lithium-ion at your design
                  </div>
                ) : (
                  <div className="border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs font-bold text-amber-500">
                    Lithium-ion leads at this design — extend duration or window
                  </div>
                )}
              </div>

              {/* Honest sensitivity: where do Li-ion prices go? */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Lithium-ion price outlook:
                </span>
                {LI_OUTLOOKS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setLiOutlookId(o.id)}
                    aria-pressed={o.id === liOutlookId}
                    className={`border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                      o.id === liOutlookId
                        ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                        : 'border-slate-700 text-slate-500 hover:border-slate-500'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
                <span className="text-[10px] text-slate-600">
                  We model the competition at its best — pick the future you believe in.
                </span>
              </div>

              <div className="h-64">
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
                              <div
                                key={p.name}
                                className="flex items-center justify-between gap-4"
                              >
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
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="plainline" />
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
                <div className="border border-[#CCFF00]/60 bg-[#CCFF00]/5 p-3 text-center">
                  <div className="rhe-glow font-mono text-xl font-black text-[#CCFF00]">
                    {fmtPerMWh(lcos.hdHydro)}
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    RheEnergise HD Hydro
                  </div>
                </div>
                <div className="border border-amber-500/40 p-3 text-center">
                  <div className="font-mono text-xl font-black text-amber-500">
                    {fmtPerMWh(lcos.lithium)}
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Lithium-ion BESS
                  </div>
                </div>
                <div className="border border-slate-700 p-3 text-center">
                  <div className="font-mono text-xl font-black text-slate-400">
                    {fmtPerMWh(lcos.convHydro)}
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Conventional Hydro
                  </div>
                </div>
              </div>
            </div>

            {/* ---- 3. Cumulative cash cost ---- */}
            <div className="border border-slate-800 bg-[#121824] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Total Cash Out the Door — {years} Years
                  </h2>
                  <p className="text-xs text-slate-500">
                    Cumulative spend, undiscounted. Watch Lithium-ion step up at every
                    stack augmentation while HD Hydro stays flat.
                  </p>
                </div>
              </div>
              <div className="h-56">
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
                      tickFormatter={(v) => `£${v.toFixed(0)}M`}
                    />
                    <Tooltip
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs shadow-xl">
                            <div className="mb-1 font-mono font-bold text-slate-300">
                              Year {label}
                            </div>
                            {payload.map((p) => (
                              <div
                                key={p.name}
                                className="flex items-center justify-between gap-4"
                              >
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

            {/* ---- 4. Executive grid ---- */}
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
                      ? `Savings over ${years} years. The IRR is the return earned on HD Hydro's ${fmtMillions(investment.upfrontPremium)} upfront premium, repaid by Lithium-ion's avoided augmentations and O&M.`
                      : `Cumulative savings over your ${years}-year window by choosing HD Hydro.`
                    : 'Lithium-ion holds a short-duration edge here — extend duration or window to flip it.'}
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
                    <span className="font-mono text-slate-400">
                      Anywhere · ~1–2 yr build
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 border border-slate-700 px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <Mountain size={13} aria-hidden="true" /> Conventional Hydro
                    </span>
                    <span className="font-mono text-slate-500">
                      300m+ mountains · 8+ yrs
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                  HD Hydro opens an order of magnitude more UK sites than mountain-locked
                  pumped hydro — small North Wales hillsides, not ranges.
                </p>
              </div>
            </div>

            {/* ---- 5. Straight talk: honest fit guide ---- */}
            <div className="border border-slate-800 bg-[#121824] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Scale size={15} className="text-[#CCFF00]" aria-hidden="true" />
                <h2 className="text-sm font-bold uppercase tracking-wide text-white">
                  Straight Talk — Pick the Right Tool
                </h2>
              </div>
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

            {/* ---- 6. Strategic advice banner ---- */}
            <div
              className={`flex items-start gap-3 border p-4 ${
                advice.tone === 'neutral'
                  ? 'border-slate-600 bg-[#121824]'
                  : advice.tone === 'positive'
                    ? 'border-[#CCFF00]/60 bg-[#CCFF00]/5'
                    : 'border-[#CCFF00] bg-[#CCFF00]/10'
              }`}
              role="status"
            >
              <Zap
                size={18}
                className={`mt-0.5 shrink-0 ${
                  advice.tone === 'neutral' ? 'text-slate-400' : 'text-[#CCFF00]'
                }`}
                aria-hidden="true"
              />
              <div>
                <div
                  className={`text-sm font-black uppercase tracking-wide ${
                    advice.tone === 'neutral' ? 'text-slate-200' : 'text-[#CCFF00]'
                  }`}
                >
                  {advice.title}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{advice.body}</p>
              </div>
            </div>

            {/* ---- 7. The bottom line: figures-backed close ---- */}
            <div className="border-2 border-[#CCFF00] bg-[#CCFF00]/5 p-5">
              <div className="mb-1 flex items-center gap-2">
                <Zap size={16} className="text-[#CCFF00]" aria-hidden="true" />
                <h2 className="text-sm font-black uppercase tracking-wide text-white">
                  The Bottom Line — Why HD Hydro Wins Here
                </h2>
              </div>
              <p className="mb-4 text-xs text-slate-400">
                Your configuration: {fmtMW(storageMW)} / {fmtMWh(energyCapMWh)} store at{' '}
                {preset.label}, evaluated over {years} years.
              </p>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="border border-[#CCFF00]/40 bg-[#0B1120] p-3">
                  <div
                    className={`rhe-glow font-mono text-2xl font-black ${
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
                  <div className="rhe-glow font-mono text-2xl font-black text-[#CCFF00]">
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
                  <div className="rhe-glow font-mono text-2xl font-black text-[#CCFF00]">
                    {presetId === 'anglesey'
                      ? `+${(sim.firmingFactor - sim.bareCoverage).toFixed(0)}pts`
                      : `−${(sim.peakGridBefore - sim.peakGridAfter).toFixed(0)}pts`}
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {presetId === 'anglesey'
                      ? `Continuous green power (${sim.bareCoverage.toFixed(0)}% → ${sim.firmingFactor.toFixed(0)}%)`
                      : `Peak-price grid exposure (${sim.peakGridBefore.toFixed(0)}% → ${sim.peakGridAfter.toFixed(0)}%)`}
                  </div>
                </div>
                <div className="border border-[#CCFF00]/40 bg-[#0B1120] p-3">
                  <div className="rhe-glow font-mono text-2xl font-black text-[#CCFF00]">
                    {((sim.dailyGreenCharge * 365) / 1000).toFixed(1)} GWh
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Surplus power captured per year, not curtailed
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

            {/* ---- 8. Assumptions disclosure ---- */}
            <details className="group border border-slate-800 bg-[#121824]">
              <summary className="cursor-pointer select-none px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-slate-400 transition-colors hover:text-slate-200">
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
                  <div className="mb-1 font-bold text-slate-400">Shared &amp; Conventional</div>
                  Conventional pumped hydro £1,500/kW + £90/kWh, 78% RTE, 80-year life,
                  1%/yr O&amp;M · all technologies cycle 330× per year · your selected cost
                  of capital ({discountPct}%) applied equally, financed over the shorter of
                  asset life and your window · IRR &amp; cash chart undiscounted GBP, real
                  terms.
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
  )
}
