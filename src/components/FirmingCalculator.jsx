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
  BatteryCharging,
  CalendarRange,
  Clock,
  Factory,
  Landmark,
  Leaf,
  MapPin,
  Mountain,
  PiggyBank,
  RefreshCcw,
  ShieldCheck,
  Sun,
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
/* ------------------------------------------------------------------ */

// Technology cost & physics assumptions (transparent, linear inputs).
const TECH = {
  hdHydro: {
    name: 'RheEnergise HD Hydro',
    powerCapexPerKW: 850, // £/kW — pump-turbines, R-19 loop
    energyCapexPerKWh: 125, // £/kWh — 60% smaller tanks & pipes vs water
    fixedOMRate: 0.015, // % of capex per year
    rte: 0.83, // round-trip efficiency, flat for life
    lifeYears: 60,
    degradationPerYear: 0, // zero performance loss
  },
  lithium: {
    name: 'Lithium-ion BESS',
    powerCapexPerKW: 100,
    energyCapexPerKWh: 230,
    fixedOMRate: 0.02,
    rte: 0.85, // starting RTE — degrades ~2%/yr
    lifeYears: 15, // cell stack life without augmentation
    degradationPerYear: 0.02,
    augmentationIntervalYears: 11, // stack replacement every 10–12 yrs
    augmentationCostShare: 0.35, // of initial energy capex, per event
    avgCapacityFactor: 0.9, // average usable capacity between augmentations
  },
  convHydro: {
    name: 'Conventional Pumped Hydro',
    powerCapexPerKW: 1500, // mountain-scale civil works
    energyCapexPerKWh: 90,
    fixedOMRate: 0.01,
    rte: 0.78,
    lifeYears: 80,
    degradationPerYear: 0,
  },
}

const CYCLES_PER_YEAR = 330 // one full cycle per day with maintenance margin
const DISCOUNT_RATE = 0.07

// Capital recovery factor — turns upfront capex into a flat annual payment.
function crf(rate, years) {
  const f = Math.pow(1 + rate, years)
  return (rate * f) / (f - 1)
}

function lithiumAugmentations(years) {
  const t = TECH.lithium
  return Math.floor(Math.max(0, years - 1) / t.augmentationIntervalYears)
}

/**
 * Levelized Cost of Storage (£/MWh discharged).
 * Annual cost = financed capex + fixed O&M + (Li-ion only) stack augmentation,
 * divided by the energy actually delivered each year.
 */
function calcLcos(techKey, powerMW, durationHours, years) {
  const t = TECH[techKey]
  const energyMWh = powerMW * durationHours
  const capex = powerMW * 1000 * t.powerCapexPerKW + energyMWh * 1000 * t.energyCapexPerKWh
  const financeTerm = Math.min(years, t.lifeYears)
  const annualCapex = capex * crf(DISCOUNT_RATE, financeTerm)
  const annualOM = capex * t.fixedOMRate

  let annualAugmentation = 0
  let capacityFactor = 1
  if (techKey === 'lithium') {
    const augs = lithiumAugmentations(years)
    const energyCapex = energyMWh * 1000 * t.energyCapexPerKWh
    annualAugmentation = (augs * t.augmentationCostShare * energyCapex) / years
    capacityFactor = t.avgCapacityFactor
  }

  const annualDischargeMWh = CYCLES_PER_YEAR * energyMWh * t.rte * capacityFactor
  if (annualDischargeMWh <= 0) return 0
  return (annualCapex + annualOM + annualAugmentation) / annualDischargeMWh
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
    defaultSolarMW: 80,
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

function simulateDay(preset, windMW, solarMW, storagePowerMW, durationHours) {
  const oneWayEff = Math.sqrt(TECH.hdHydro.rte) // 83% RTE split across charge/discharge
  const energyCapMWh = storagePowerMW * durationHours

  const shapeAvg = preset.windShape.reduce((a, b) => a + b, 0) / 24
  const wind = HOURS.map(
    (h) => windMW * preset.windShape[h] * (preset.windCapacityFactor / shapeAvg),
  )
  const solar = HOURS.map((h) => solarMW * solarShape(h, preset.solarPeakShare))
  const gen = HOURS.map((h) => wind[h] + solar[h])
  const avgGen = gen.reduce((a, b) => a + b, 0) / 24

  let load
  if (preset.id === 'anglesey') {
    // Firm, flat export block — the product the offtaker is buying.
    // Target: the site's full average output, around the clock — so store
    // size and round-trip losses genuinely determine how firm the block is.
    load = HOURS.map(() => avgGen)
  } else {
    const peakMW = Math.max(avgGen * 1.05, storagePowerMW * 1.1)
    load = INDUSTRIAL_SHAPE.map((s) => s * peakMW)
  }

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
  const greenServed = day.reduce((a, r) => a + r.direct + r.discharge * greenShare, 0)
  const firmingFactor = totalLoad > 0 ? Math.min(100, (greenServed / totalLoad) * 100) : 0

  return { day, firmingFactor, avgGen, energyCapMWh }
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
  const [durationHours, setDurationHours] = useState(8)
  const [years, setYears] = useState(25)

  const preset = PRESETS[presetId]

  const selectPreset = (id) => {
    setPresetId(id)
    setWindMW(PRESETS[id].defaultWindMW)
    setSolarMW(PRESETS[id].defaultSolarMW)
  }

  // Storage sized to firm the generation mix (floor of 10 MW).
  const storagePowerMW = Math.max(10, Math.round((windMW + solarMW) * 0.35))
  const energyCapMWh = storagePowerMW * durationHours

  const sim = useMemo(
    () => simulateDay(preset, windMW, solarMW, storagePowerMW, durationHours),
    [preset, windMW, solarMW, storagePowerMW, durationHours],
  )

  const lcos = useMemo(
    () => ({
      hdHydro: calcLcos('hdHydro', storagePowerMW, durationHours, years),
      lithium: calcLcos('lithium', storagePowerMW, durationHours, years),
      convHydro: calcLcos('convHydro', storagePowerMW, durationHours, years),
    }),
    [storagePowerMW, durationHours, years],
  )

  const lcosCurve = useMemo(
    () =>
      [4, 6, 8, 10, 12, 14, 16].map((d) => ({
        duration: d,
        hdHydro: calcLcos('hdHydro', storagePowerMW, d, years),
        lithium: calcLcos('lithium', storagePowerMW, d, years),
        convHydro: calcLcos('convHydro', storagePowerMW, d, years),
      })),
    [storagePowerMW, years],
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
    TECH.lithium.energyCapexPerKWh
  const hdAdvantagePct =
    lcos.lithium > 0 ? ((lcos.lithium - lcos.hdHydro) / lcos.lithium) * 100 : 0

  const advice =
    durationHours <= 5
      ? {
          tone: 'neutral',
          title: 'Short-Duration Matching',
          body: 'Lithium-ion remains highly effective for immediate, rapid-frequency grid response. RheEnergise begins hitting parity.',
        }
      : durationHours <= 9
        ? {
            tone: 'positive',
            title: 'The LDES Pivot',
            body: 'RheEnergise HD Hydro eliminates the multi-million pound battery degradation liabilities, making it the perfect match for stable corporate PPAs.',
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
              83% Round-Trip Efficiency
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
                Three choices. Live economics on the right.
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

              {/* Generation mix */}
              <PanelTitle step="2" title="Your Generation Mix" />
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

              {/* Storage needs */}
              <PanelTitle step="3" title="Your Storage Needs" />
              <div className="space-y-5">
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
              </div>

              {/* Configured system summary */}
              <div className="mt-6 border border-slate-700 bg-[#0B1120] p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  <BatteryCharging size={13} aria-hidden="true" />
                  Your Configured Store
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div>
                    <div className="font-mono text-xl font-bold text-[#CCFF00]">
                      {fmtMW(storagePowerMW)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
                      Power Rating
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-xl font-bold text-[#CCFF00]">
                      {fmtMWh(energyCapMWh)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
                      Energy Stored
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
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
                  <p className="text-xs text-slate-500">{preset.loadDescription}</p>
                </div>
                <div className="border border-[#CCFF00] bg-[#CCFF00]/10 px-4 py-2 text-right">
                  <div className="rhe-glow font-mono text-2xl font-black leading-none text-[#CCFF00]">
                    {sim.firmingFactor.toFixed(0)}%
                  </div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                    Green Firming Factor
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
                      name="Contracted Load"
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
            </div>

            {/* ---- 2. Financial profile ---- */}
            <div className="border border-slate-800 bg-[#121824] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Levelized Cost of Storage (LCOS)
                  </h2>
                  <p className="text-xs text-slate-500">
                    £ per MWh delivered, across discharge durations, over your{' '}
                    {years}-year window
                  </p>
                </div>
                {hdAdvantagePct > 0 && (
                  <div className="border border-[#CCFF00]/50 bg-[#CCFF00]/10 px-3 py-1.5 text-xs font-bold text-[#CCFF00]">
                    HD Hydro {hdAdvantagePct.toFixed(0)}% below Lithium-ion at your design
                  </div>
                )}
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

            {/* ---- 3. Executive grid ---- */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Lifetime cash savings */}
              <div className="border border-slate-800 bg-[#121824] p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                  <PiggyBank size={14} className="text-[#CCFF00]" aria-hidden="true" />
                  Lifetime Cash Savings vs Lithium-ion
                </div>
                <div
                  className={`rhe-glow font-mono text-3xl font-black ${
                    lifetimeSavings >= 0 ? 'text-[#CCFF00]' : 'text-amber-500'
                  }`}
                >
                  {fmtMillions(lifetimeSavings)}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                  {lifetimeSavings >= 0
                    ? `Cumulative savings over your ${years}-year window by choosing HD Hydro.`
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
                    ? `Lithium-ion needs ${augmentations} battery stack replacement${
                        augmentations > 1 ? 's' : ''
                      } over ${years} years to keep delivering contract capacity.`
                    : 'Within ~10 years Li-ion avoids replacement — but degrades ~2% every year regardless.'}
                </p>
              </div>

              {/* Deployment feasibility */}
              <div className="border border-slate-800 bg-[#121824] p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">
                  <ShieldCheck size={14} className="text-[#CCFF00]" aria-hidden="true" />
                  Deployment Feasibility Score
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2 border border-[#CCFF00]/40 bg-[#CCFF00]/10 px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5 font-bold text-[#CCFF00]">
                      <Landmark size={13} aria-hidden="true" /> RheEnergise HD Hydro
                    </span>
                    <span className="font-mono font-bold text-[#CCFF00]">
                      Hill-Compatible · Low Risk
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 border border-slate-700 px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <Mountain size={13} aria-hidden="true" /> Conventional Hydro
                    </span>
                    <span className="font-mono text-slate-500">
                      Locked by Mountains · High Risk
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                  HD Hydro needs just 100&nbsp;m of vertical head — small North Wales
                  hillsides, not 300&nbsp;m+ mountain ranges.
                </p>
              </div>
            </div>

            {/* ---- 4. Strategic advice banner ---- */}
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
