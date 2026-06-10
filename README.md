# RheEnergise HD Hydro — Client-Facing Firming & LCOS Calculator

An interactive, single-page pitch tool for presenting RheEnergise High-Density
Hydro (HD Hydro) to IPP developers, corporate offtakers and utility buyers.
It turns storage physics into clear economic arguments: a 24-hour firming
simulation, a live Levelized Cost of Storage (LCOS) comparison against
Lithium-ion BESS and conventional pumped hydro, and an executive metrics grid.

## Features

- **Two North Wales presets** — Anglesey Co-located Hub (coastal wind & solar,
  firm green export) and Deeside Industrial Firming (grid-connected factory
  load with off-peak arbitrage).
- **24-Hour Firming Look** — an hourly steady-state simulation of generation,
  contracted load and the HD Hydro store catching excess / deploying through
  deficits, summarised by a Green Firming Factor (%).
- **Financial Profile** — LCOS (£/MWh) plotted across 4–16 hour discharge
  durations for HD Hydro, Lithium-ion and conventional hydro, recomputed live
  as the evaluation window changes (Li-ion stack augmentation every ~11 years
  and 2%/yr degradation are modelled explicitly).
- **Executive grid** — lifetime cash savings, 60% footprint reduction, future
  re-investment liability (£0 for HD Hydro) and deployment feasibility.
- **Strategic advice banner** that adapts to the selected discharge duration.

## Stack

React 19 + Vite, Tailwind CSS v4, Recharts, Lucide icons. Fully
self-contained — no API calls.

## Run it

```bash
npm install
npm run dev      # local development
npm run build    # production build to dist/
npm run preview  # serve the production build
```

All modelling assumptions (capex, O&M, efficiency, degradation, augmentation)
live in `src/components/FirmingCalculator.jsx` as transparent linear constants.
Figures are indicative, for commercial discussion only.
