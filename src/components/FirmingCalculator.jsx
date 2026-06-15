import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowRight,
  Award,
  BadgeCheck,
  Banknote,
  BatteryCharging,
  Building2,
  CalendarRange,
  CircleCheck,
  Clock,
  Factory,
  Gauge,
  Landmark,
  Link2,
  Percent,
  Printer,
  RotateCcw,
  Scale,
  Server,
  Snowflake,
  Sprout,
  Sun,
  Target,
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
/*  HD HYDRO COST ANCHOR                                               */
/*  RheEnergise published target: a 30 MWh reference system (250 m     */
/*  head, ~6h duration) at ~$310/kWh project capex. Larger builds get  */
/*  cheaper through economies of scale. Turbine-runner replacements    */
/*  every ~5 years are provisioned at ~$1,600/MWh/yr inside OPEX.      */
/* ------------------------------------------------------------------ */

const USD_TO_GBP = 0.79
const HD_REF_ENERGY_MWH = 30
const HD_REF_COST_PER_KWH = 310 * USD_TO_GBP // ≈ £245/kWh at reference scale
const HD_POWER_CAPEX_PER_KW = 840 // machinery share, calibrated at the 6h reference
const HD_ENERGY_CAPEX_PER_KWH = HD_REF_COST_PER_KWH - HD_POWER_CAPEX_PER_KW / 6 // ≈ £105/kWh
const HD_SCALE_EXPONENT = 0.92 // economies of scale on storage size
const HD_SCALE_FLOOR = 0.7 // cost reduction capped at 30% below reference
const HD_REPLACEMENT_PER_MWH_YEAR = 1600 * USD_TO_GBP // ≈ £1,264/MWh/yr in OPEX

function hdScaleFactor(energyMWh) {
  if (energyMWh <= 0) return 1
  return Math.max(
    HD_SCALE_FLOOR,
    Math.pow(energyMWh / HD_REF_ENERGY_MWH, HD_SCALE_EXPONENT - 1),
  )
}

const TECH = {
  hdHydro: {
    name: 'RheEnergise HD Hydro',
    fixedOMRate: 0.01, // % of capex per year (runner provision added separately)
    rte: 0.8, // round-trip efficiency, flat for life
    lifeYears: 60,
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
  const energyMWh = powerMW * durationHours
  if (techKey === 'hdHydro') {
    return (
      (powerMW * 1000 * HD_POWER_CAPEX_PER_KW + energyMWh * 1000 * HD_ENERGY_CAPEX_PER_KWH) *
      hdScaleFactor(energyMWh)
    )
  }
  const energyRate =
    techKey === 'lithium' ? t.energyCapexPerKWh * liPriceFactor : t.energyCapexPerKWh
  return powerMW * 1000 * t.powerCapexPerKW + energyMWh * 1000 * energyRate
}

/**
 * Levelized Cost of Storage (£/MWh discharged).
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
  if (techKey === 'hdHydro') {
    annualCost += energyMWh * HD_REPLACEMENT_PER_MWH_YEAR // runner provision in OPEX
  }

  const annualDischargeMWh = CYCLES_PER_YEAR * energyMWh * t.rte * capacityFactor
  if (annualDischargeMWh <= 0) return 0
  return annualCost / annualDischargeMWh
}

/**
 * Year-by-year cash cost (undiscounted £) for one technology.
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
    if (techKey === 'hdHydro') {
      cost += powerMW * durationHours * HD_REPLACEMENT_PER_MWH_YEAR // runner provision
    }
    flows.push(cost)
  }
  return flows
}

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
 * The investment case for HD Hydro vs Lithium-ion.
 */
function hdVsLiInvestmentCase(powerMW, durationHours, years, liFactor) {
  const hd = cashCostSchedule('hdHydro', powerMW, durationHours, years)
  const li = cashCostSchedule('lithium', powerMW, durationHours, years, liFactor)
  const diff = hd.map((c, y) => li[y] - c)

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

/**
 * Consultative technology-fit engine. Scores each technology 0–10 across five
 * transparent factors and returns a recommendation with confidence. Designed
 * to flip cleanly: short/fast/cheap-upfront favours Lithium-ion; long/durable/
 * low-cost-over-life favours HD Hydro.
 */
function technologyFit({ durationHours, years, lcosHd, lcosLi }) {
  const factors = []
  // 1 — Duration fit
  if (durationHours <= 4) factors.push({ label: `${durationHours}h duration`, hd: 0.3, li: 2 })
  else if (durationHours <= 6) factors.push({ label: `${durationHours}h duration`, hd: 1, li: 1.6 })
  else if (durationHours <= 8) factors.push({ label: `${durationHours}h duration`, hd: 1.7, li: 1 })
  else factors.push({ label: `${durationHours}h long duration`, hd: 2, li: 0.5 })
  // 2 — Ownership horizon
  if (years <= 12) factors.push({ label: `${years}-yr horizon`, hd: 0.6, li: 2 })
  else if (years < 20) factors.push({ label: `${years}-yr horizon`, hd: 1.2, li: 1.5 })
  else if (years < 30) factors.push({ label: `${years}-yr horizon`, hd: 2, li: 1 })
  else factors.push({ label: `${years}-yr horizon`, hd: 2, li: 0.7 })
  // 3 — Lifetime cost per MWh
  if (lcosHd > 0 && lcosLi > 0) {
    if (lcosHd <= lcosLi) factors.push({ label: 'Lifetime cost/MWh', hd: 2, li: 2 * (lcosHd / lcosLi) })
    else factors.push({ label: 'Lifetime cost/MWh', hd: 2 * (lcosLi / lcosHd), li: 2 })
  }
  // 4 — Upfront capital & deployment speed (structurally Li-favouring)
  factors.push({ label: 'Upfront capital & speed', hd: 0.6, li: 2 })
  // 5 — Asset life & degradation (structurally HD-favouring)
  factors.push({ label: 'Asset life & degradation', hd: 2, li: 0.6 })

  const hdScore = factors.reduce((a, c) => a + c.hd, 0)
  const liScore = factors.reduce((a, c) => a + c.li, 0)
  const lcosGap = lcosLi > 0 ? ((lcosLi - lcosHd) / lcosLi) * 100 : 0
  const margin = Math.abs(hdScore - liScore)
  const matched = Math.abs(lcosGap) < 5 && margin < 1
  const winner = matched ? 'matched' : hdScore >= liScore ? 'hd' : 'li'
  const confidence = matched ? 'Even' : margin >= 2.5 ? 'High' : margin >= 1.2 ? 'Medium' : 'Moderate'
  return { hdScore, liScore, winner, confidence, lcosGap, margin, factors }
}

/** Smallest discharge duration at which HD Hydro's LCOS meets Lithium-ion's. */
function breakEvenDuration(powerMW, years, finance) {
  for (let d = 4; d <= 16; d += 0.25) {
    const hd = calcLcos('hdHydro', powerMW, d, years, finance)
    const li = calcLcos('lithium', powerMW, d, years, finance)
    if (hd <= li) return d
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  CUSTOMER PROFILES                                                  */
/*  Each carries a project profile (physics) and the language that      */
/*  frames the whole conversation for that buyer.                       */
/* ------------------------------------------------------------------ */

const COASTAL_WIND = [
  0.7, 0.78, 0.85, 0.9, 0.85, 0.75, 0.6, 0.42, 0.25, 0.15, 0.12, 0.1, 0.1,
  0.12, 0.15, 0.2, 0.35, 0.55, 0.75, 0.9, 0.95, 0.92, 0.85, 0.78,
]
const INLAND_WIND = [
  0.4, 0.42, 0.45, 0.48, 0.5, 0.48, 0.44, 0.4, 0.36, 0.33, 0.3, 0.28, 0.28,
  0.3, 0.33, 0.36, 0.4, 0.44, 0.48, 0.52, 0.5, 0.47, 0.44, 0.42,
]

const PRESETS = {
  utility: {
    id: 'utility',
    label: 'Utility',
    tagline: 'Firm capacity & grid reliability',
    values:
      'You need firm, dependable capacity and long-duration resilience — turning variable renewables into power the grid can count on.',
    focus: ['Firm capacity', 'Grid reliability', 'Long-duration resilience'],
    icon: Building2,
    defaultWindMW: 180,
    defaultSolarMW: 60,
    defaultDemandMW: 90,
    demandLabel: 'Firm Capacity Required',
    demandSublabel: 'The dependable output you must guarantee to the grid',
    windCapacityFactor: 0.42,
    solarPeakShare: 0.75,
    windShape: COASTAL_WIND,
    demandProfile: 'flat',
    kpi: 'green',
    kpiName: 'Firm capacity delivered',
    loadDescription: 'Firming variable renewables into dependable grid capacity',
    gridChargingAllowed: false,
  },
  renewableDev: {
    id: 'renewableDev',
    label: 'Renewable Developer',
    tagline: 'Curtailment, shifting & revenue',
    values:
      'You want to stop spilling clean energy — capturing curtailed generation and shifting it to when it is worth most.',
    focus: ['Curtailment reduction', 'Energy shifting', 'Revenue optimisation'],
    icon: Sprout,
    defaultWindMW: 220,
    defaultSolarMW: 120,
    defaultDemandMW: 100,
    demandLabel: 'Firm Export Block',
    demandSublabel: 'The steady block you want to sell from a variable site',
    windCapacityFactor: 0.42,
    solarPeakShare: 0.78,
    windShape: COASTAL_WIND,
    demandProfile: 'flat',
    kpi: 'green',
    kpiName: 'Renewable utilisation',
    loadDescription: 'Capturing curtailment and shifting it into a saleable firm block',
    gridChargingAllowed: false,
  },
  dataCentre: {
    id: 'dataCentre',
    label: 'Data Centre',
    tagline: '24/7 firm clean power',
    values:
      'You need firm power, energy security and cost certainty — round-the-clock carbon-free energy matched hour by hour.',
    focus: ['Firm power', 'Energy security', 'Cost certainty'],
    icon: Server,
    defaultWindMW: 170,
    defaultSolarMW: 110,
    defaultDemandMW: 100,
    demandLabel: 'Continuous IT Load',
    demandSublabel: 'Your flat, round-the-clock data-centre demand',
    windCapacityFactor: 0.42,
    solarPeakShare: 0.75,
    windShape: COASTAL_WIND,
    demandProfile: 'flat',
    kpi: 'green',
    kpiName: '24/7 carbon-free energy',
    loadDescription: 'Matching a flat 24/7 load with round-the-clock clean power',
    gridChargingAllowed: false,
  },
  infraInvestor: {
    id: 'infraInvestor',
    label: 'Infrastructure Investor',
    tagline: 'IRR, cash stability & asset life',
    values:
      'You want stable, contracted cash flows from a long-life asset — the kind of infrastructure that compounds for decades.',
    focus: ['IRR', 'Cash-flow stability', 'Asset life'],
    icon: Banknote,
    defaultWindMW: 200,
    defaultSolarMW: 120,
    defaultDemandMW: 110,
    demandLabel: 'Contracted Output',
    demandSublabel: 'The firm capacity your offtake contract underwrites',
    windCapacityFactor: 0.42,
    solarPeakShare: 0.75,
    windShape: COASTAL_WIND,
    demandProfile: 'flat',
    kpi: 'green',
    kpiName: 'Firm contracted output',
    loadDescription: 'A bankable, long-life firming asset with contracted output',
    gridChargingAllowed: false,
  },
  industrial: {
    id: 'industrial',
    label: 'Industrial Energy User',
    tagline: 'Self-supply & cost control',
    values:
      'You want to own firm clean power and shield your operation from volatile peak network charges and carbon exposure.',
    focus: ['Energy cost control', 'Peak-charge avoidance', 'Decarbonisation'],
    icon: Factory,
    defaultWindMW: 40,
    defaultSolarMW: 60,
    defaultDemandMW: 70,
    demandLabel: 'Site Peak Demand',
    demandSublabel: 'Your site’s maximum draw during day shifts',
    windCapacityFactor: 0.33,
    solarPeakShare: 0.72,
    windShape: INLAND_WIND,
    demandProfile: 'industrial',
    kpi: 'peak',
    kpiName: 'Peak demand self-supplied',
    loadDescription: 'Manufacturing load shielded from peak network charges',
    gridChargingAllowed: true,
  },
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const OFF_PEAK = (h) => h <= 5 || h === 23

const INDUSTRIAL_SHAPE = HOURS.map((h) => {
  if (h >= 7 && h <= 18) return 1
  if (h >= 19 && h <= 21) return 0.7
  return 0.55
})

function solarShape(h, peakShare) {
  if (h < 6 || h > 19) return 0
  return Math.sin((Math.PI * (h - 6)) / 13) * peakShare
}

const WINTER_WIND_DAY_FACTORS = [1.2, 1.15, 0.9, 0.3, 0.22, 0.6, 1.1]
const WINTER_SOLAR_FACTOR = 0.35
const WEEK_DEMAND_FACTORS = [1, 1, 1, 1, 1, 0.75, 0.7]

/* ------------------------------------------------------------------ */
/*  STORAGE SIMULATION                                                 */
/* ------------------------------------------------------------------ */

function buildDayProfiles(preset, windMW, solarMW, demandMW) {
  const shapeAvg = preset.windShape.reduce((a, b) => a + b, 0) / 24
  const wind = HOURS.map(
    (h) => windMW * preset.windShape[h] * (preset.windCapacityFactor / shapeAvg),
  )
  const solar = HOURS.map((h) => solarMW * solarShape(h, preset.solarPeakShare))
  const load =
    preset.demandProfile === 'industrial'
      ? INDUSTRIAL_SHAPE.map((s) => s * demandMW)
      : HOURS.map(() => demandMW)
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
      load.push(
        preset.demandProfile === 'industrial'
          ? day.load[h] * WEEK_DEMAND_FACTORS[d]
          : day.load[h],
      )
      labels.push(`D${d + 1} ${String(h).padStart(2, '0')}:00`)
    }
  }
  return { wind, solar, load, labels }
}

function runStorageSim(
  preset,
  profiles,
  storagePowerMW,
  durationHours,
  { rte = TECH.hdHydro.rte, capacityFactor = 1 } = {},
) {
  const { wind, solar, load, labels } = profiles
  const N = load.length
  const oneWayEff = Math.sqrt(rte)
  const ratedPowerMW = storagePowerMW * capacityFactor
  const energyCapMWh = storagePowerMW * durationHours * capacityFactor

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

      const charge = Math.min(surplus, ratedPowerMW, (energyCapMWh - soc) / oneWayEff)
      soc += charge * oneWayEff
      greenIn += charge * oneWayEff

      let gridCharge = 0
      if (preset.gridChargingAllowed && OFF_PEAK(h) && soc < energyCapMWh * 0.95) {
        gridCharge = Math.min(ratedPowerMW - charge, (energyCapMWh - soc) / oneWayEff)
        soc += gridCharge * oneWayEff
        gridIn += gridCharge * oneWayEff
      }

      let discharge = 0
      const ridingGrid = preset.gridChargingAllowed && OFF_PEAK(h)
      if (deficit > 0 && !ridingGrid) {
        discharge = Math.min(deficit, ratedPowerMW, soc * oneWayEff)
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
    dailyGreenCharge: greenIn / daysSimulated,
    dailyGreenServed: greenServed / daysSimulated,
    dailyLoad: totalLoad / daysSimulated,
    dailyDirect: directServed / daysSimulated,
    dailyPeakLoad: peakLoad / daysSimulated,
    energyCapMWh,
    storagePowerMW,
  }
}

/* ------------------------------------------------------------------ */
/*  ANNUAL (SEASONAL) VIEW                                             */
/* ------------------------------------------------------------------ */

const normalise = (arr) => {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  return arr.map((v) => v / mean)
}
const WIND_MONTH_FACTORS = normalise([
  1.25, 1.2, 1.1, 0.95, 0.85, 0.75, 0.7, 0.75, 0.95, 1.1, 1.2, 1.3,
])
const SOLAR_MONTH_FACTORS = normalise([
  0.3, 0.45, 0.7, 1.0, 1.2, 1.25, 1.2, 1.05, 0.85, 0.55, 0.35, 0.25,
])
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function simulateYear(preset, windMW, solarMW, demandMW, storageMW, durationHours, techParams) {
  const base = buildDayProfiles(preset, windMW, solarMW, demandMW)
  const months = []
  let loadSum = 0
  let greenSum = 0
  let directSum = 0
  let curtailSum = 0
  let genSum = 0
  let peakLoadSum = 0
  let peakBeforeSum = 0
  let peakAfterSum = 0

  for (let m = 0; m < 12; m += 1) {
    const profiles = {
      wind: base.wind.map((v) => Math.min(windMW, v * WIND_MONTH_FACTORS[m])),
      solar: base.solar.map((v) => v * SOLAR_MONTH_FACTORS[m]),
      load: base.load,
      labels: base.labels,
    }
    const s = runStorageSim(preset, profiles, storageMW, durationHours, techParams)
    const days = MONTH_DAYS[m]
    const monthLoad = s.dailyLoad * days
    months.push({
      label: MONTH_LABELS[m],
      direct: (s.dailyDirect * days) / 1000,
      storage: (Math.max(0, s.dailyGreenServed - s.dailyDirect) * days) / 1000,
      grid: (Math.max(0, s.dailyLoad - s.dailyGreenServed) * days) / 1000,
    })
    loadSum += monthLoad
    greenSum += s.dailyGreenServed * days
    directSum += s.dailyDirect * days
    curtailSum += s.dailyGreenCharge * days
    genSum += s.genCoverage * monthLoad
    peakLoadSum += s.dailyPeakLoad * days
    peakBeforeSum += (s.peakGridBefore / 100) * s.dailyPeakLoad * days
    peakAfterSum += (s.peakGridAfter / 100) * s.dailyPeakLoad * days
  }

  return {
    months,
    firmingFactor: loadSum > 0 ? Math.min(100, (greenSum / loadSum) * 100) : 0,
    bareCoverage: loadSum > 0 ? Math.min(100, (directSum / loadSum) * 100) : 0,
    genCoverage: loadSum > 0 ? genSum / loadSum : 0,
    peakGridBefore: peakLoadSum > 0 ? (peakBeforeSum / peakLoadSum) * 100 : 0,
    peakGridAfter: peakLoadSum > 0 ? (peakAfterSum / peakLoadSum) * 100 : 0,
    annualGreenServedMWh: greenSum,
    annualCurtailMWh: curtailSum,
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
  const presetId = PRESETS[q.get('p')] ? q.get('p') : 'utility'
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
    viewMode: ['day', 'week', 'year'].includes(q.get('v')) ? q.get('v') : 'year',
  }
}

const INIT = initialStateFromUrl()

/* ------------------------------------------------------------------ */
/*  UI PRIMITIVES                                                      */
/* ------------------------------------------------------------------ */

function Slider({ icon: Icon, label, sublabel, guidance, value, min, max, step = 1, unit, onChange }) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-slate-200">{label}</div>
            {sublabel && <div className="text-xs leading-snug text-slate-500">{sublabel}</div>}
          </div>
        </div>
        <div className="shrink-0 rounded border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-2 py-0.5 font-mono text-sm font-bold text-[#CCFF00]">
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
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-slate-600">{unit(min)}</span>
        {guidance && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
            {guidance}
          </span>
        )}
        <span className="font-mono text-[10px] text-slate-600">{unit(max)}</span>
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

/** Small KPI tile used in the operational-outcomes row. */
function KpiTile({ value, label, accent = true }) {
  return (
    <div className="border border-slate-700 bg-[#0B1120] p-3 text-center">
      <div
        className={`font-mono text-lg font-black leading-tight ${accent ? 'rhe-glow text-[#CCFF00]' : 'text-slate-200'}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] font-bold uppercase leading-tight tracking-wider text-slate-500">
        {label}
      </div>
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

  useEffect(() => {
    const q = new URLSearchParams({
      p: presetId, w: windMW, s: solarMW, d: demandMW, sp: storageMW,
      h: durationHours, y: years, r: discountPct, li: liOutlookId, v: viewMode,
    })
    window.history.replaceState(null, '', `?${q.toString()}`)
  }, [presetId, windMW, solarMW, demandMW, storageMW, durationHours, years, discountPct, liOutlookId, viewMode])

  const scenarioQuery = new URLSearchParams({
    p: presetId, w: windMW, s: solarMW, d: demandMW, sp: storageMW,
    h: durationHours, y: years, r: discountPct, li: liOutlookId, v: viewMode,
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

  const simDay = useMemo(
    () => runStorageSim(preset, buildDayProfiles(preset, windMW, solarMW, demandMW), storageMW, durationHours),
    [preset, windMW, solarMW, demandMW, storageMW, durationHours],
  )
  const simWeek = useMemo(
    () => (viewMode === 'week'
      ? runStorageSim(preset, buildWeekProfiles(preset, windMW, solarMW, demandMW), storageMW, durationHours)
      : null),
    [viewMode, preset, windMW, solarMW, demandMW, storageMW, durationHours],
  )
  const simYear = useMemo(
    () => simulateYear(preset, windMW, solarMW, demandMW, storageMW, durationHours),
    [preset, windMW, solarMW, demandMW, storageMW, durationHours],
  )
  const sim = viewMode === 'week' && simWeek ? simWeek : viewMode === 'year' ? simYear : simDay

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
    () => [4, 6, 8, 10, 12, 14, 16].map((d) => {
      const hd = calcLcos('hdHydro', storageMW, d, years, finance)
      const li = calcLcos('lithium', storageMW, d, years, finance)
      return {
        duration: d,
        hdHydro: hd,
        hdLow: hd * 0.9,
        hdHigh: hd * 1.12,
        hdBand: [hd * 0.9, hd * 1.12],
        lithium: li,
        convHydro: calcLcos('convHydro', storageMW, d, years, finance),
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageMW, years, liOutlookId, discountPct],
  )

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
  const fit = technologyFit({ durationHours, years, lcosHd: lcos.hdHydro, lcosLi: lcos.lithium })
  const breakEven = breakEvenDuration(storageMW, years, finance)
  const breakEvenDown25 = breakEvenDuration(storageMW, years, { ...finance, liFactor: 0.75 })

  const liAugYears = []
  for (let y = TECH.lithium.augmentationIntervalYears; y < years; y += TECH.lithium.augmentationIntervalYears) {
    liAugYears.push(y)
  }
  const cashStart = cashCurve[0]
  const cashEnd = cashCurve[cashCurve.length - 1]

  const annualDischargeHD = CYCLES_PER_YEAR * energyCapMWh * TECH.hdHydro.rte
  const lifetimeSavings = (lcos.lithium - lcos.hdHydro) * annualDischargeHD * years
  const augmentations = lithiumAugmentations(years)
  const hdAdvantagePct = lcos.lithium > 0 ? ((lcos.lithium - lcos.hdHydro) / lcos.lithium) * 100 : 0
  const annualCO2Avoided = simYear.annualGreenServedMWh * GAS_CO2_T_PER_MWH
  const annualCurtailmentGWh = simYear.annualCurtailMWh / 1000
  const annualFirmGWh = simYear.annualGreenServedMWh / 1000

  const storageVsDemand = storageMW / Math.max(demandMW, 1)
  const capFloorEligible = durationHours >= 8
  const hdCapex = techCapex('hdHydro', storageMW, durationHours)

  const kpiBefore = preset.kpi === 'green' ? sim.bareCoverage : 100 - sim.peakGridBefore
  const kpiAfter = preset.kpi === 'green' ? sim.firmingFactor : 100 - sim.peakGridAfter
  const kpiYearBefore = preset.kpi === 'green' ? simYear.bareCoverage : 100 - simYear.peakGridBefore
  const kpiYearAfter = preset.kpi === 'green' ? simYear.firmingFactor : 100 - simYear.peakGridAfter

  // ----- Recommendation copy -----
  const recHd = fit.winner === 'hd'
  const recLi = fit.winner === 'li'
  const recMatched = fit.winner === 'matched'

  const hdReasons = [
    durationHours >= 8 && `Long-duration requirement (${durationHours}h)`,
    years >= 20 && `${years}-year investment horizon`,
    'Zero degradation over the contract',
    capFloorEligible && 'Eligible for long-duration storage support mechanisms',
    lcos.hdHydro <= lcos.lithium && 'Lower lifetime cost of storage',
  ].filter(Boolean)

  const liReasons = [
    durationHours <= 6 && `Short-duration profile (${durationHours}h)`,
    'Lower upfront capital',
    'Fastest deployment',
    years <= 15 && `Shorter investment horizon (${years} years)`,
    lcos.lithium < lcos.hdHydro && 'Lower lifetime cost at this duration',
  ].filter(Boolean)

  const liConsiderIf = [
    'Discharge duration falls below ~6 hours',
    'Speed to power becomes the primary objective',
    'The ownership horizon shortens materially',
    'Site space or grid timing constraints dominate',
  ]

  // ----- Asset-life timeline segments -----
  const horizonYears = years
  const liGenerations = augmentations + 1

  return (
    <>
    <div className="min-h-screen bg-[#0F172A] pb-10 font-sans text-slate-200 print:hidden">
      {/* ============ HEADER ============ */}
      <header className="border-b border-slate-800 bg-[#121824]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <RheBlobMark blob={NEON} text="#0F172A" size={44} />
            <div>
              <div className="text-xl font-bold leading-tight tracking-tight text-white">Energise</div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                Storage Technology Advisor
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
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pt-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* ============ LEFT: REQUIREMENTS ============ */}
          <section className="lg:col-span-4" aria-label="Your requirements">
            <div className="border border-slate-800 bg-[#121824] p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto rhe-scroll">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-base font-bold text-white">Your Requirements</h2>
                <button
                  type="button"
                  onClick={() => selectPreset(presetId)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 transition-colors hover:text-[#CCFF00]"
                >
                  <RotateCcw size={11} aria-hidden="true" /> Reset
                </button>
              </div>
              <p className="mb-5 text-xs text-slate-500">
                Tell us about your project. We’ll recommend the right technology — and show our working.
              </p>

              {/* Stage 1 — what problem */}
              <PanelTitle step="1" title="What Problem Are You Solving?" />
              <div className="mb-3 grid grid-cols-2 gap-2">
                {Object.values(PRESETS).map((p) => {
                  const Icon = p.icon
                  const active = p.id === presetId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectPreset(p.id)}
                      aria-pressed={active}
                      className={`flex flex-col items-start border p-2.5 text-left transition-colors ${
                        active ? 'border-[#CCFF00] bg-[#CCFF00]/10' : 'border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      <span
                        className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-full ${
                          active ? 'bg-[#CCFF00]/20 text-[#CCFF00]' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <Icon size={15} aria-hidden="true" />
                      </span>
                      <span className={`text-[11px] font-bold leading-tight ${active ? 'text-[#CCFF00]' : 'text-slate-200'}`}>
                        {p.label}
                      </span>
                      <span className="mt-0.5 text-[9px] italic leading-tight text-slate-500">{p.tagline}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mb-6 border-l-2 border-[#CCFF00]/50 pl-2.5 text-[11px] leading-snug text-slate-400">
                {preset.values}
              </p>

              {/* Stage 2 — storage requirement */}
              <PanelTitle step="2" title="How Much Storage Do You Need?" />
              <div className="mb-6">
                <Slider
                  icon={Gauge}
                  label={preset.demandLabel}
                  sublabel="The maximum demand shortfall the storage must cover."
                  guidance={storageMW <= 50 ? 'Small industrial site' : storageMW <= 200 ? 'Large renewable project' : 'Grid-scale infrastructure'}
                  value={demandMW}
                  min={10}
                  max={1000}
                  step={10}
                  unit={fmtMW}
                  onChange={setDemandMW}
                />
              </div>
              <div className="mb-6 space-y-5">
                <Slider
                  icon={Wind}
                  label="Wind Capacity"
                  sublabel={`${Math.round(preset.windCapacityFactor * 100)}% capacity factor for this project profile`}
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
                <Slider
                  icon={BatteryCharging}
                  label="Storage Power Rating"
                  sublabel="The maximum demand shortfall the system must cover at once."
                  guidance={storageMW <= 50 ? 'Small industrial' : storageMW <= 200 ? 'Large project' : 'Grid-scale'}
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
                  sublabel="How long must energy stay available during low generation?"
                  guidance={durationHours <= 4 ? 'Lithium-ion territory' : durationHours <= 7 ? 'Transition zone' : 'Long-duration storage'}
                  value={durationHours}
                  min={4}
                  max={16}
                  unit={(v) => `${v}${v >= 16 ? '+' : ''} hrs`}
                  onChange={setDurationHours}
                />
              </div>

              {/* Stage 5 — financials */}
              <PanelTitle step="3" title="Investment Parameters" />
              <div className="space-y-5">
                <Slider
                  icon={CalendarRange}
                  label="Investment Horizon"
                  sublabel="How long will you own and operate this asset? Longer ownership favours longer-life technologies."
                  guidance={years <= 15 ? 'Short' : years < 30 ? 'Medium' : 'Multi-decade'}
                  value={years}
                  min={10}
                  max={60}
                  step={5}
                  unit={(v) => `${v} yrs`}
                  onChange={setYears}
                />
                <Slider
                  icon={Percent}
                  label="Cost of Capital"
                  sublabel="Converts future costs into today’s value. Higher rates favour lower upfront-cost solutions."
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
                  <BatteryCharging size={13} aria-hidden="true" /> Your Storage System
                </div>
                <div className="text-center font-mono text-2xl font-black text-[#CCFF00]">
                  {fmtMW(storageMW)} <span className="text-slate-600">·</span> {fmtMWh(energyCapMWh)}
                </div>
                <div className="mt-1 text-center text-[10px] uppercase tracking-wider text-slate-500">
                  Power Rating · Energy Capacity
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  {storageVsDemand >= 1
                    ? `Sized to cover your full ${fmtMW(demandMW)} requirement for ${durationHours} hours.`
                    : `Covers ${Math.round(storageVsDemand * 100)}% of your ${fmtMW(demandMW)} requirement — raise the power rating for full cover.`}
                </p>
              </div>
            </div>
          </section>

          {/* ============ RIGHT: ADVISORY ============ */}
          <section className="space-y-8 lg:col-span-8" aria-label="Recommendation and analysis">
            {/* ===== RECOMMENDATION PANEL ===== */}
            <div
              className={`border-2 p-5 ${
                recMatched ? 'border-sky-400/60 bg-sky-400/5'
                  : recLi ? 'border-amber-500/60 bg-amber-500/5'
                  : 'border-[#CCFF00] bg-[#CCFF00]/5'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                    <Award size={14} className={recMatched ? 'text-sky-400' : recLi ? 'text-amber-400' : 'text-[#CCFF00]'} aria-hidden="true" />
                    Best technology for this use case
                  </div>
                  <div className={`mt-1 text-2xl font-black ${recMatched ? 'text-sky-300' : recLi ? 'text-amber-400' : 'text-[#CCFF00]'}`}>
                    {recMatched ? 'Technologies Closely Matched' : recLi ? 'Lithium-ion Recommended' : 'HD Hydro Recommended'}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {recMatched ? 'Economics within 5% — both warrant further evaluation' : `Confidence: ${fit.confidence}`}
                  </div>
                </div>
                {/* Score badges */}
                <div className="flex items-stretch gap-2">
                  <div className={`border px-3 py-2 text-center ${recHd ? 'border-[#CCFF00] bg-[#CCFF00]/10' : 'border-slate-700'}`}>
                    <div className={`font-mono text-2xl font-black leading-none ${recHd ? 'text-[#CCFF00]' : 'text-slate-300'}`}>
                      {fit.hdScore.toFixed(0)}<span className="text-sm text-slate-500">/10</span>
                    </div>
                    <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">HD Hydro</div>
                  </div>
                  <div className={`border px-3 py-2 text-center ${recLi ? 'border-amber-500 bg-amber-500/10' : 'border-slate-700'}`}>
                    <div className={`font-mono text-2xl font-black leading-none ${recLi ? 'text-amber-400' : 'text-slate-300'}`}>
                      {fit.liScore.toFixed(0)}<span className="text-sm text-slate-500">/10</span>
                    </div>
                    <div className="mt-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">Lithium-ion</div>
                  </div>
                </div>
              </div>

              {/* Why */}
              <div className="mt-4 border-t border-slate-700/60 pt-3">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {recMatched ? 'Why it’s a close call' : 'Why'}
                </div>
                {recMatched ? (
                  <p className="text-xs leading-relaxed text-slate-300">
                    At {durationHours}h over {years} years, lifetime costs land within 5% ({fmtPerMWh(lcos.hdHydro)} vs {fmtPerMWh(lcos.lithium)}).
                    Lithium-ion offers speed and lower upfront cost; HD Hydro offers longevity and zero degradation. The right call depends on which you value more.
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {(recLi ? liReasons : hdReasons).map((r) => (
                      <li key={r} className="flex items-start gap-1.5 text-xs leading-snug text-slate-300">
                        <CircleCheck size={13} className={`mt-0.5 shrink-0 ${recLi ? 'text-amber-400' : 'text-[#CCFF00]'}`} aria-hidden="true" />
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* ===== 01 · OPERATIONAL OUTCOME ===== */}
            <div className="space-y-4">
              <SectionHeader n="01" title="How Storage Improves System Performance" cue="the operational problem storage solves" />

              {/* Operational KPI cards */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KpiTile value={`${annualFirmGWh.toFixed(0)} GWh`} label="Firm energy delivered / yr" />
                <KpiTile value={`${annualCurtailmentGWh.toFixed(1)} GWh`} label="Curtailment recovered / yr" />
                <KpiTile value={`${kpiYearBefore.toFixed(0)}% → ${kpiYearAfter.toFixed(0)}%`} label={preset.kpiName} />
                <KpiTile value={fmtTonnes(annualCO2Avoided)} label="CO₂e avoided / yr" />
              </div>

              <div className="border border-slate-800 bg-[#121824] p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { id: 'year', label: 'Full Year', Icon: CalendarRange },
                      { id: 'day', label: 'Typical Day', Icon: Clock },
                      { id: 'week', label: 'Winter Stress Week', Icon: Snowflake },
                    ].map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setViewMode(id)}
                        aria-pressed={viewMode === id}
                        className={`flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                          viewMode === id ? 'border-[#CCFF00] bg-[#CCFF00]/10 text-[#CCFF00]' : 'border-slate-700 text-slate-500 hover:border-slate-500'
                        }`}
                      >
                        <Icon size={12} aria-hidden="true" /> {label}
                      </button>
                    ))}
                    <span className="font-mono text-[11px] text-slate-500">{fmtMW(storageMW)} / {fmtMWh(energyCapMWh)} store</span>
                  </div>
                  <div className="flex items-stretch gap-2">
                    <div className="border border-slate-700 px-3 py-1.5 text-center">
                      <div className="font-mono text-xl font-black leading-none text-slate-500">{kpiBefore.toFixed(0)}%</div>
                      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">No storage</div>
                    </div>
                    <div className="flex items-center text-slate-500" aria-hidden="true"><ArrowRight size={16} /></div>
                    <div className="border border-[#CCFF00] bg-[#CCFF00]/10 px-3 py-1.5 text-center">
                      <div className="rhe-glow font-mono text-xl font-black leading-none text-[#CCFF00]">{kpiAfter.toFixed(0)}%</div>
                      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-300">With storage</div>
                    </div>
                  </div>
                </div>

                <div className="h-72">
                  {viewMode === 'year' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={simYear.months} margin={{ top: 5, right: 5, bottom: 0, left: -5 }}>
                        <CartesianGrid stroke="#1E293B" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                        <YAxis tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={false}
                          label={{ value: 'GWh', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 10 }} />
                        <Tooltip content={({ active, payload, label }) =>
                          active && payload?.length ? (
                            <div className="border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs shadow-xl">
                              <div className="mb-1 font-mono font-bold text-slate-300">{label}</div>
                              {payload.map((p) => (
                                <div key={p.name} className="flex items-center justify-between gap-4">
                                  <span style={{ color: p.color }}>{p.name}</span>
                                  <span className="font-mono text-slate-200">{p.value.toFixed(1)} GWh</span>
                                </div>
                              ))}
                            </div>
                          ) : null} />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="plainline" />
                        <Bar name="Green, direct" dataKey="direct" stackId="e" fill={SKY} fillOpacity={0.65} />
                        <Bar name="Green, via storage" dataKey="storage" stackId="e" fill={NEON} fillOpacity={0.9} />
                        <Bar name="Grid / unmet" dataKey="grid" stackId="e" fill="#475569" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={sim.day} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                        <CartesianGrid stroke="#1E293B" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#334155' }}
                          interval={viewMode === 'day' ? 3 : 23} tickFormatter={(v) => (viewMode === 'week' ? v.replace(' 00:00', '') : v)} />
                        <YAxis tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={false}
                          label={{ value: 'MW', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 10 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="plainline" />
                        <ReferenceLine y={0} stroke="#334155" />
                        <Area name="Wind" dataKey="wind" stackId="gen" type="monotone" stroke={SKY} fill={SKY} fillOpacity={0.18} strokeWidth={1.5} />
                        <Area name="Solar" dataKey="solar" stackId="gen" type="monotone" stroke={SOLAR_YELLOW} fill={SOLAR_YELLOW} fillOpacity={0.18} strokeWidth={1.5} />
                        <Bar name="Storage Deploying" dataKey="discharge" fill={NEON} fillOpacity={0.9} barSize={viewMode === 'day' ? 10 : 2} />
                        <Bar name="Storage Catching Excess" dataKey="charge" fill={NEON} fillOpacity={0.3} barSize={viewMode === 'day' ? 10 : 2} />
                        <Line name="Your Demand" dataKey="load" type="stepAfter" stroke="#F8FAFC" strokeWidth={viewMode === 'day' ? 2 : 1.5} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {viewMode === 'year'
                    ? 'Twelve months of energy with UK seasonality: demand served by renewables directly (blue), by storage (bright green), or left to the grid (grey).'
                    : 'Bright green: storage deploying through deficits. Dim green below the line: catching excess that would otherwise be curtailed.'}
                  {viewMode === 'week' && ' Days 4–5 are a wind lull — longer duration rides further into it.'}
                </p>
                {preset.kpi === 'green' && sim.genCoverage > 0 && sim.genCoverage < 0.95 && (
                  <p className="mt-2 flex items-start gap-1.5 border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-snug text-amber-400/90">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {viewMode === 'week'
                      ? `In this winter week your generation produces ${(sim.genCoverage * 100).toFixed(0)}% of the energy you need — no storage technology bridges a multi-day lull alone. Deep duration extends ride-through; more generation closes the gap.`
                      : `Your generation mix produces ${(sim.genCoverage * 100).toFixed(0)}% of your ${viewMode === 'year' ? 'annual' : 'daily'} energy need. Storage firms what you generate — add capacity to raise the ceiling.`}
                  </p>
                )}
              </div>
            </div>

            {/* ===== 02 · TECHNOLOGY FIT ===== */}
            <div className="space-y-4">
              <SectionHeader n="02" title="When Does Each Technology Make Sense?" cue="an honest fit assessment, not a sales pitch" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="border border-amber-500/40 bg-amber-500/5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-amber-400">
                      <BatteryCharging size={14} aria-hidden="true" /> Lithium-ion excels when
                    </div>
                    <span className={`border px-2 py-0.5 font-mono text-xs font-bold ${recLi ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-slate-700 text-slate-400'}`}>
                      {fit.liScore.toFixed(0)}/10
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-[11px] leading-snug text-slate-400">
                    {['2–6h duration', 'Fast deployment needed', 'Smaller physical footprint', 'Lower upfront investment', 'Merchant / arbitrage optimisation', 'Shorter ownership horizon'].map((i) => (
                      <li key={i} className="flex items-start gap-1.5"><CircleCheck size={12} className="mt-0.5 shrink-0 text-amber-500/70" aria-hidden="true" />{i}</li>
                    ))}
                  </ul>
                </div>
                <div className="border border-[#CCFF00]/40 bg-[#CCFF00]/5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-[#CCFF00]">
                      <Landmark size={14} aria-hidden="true" /> HD Hydro excels when
                    </div>
                    <span className={`border px-2 py-0.5 font-mono text-xs font-bold ${recHd ? 'border-[#CCFF00] bg-[#CCFF00]/20 text-[#CCFF00]' : 'border-slate-700 text-slate-400'}`}>
                      {fit.hdScore.toFixed(0)}/10
                    </span>
                  </div>
                  <ul className="space-y-1.5 text-[11px] leading-snug text-slate-300">
                    {['8h+ duration', 'Multi-decade operation', 'Low degradation requirements', 'Long-term contracted revenues', 'Grid resilience applications', 'Long-duration storage frameworks'].map((i) => (
                      <li key={i} className="flex items-start gap-1.5"><CircleCheck size={12} className="mt-0.5 shrink-0 text-[#CCFF00]" aria-hidden="true" />{i}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="flex items-center gap-3 border border-slate-700 bg-[#121824] px-4 py-3 text-xs text-slate-400">
                <Target size={16} className="shrink-0 text-[#CCFF00]" aria-hidden="true" />
                <span>
                  At your scenario — <span className="font-bold text-slate-200">{durationHours}h duration, {years}-year horizon</span> — the fit scores are
                  HD Hydro <span className="font-bold text-[#CCFF00]">{fit.hdScore.toFixed(0)}/10</span> and
                  Lithium-ion <span className="font-bold text-amber-400">{fit.liScore.toFixed(0)}/10</span>.
                  {recMatched ? ' Close enough that either could be defended.' : recLi ? ' Lithium-ion is the stronger fit here.' : ' HD Hydro is the stronger fit here.'}
                </span>
              </div>
            </div>

            {/* ===== 03 · LIFETIME CASH COST (primary) ===== */}
            <div className="space-y-4">
              <SectionHeader n="03" title="Lifetime Cash Cost" cue="the total you’ll actually pay — the clearest economic test" />
              <div className="border border-slate-800 bg-[#121824] p-5">
                <p className="mb-3 text-[11px] leading-snug text-slate-500">
                  Everything you pay, added up year by year: upfront build, running costs, and — for batteries — cell replacements.
                  Lithium-ion starts lower; each replacement steps it up.{' '}
                  {investment.paybackYear !== null
                    ? <span className="font-semibold text-[#CCFF00]">HD Hydro overtakes Lithium-ion in Year {investment.paybackYear}.</span>
                    : <span className="font-semibold text-amber-400">Lithium-ion remains lower cost throughout this evaluation period.</span>}
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cashCurve} margin={{ top: 8, right: 8, bottom: 0, left: -5 }}>
                      <CartesianGrid stroke="#1E293B" vertical={false} />
                      <XAxis dataKey="year" tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#334155' }} tickFormatter={(y) => `Yr ${y}`} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={false}
                        tickFormatter={(v) => (v >= 1000 ? `£${(v / 1000).toFixed(1)}B` : `£${v.toFixed(0)}M`)} />
                      <Tooltip content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs shadow-xl">
                            <div className="mb-1 font-mono font-bold text-slate-300">By year {label}, you’ll have spent</div>
                            {payload.map((p) => (
                              <div key={p.name} className="flex items-center justify-between gap-4">
                                <span style={{ color: p.color }}>{p.name}</span>
                                <span className="font-mono text-slate-200">{fmtMillions(p.value * 1e6)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null} />
                      {liAugYears.map((y) => (
                        <ReferenceLine key={y} x={y} stroke={AMBER} strokeDasharray="3 3" strokeOpacity={0.7}
                          label={{ value: 'Battery replacement', fill: AMBER, fontSize: 9, position: 'insideTopLeft', angle: -90, offset: 8 }} />
                      ))}
                      {investment.paybackYear !== null && (
                        <ReferenceLine x={investment.paybackYear} stroke={NEON} strokeDasharray="4 4"
                          label={{ value: 'HD Hydro overtakes', fill: NEON, fontSize: 9, position: 'insideBottomRight' }} />
                      )}
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="plainline" />
                      <Line name="Lithium-ion BESS" dataKey="lithium" type="stepAfter" stroke={AMBER} strokeWidth={2} dot={false} />
                      <Line name="RheEnergise HD Hydro" dataKey="hdHydro" type="monotone" stroke={NEON} strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                  <div className="border border-slate-700 p-2">
                    <div className="font-mono text-sm font-black text-slate-300">{fmtMillions(cashStart.hdHydro * 1e6)}<span className="text-slate-600"> / </span>{fmtMillions(cashStart.lithium * 1e6)}</div>
                    <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">Upfront · HD / Li-ion</div>
                  </div>
                  <div className="border border-slate-700 p-2">
                    <div className="font-mono text-sm font-black text-slate-300">{fmtMillions((cashEnd.hdHydro / years) * 1e6)}<span className="text-slate-600"> / </span>{fmtMillions((cashEnd.lithium / years) * 1e6)}</div>
                    <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">Per year · HD / Li-ion</div>
                  </div>
                  <div className="border border-slate-700 p-2">
                    <div className="font-mono text-sm font-black text-slate-300">{fmtMillions(cashEnd.hdHydro * 1e6)}<span className="text-slate-600"> / </span>{fmtMillions(cashEnd.lithium * 1e6)}</div>
                    <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">Total by yr {years}</div>
                  </div>
                  <div className={`border p-2 ${lifetimeSavings >= 0 ? 'border-[#CCFF00]/50 bg-[#CCFF00]/5' : 'border-amber-500/50 bg-amber-500/5'}`}>
                    <div className={`rhe-glow font-mono text-sm font-black ${lifetimeSavings >= 0 ? 'text-[#CCFF00]' : 'text-amber-400'}`}>{fmtMillions(Math.abs(cashEnd.lithium - cashEnd.hdHydro) * 1e6)}</div>
                    <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">{cashEnd.hdHydro <= cashEnd.lithium ? 'Saved with HD Hydro' : 'Saved with Li-ion'}</div>
                  </div>
                </div>
                {investment.irr !== null && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1 border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-2 py-0.5 font-mono font-bold text-[#CCFF00]"><TrendingUp size={11} aria-hidden="true" />{(investment.irr * 100).toFixed(1)}% IRR</span>
                    <span>on HD Hydro’s {fmtMillions(investment.upfrontPremium)} upfront premium, repaid by avoided battery replacements & O&amp;M.</span>
                  </div>
                )}
              </div>
            </div>

            {/* ===== 04 · LCOS (secondary) ===== */}
            <div className="space-y-4">
              <SectionHeader n="04" title="Cost Per MWh — Across Durations" cue="how the economics move with duration (secondary view)" />
              <div className="border border-slate-800 bg-[#121824] p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 border border-[#CCFF00]/50 bg-[#CCFF00]/10 px-3 py-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your design</span>
                    <span className="font-mono text-base font-black text-[#CCFF00]">{durationHours}h · {fmtPerMWh(lcos.hdHydro)}</span>
                    <span className={`font-mono text-xs font-bold ${hdAdvantagePct >= 0 ? 'text-[#CCFF00]' : 'text-amber-400'}`}>
                      {hdAdvantagePct >= 0 ? `${hdAdvantagePct.toFixed(0)}% below Li-ion` : `${Math.abs(hdAdvantagePct).toFixed(0)}% above Li-ion`}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Li-ion prices:</span>
                    {LI_OUTLOOKS.map((o) => (
                      <button key={o.id} type="button" onClick={() => setLiOutlookId(o.id)} aria-pressed={o.id === liOutlookId}
                        className={`border px-2 py-0.5 text-[10px] font-bold transition-colors ${o.id === liOutlookId ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-slate-700 text-slate-500 hover:border-slate-500'}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-60">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={lcosCurve} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                      <CartesianGrid stroke="#1E293B" vertical={false} />
                      <XAxis dataKey="duration" tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#334155' }} tickFormatter={(d) => `${d}h`} />
                      <YAxis tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `£${v.toFixed(0)}`} />
                      <Tooltip content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs shadow-xl">
                            <div className="mb-1 font-mono font-bold text-slate-300">{label}-hour duration</div>
                            {payload.filter((p) => p.dataKey === 'hdHydro' || p.dataKey === 'lithium' || p.dataKey === 'convHydro').map((p) => (
                              <div key={p.name} className="flex items-center justify-between gap-4">
                                <span style={{ color: p.color }}>{p.name}</span>
                                <span className="font-mono text-slate-200">{fmtPerMWh(p.value)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null} />
                      <ReferenceArea x1={durationHours - 0.6} x2={durationHours + 0.6} fill={NEON} fillOpacity={0.08} />
                      <ReferenceLine x={Math.min(durationHours, 16)} stroke={NEON} strokeDasharray="4 4"
                        label={{ value: 'Your design', fill: NEON, fontSize: 10, position: 'insideTopRight' }} />
                      <Area name="HD Hydro range" dataKey="hdBand" stroke="none" fill={NEON} fillOpacity={0.12} legendType="none" />
                      <Line name="Lithium-ion BESS" dataKey="lithium" stroke={AMBER} strokeWidth={2} dot={{ r: 3, fill: AMBER, strokeWidth: 0 }} />
                      <Line name="Conventional Hydro" dataKey="convHydro" stroke={STEEL} strokeWidth={2} strokeDasharray="6 4" dot={false} />
                      <Line name="RheEnergise HD Hydro" dataKey="hdHydro" stroke={NEON} strokeWidth={3} dot={{ r: 4, fill: NEON, strokeWidth: 0 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  Shaded green band shows HD Hydro’s conservative–optimistic range (±10–12%). At your {durationHours}h design, HD Hydro is {fmtPerMWh(lcos.hdHydro)} vs Lithium-ion {fmtPerMWh(lcos.lithium)}.
                </p>
              </div>

              {/* Cap & floor slim line */}
              <div className={`flex flex-wrap items-center justify-between gap-3 border px-4 py-3 ${capFloorEligible ? 'border-[#CCFF00]/60 bg-[#CCFF00]/5' : 'border-slate-700 bg-[#121824]'}`}>
                <div className="flex items-center gap-2.5">
                  <BadgeCheck size={16} className={capFloorEligible ? 'text-[#CCFF00]' : 'text-slate-500'} aria-hidden="true" />
                  <p className="text-xs leading-snug text-slate-400">
                    <span className={`font-black uppercase tracking-wide ${capFloorEligible ? 'text-[#CCFF00]' : 'text-slate-300'}`}>Ofgem LDES Cap &amp; Floor: </span>
                    {capFloorEligible
                      ? `your ${durationHours}h design meets the 8-hour threshold — eligible for 20–25 years of revenue-floor protection. (8h Lithium-ion qualifies too.)`
                      : `at ${durationHours}h you’re below the 8-hour threshold for revenue-floor support.`}
                  </p>
                </div>
                <button type="button" onClick={() => { setDurationHours(Math.max(8, durationHours)); setYears(25) }}
                  className={`shrink-0 border px-3 py-1.5 text-[11px] font-bold transition-colors ${capFloorEligible && years === 25 ? 'border-slate-700 text-slate-600' : 'border-[#CCFF00]/60 bg-[#CCFF00]/10 text-[#CCFF00] hover:bg-[#CCFF00]/20'}`}>
                  {capFloorEligible && years === 25 ? 'Framed for the scheme ✓' : 'Frame for the scheme: 8h+ / 25 yrs'}
                </button>
              </div>
            </div>

            {/* ===== 05 · ASSET LIFE ===== */}
            <div className="space-y-4">
              <SectionHeader n="05" title="Asset Life Over Your Horizon" cue="how many times you’ll build over " />
              <div className="border border-slate-800 bg-[#121824] p-5">
                <div className="space-y-4">
                  {/* HD track */}
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-[#CCFF00]">RheEnergise HD Hydro</span>
                      <span className="font-mono text-slate-400">60+ yr life · one build · 0% degradation</span>
                    </div>
                    <div className="flex h-9 overflow-hidden border border-[#CCFF00]/40">
                      <div className="flex w-full items-center justify-center bg-[#CCFF00]/15 text-[10px] font-bold text-[#CCFF00]">
                        Single asset — operates the full {horizonYears} years
                      </div>
                    </div>
                  </div>
                  {/* Li track */}
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-amber-400">Lithium-ion BESS</span>
                      <span className="font-mono text-slate-400">{liGenerations} build{liGenerations > 1 ? 's' : ''} · replaced ~every {TECH.lithium.augmentationIntervalYears} yrs</span>
                    </div>
                    <div className="flex h-9 gap-0.5">
                      {Array.from({ length: liGenerations }).map((_, i) => (
                        <div key={i} className="flex flex-1 items-center justify-center border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold text-amber-400">
                          {i === 0 ? 'Initial' : `Rebuild ${i}`}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-snug text-slate-500">
                  Over a {horizonYears}-year horizon, Lithium-ion is rebuilt {liGenerations} time{liGenerations > 1 ? 's' : ''} as cells reach end of life,
                  while HD Hydro runs as a single 60-year asset. This is the structural reason the lifetime-cash and LCOS gaps widen with the ownership horizon — and why short horizons favour Lithium-ion.
                </p>
              </div>
            </div>

            {/* ===== 06 · WHAT COULD CHANGE THIS ===== */}
            <div className="space-y-4">
              <SectionHeader n="06" title="What Could Change This Result?" cue="the honest sensitivities every analyst will test" />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="border border-[#CCFF00]/30 bg-[#CCFF00]/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-[#CCFF00]">
                    <Scale size={14} aria-hidden="true" /> What if batteries get cheaper?
                  </div>
                  <p className="text-xs leading-relaxed text-slate-300">
                    {breakEven
                      ? <>At current assumptions, HD Hydro matches Lithium-ion from <span className="font-bold text-[#CCFF00]">{breakEven}h</span> duration upward.</>
                      : <>At current assumptions, Lithium-ion stays lower cost across all modelled durations.</>}{' '}
                    {breakEvenDown25
                      ? <>Even if Lithium-ion capex falls 25%, the cross-over only moves to <span className="font-bold text-[#CCFF00]">{breakEvenDown25}h</span>.</>
                      : <>If Lithium-ion capex falls 25%, it remains lower cost across the modelled range — try the price toggle above.</>}{' '}
                    Use the <span className="font-semibold">Li-ion prices</span> control in section 04 to test it live.
                  </p>
                </div>
                <div className="border border-slate-700 bg-[#121824] p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-300">
                    <AlertTriangle size={14} className="text-amber-500" aria-hidden="true" /> Risks &amp; trade-offs
                  </div>
                  <ul className="grid grid-cols-1 gap-1.5 text-[11px] leading-snug text-slate-400 sm:grid-cols-2">
                    {['Battery prices fall faster than expected', 'Project duration is reduced', 'Revenue support unavailable', 'Cost of capital rises', 'Suitable hydro site unavailable', 'Construction / permitting delays', 'Faster speed-to-power required', 'First-of-a-kind delivery risk'].map((r) => (
                      <li key={r} className="flex items-start gap-1.5"><AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-500/70" aria-hidden="true" />{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="text-[11px] italic leading-snug text-slate-500">
                Candid on maturity: Lithium-ion is gigawatt-proven today; HD Hydro is demonstrator-proven with its first commercial fleet in development — which is why long-duration deals are typically anchored in cap-and-floor revenue protection and contracted capacity guarantees.
              </p>
            </div>

            {/* ===== 07 · COMMERCIAL CONCLUSION ===== */}
            <div className="space-y-4">
              <SectionHeader n="07" title="Commercial Conclusion" cue="the 30-second takeaway" />
              <div className={`border-2 p-5 ${recLi ? 'border-amber-500/60 bg-amber-500/5' : recMatched ? 'border-sky-400/60 bg-sky-400/5' : 'border-[#CCFF00] bg-[#CCFF00]/5'}`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Recommendation</div>
                <p className="mt-1 text-lg font-black leading-snug text-white">
                  {recMatched
                    ? `For this scenario, HD Hydro and Lithium-ion are closely matched — either can be justified.`
                    : recLi
                      ? `Lithium-ion is the preferred technology for this scenario.`
                      : `HD Hydro is the preferred technology for this scenario.`}
                </p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Key drivers</div>
                    <ul className="space-y-1 text-[11px] leading-snug text-slate-300">
                      {(recLi ? liReasons : recMatched ? [`${durationHours}h duration`, `${years}-year horizon`, 'Lifetime costs within 5%', 'Both technically capable'] : hdReasons).map((d) => (
                        <li key={d} className="flex items-start gap-1.5"><CircleCheck size={12} className={`mt-0.5 shrink-0 ${recLi ? 'text-amber-400' : 'text-[#CCFF00]'}`} aria-hidden="true" />{d}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {recLi ? 'Consider HD Hydro instead if' : 'Consider Lithium-ion instead if'}
                    </div>
                    <ul className="space-y-1 text-[11px] leading-snug text-slate-400">
                      {(recLi
                        ? ['Duration extends beyond ~8 hours', 'The horizon lengthens past 20 years', 'Zero-degradation firm capacity is required', 'A 60-year asset life is valued']
                        : liConsiderIf
                      ).map((d) => (
                        <li key={d} className="flex items-start gap-1.5"><ArrowRight size={12} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />{d}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                {!recLi && (
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-700/60 pt-3 sm:grid-cols-4">
                    <KpiTile value={fmtPerMWh(lcos.hdHydro)} label="HD Hydro LCOS" />
                    <KpiTile value={investment.paybackYear !== null ? `Yr ${investment.paybackYear}` : '—'} label="Cost cross-over" />
                    <KpiTile value={fmtMillions(Math.abs(lifetimeSavings))} label={`${years}-yr saving vs Li-ion`} />
                    <KpiTile value={`${fit.hdScore.toFixed(0)}/10`} label="Technology fit score" />
                  </div>
                )}
              </div>
            </div>

            {/* ===== Assumptions drawer ===== */}
            <details className="group border border-slate-800 bg-[#121824]">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-slate-400 transition-colors hover:text-slate-200">
                <BadgeCheck size={13} aria-hidden="true" /> Our Modelling Assumptions — open book
              </summary>
              <div className="grid grid-cols-1 gap-4 border-t border-slate-800 p-5 text-[11px] leading-relaxed text-slate-500 sm:grid-cols-3">
                <div>
                  <div className="mb-1 font-bold text-[#CCFF00]">RheEnergise HD Hydro</div>
                  Target project capex $310/kWh (≈£{Math.round(HD_REF_COST_PER_KWH)}/kWh) at the 30&nbsp;MWh reference build, split £{HD_POWER_CAPEX_PER_KW}/kW machinery + £{Math.round(HD_ENERGY_CAPEX_PER_KWH)}/kWh storage, falling with scale (exponent {HD_SCALE_EXPONENT}, floored at {Math.round(HD_SCALE_FLOOR * 100)}%) — your design £{Math.round(hdCapex / (energyCapMWh * 1000)).toLocaleString('en-GB')}/kWh · 80% RTE · 60-yr life, 0% degradation · O&amp;M 1%/yr + ≈£{Math.round(HD_REPLACEMENT_PER_MWH_YEAR).toLocaleString('en-GB')}/MWh/yr runner provision in OPEX.
                </div>
                <div>
                  <div className="mb-1 font-bold text-amber-500">Lithium-ion BESS</div>
                  £80/kW + £170/kWh installed (current European pricing, adjustable) · 85% RTE, −2%/yr degradation (90% avg usable) · financed over 20 yrs · stack augmentation every ~11 yrs at 30% of energy capex.
                </div>
                <div>
                  <div className="mb-1 font-bold text-slate-400">Shared &amp; method</div>
                  Conventional pumped hydro £1,500/kW + £90/kWh, 78% RTE, 80-yr life · 330 cycles/yr · cost of capital {discountPct}% applied equally · fit score is a transparent 5-factor model (duration, horizon, lifetime cost, upfront/speed, asset life) · CO₂e {GAS_CO2_T_PER_MWH} t/MWh vs gas · cost-only — revenue stacking out of scope.
                </div>
              </div>
            </details>
          </section>
        </div>

        <footer className="mt-8 border-t border-slate-800 pt-4 text-center text-[10px] text-slate-600">
          RheEnergise Storage Technology Advisor · Indicative modelling for commercial discussion — not a binding quotation. All figures in GBP (£), real terms.
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
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Storage Technology Recommendation</div>
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div className="font-bold text-slate-700">{preset.label}</div>
          <div>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
      </div>

      <div className="mt-4 border-2 border-[#9BC400] bg-[#F5FBE0] p-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Recommendation</div>
        <div className="text-xl font-black text-[#3F5400]">
          {recMatched ? 'Technologies closely matched' : recLi ? 'Lithium-ion recommended' : 'HD Hydro recommended'}
          <span className="ml-2 text-sm font-bold text-slate-600">
            {recMatched ? '(economics within 5%)' : `(confidence: ${fit.confidence})`} · HD {fit.hdScore.toFixed(0)}/10 vs Li-ion {fit.liScore.toFixed(0)}/10
          </span>
        </div>
      </div>

      <h2 className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">Your Configuration</h2>
      <div className="mt-1 grid grid-cols-4 gap-2 text-[11px]">
        {[
          [preset.demandLabel, fmtMW(demandMW)],
          ['Wind / Solar', `${fmtMW(windMW)} / ${fmtMW(solarMW)}`],
          ['Storage System', `${fmtMW(storageMW)} · ${fmtMWh(energyCapMWh)}`],
          ['Discharge Duration', `${durationHours} hours`],
          ['Investment Horizon', `${years} years`],
          ['Cost of Capital', `${discountPct}%`],
          ['Indicative Build Cost', fmtMillions(hdCapex)],
          ['Ofgem LDES Cap & Floor', capFloorEligible ? 'Meets 8h threshold' : 'Below 8h threshold'],
        ].map(([k, v]) => (
          <div key={k} className="border border-slate-300 p-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{k}</div>
            <div className="font-mono font-bold">{v}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">Operational Outcome</h2>
      <div className="mt-1 grid grid-cols-4 gap-2 text-center">
        <div className="border-2 border-[#9BC400] bg-[#F5FBE0] p-2">
          <div className="font-mono text-lg font-black text-[#5C7A00]">{kpiYearBefore.toFixed(0)}% → {kpiYearAfter.toFixed(0)}%</div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600">{preset.kpiName}</div>
        </div>
        <div className="border-2 border-[#9BC400] bg-[#F5FBE0] p-2">
          <div className="font-mono text-lg font-black text-[#5C7A00]">{annualFirmGWh.toFixed(0)} GWh</div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600">Firm energy / yr</div>
        </div>
        <div className="border-2 border-[#9BC400] bg-[#F5FBE0] p-2">
          <div className="font-mono text-lg font-black text-[#5C7A00]">{annualCurtailmentGWh.toFixed(1)} GWh</div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600">Curtailment recovered / yr</div>
        </div>
        <div className="border-2 border-[#9BC400] bg-[#F5FBE0] p-2">
          <div className="font-mono text-lg font-black text-[#5C7A00]">{fmtTonnes(annualCO2Avoided)}</div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600">CO₂e avoided / yr</div>
        </div>
      </div>

      <h2 className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">Economics at Your Design</h2>
      <table className="mt-1 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2 border-slate-400 text-left">
            <th className="py-1 pr-2">Technology</th><th className="py-1 pr-2">LCOS</th><th className="py-1 pr-2">Total {years}-yr cash</th><th className="py-1 pr-2">Asset life</th><th className="py-1">Rebuilds</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-200 bg-[#F5FBE0] font-bold">
            <td className="py-1 pr-2">RheEnergise HD Hydro</td><td className="py-1 pr-2 font-mono">{fmtPerMWh(lcos.hdHydro)}</td><td className="py-1 pr-2 font-mono">{fmtMillions(cashEnd.hdHydro * 1e6)}</td><td className="py-1 pr-2">60 years</td><td className="py-1">1</td>
          </tr>
          <tr className="border-b border-slate-200">
            <td className="py-1 pr-2">Lithium-ion BESS</td><td className="py-1 pr-2 font-mono">{fmtPerMWh(lcos.lithium)}</td><td className="py-1 pr-2 font-mono">{fmtMillions(cashEnd.lithium * 1e6)}</td><td className="py-1 pr-2">~15–20 years</td><td className="py-1">{liGenerations}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[11px]">
        {investment.paybackYear !== null
          ? `HD Hydro overtakes Lithium-ion on cumulative cost in Year ${investment.paybackYear}${investment.irr !== null ? `, a ${(investment.irr * 100).toFixed(1)}% IRR on the upfront premium` : ''}.`
          : `Lithium-ion remains lower cost across this ${years}-year horizon.`}
      </p>

      <h2 className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">Consider Lithium-ion Instead If</h2>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] leading-snug">
        {liConsiderIf.map((d) => <li key={d}>{d}</li>)}
      </ul>

      <p className="mt-4 border-t border-slate-300 pt-2 text-[9px] leading-snug text-slate-500">
        Indicative modelling for commercial discussion — not a binding quotation. GBP, real terms. HD Hydro target capex $310/kWh at 30 MWh reference scaling with size (your design £{Math.round(hdCapex / (energyCapMWh * 1000))}/kWh), 80% RTE, 1%/yr O&amp;M + ≈$1,600/MWh/yr runner provision · Li-ion £80/kW + £170/kWh ({liOutlook.label.toLowerCase()}), 85% RTE −2%/yr, augmentation ~11 yrs · {discountPct}% cost of capital · fit score is a transparent 5-factor model. Scenario link: {scenarioLink}
      </p>
    </div>
    </>
  )
}
