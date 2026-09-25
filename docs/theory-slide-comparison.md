# THEORY compared with Clarke’s September 2026 geocorona slides

Reviewed September 25, 2026 against `Carr-Geocorona_sim_24sep2026.pptx`
(nine slides), its embedded plots and equations, and the accompanying
`ballistic.pro` and `ballisticnr.pro`. These supplied files are in
`code and data/ballistic model` beside the application checkout.
The implementation reviewed is `lib/theory.ts`, model `spherical-h-flux-1.0`.
Its mathematics and constants were left unchanged.

The models share inverse-square Earth gravity and agree closely for slow,
vertical trajectories. They are not numerically or statistically equivalent
in every case: the slides show bulk Maxwell speed distributions and vertical
trajectories; THEORY integrates a continuous outward particle flux into a
steady spherical density field and normally retains angular momentum.

## Gravity and trajectory geometry

Slide 4 gives `v_escape = sqrt(2 GM / r) = sqrt(2 g(r) r)`, consistent with
THEORY. Distance `r` must be from Earth’s center. With THEORY’s Earth radius
6,370 km and GM = 398,600.4418 km³/s², escape speed is **10.772 km/s at
500 km altitude** and **10.400 km/s at 1,000 km altitude**. Slide 3’s
11.3 km/s at 500 km is not consistent with these constants and its stated
escape-speed equation.

The supplied IDL routines calculate `v_z = v cos(theta)`, then evolve only
the vertical coordinate. They calculate `v_x` but never use it in the motion.
THEORY’s default cosine mode instead retains specific energy
`epsilon = v²/2 - GM/r0` and angular momentum `h = r0 v sin(theta)`:

```
v_r²(r) = 2 epsilon + 2 GM/r - h²/r²
```

For an oblique trajectory, discarding transverse speed changes the model.
In the full central-force model the sign of total energy determines escape;
the initial vertical component alone does not. The UI’s radial-only option
sets theta = 0, providing the relevant vertical comparison.

Slides 6–8 plot altitude above Earth’s surface. THEORY’s spatial axes and
density profile use radius from Earth’s center. Thus `r/R_E = 1 + z/R_E`;
the distinction also applies to slide 8’s altitude in Earth radii.

## Numerical comparison of the supplied trajectories

For a vertical launch, the independent energy solution is
`r_max = 1 / (1/r0 - v0²/(2 GM))`, with altitude `z_max = r_max - R_E`.
The IDL column below reproduces its float32 update order, fixed 800 steps,
surface gravity 0.0098 km/s², and speed-dependent timestep multipliers.
Small differences at low speeds also include its slightly different GM
(`0.0098 × 6370² = 397653.62 km³/s²`).

| Source altitude | Vertical speed | Exact peak altitude, THEORY constants | Supplied IDL peak altitude |
| --- | --- | --- | --- |
| 500 km | 2 km/s | 745.27 km | 745.00 km |
| 500 km | 4 km/s | 1,598.75 km | 1,596.52 km |
| 1,000 km | 4 km/s | 2,279.40 km | 2,277.58 km |
| 500 km | 7 km/s | 5,521.26 km | 5,480.36 km |
| 500 km | 10 km/s | **43,328.06 km** | **27,576.32 km** |

At 10 km/s the IDL timestep is approximately **88.56 seconds**. Its code
explicitly warns that the output at this speed is inaccurate because of the
limited steps. Its peak, 4.329 Earth radii of altitude, matches the approximate
4.3 shown on slide 8. The exact result is 6.802 Earth radii of altitude, or
7.802 Earth radii from the center. The exact round trip to the source shell
is approximately 10.58 hours. A large discrepancy is expected this close to
escape; the stepwise result should not be used to retune the exact model.

## Bulk atom fractions versus outward-flux fractions

Slides 3 and 5 describe the bulk Maxwell–Boltzmann speed distribution,
`f(v) proportional to v² exp(-m_H v²/(2 k_B T))`. THEORY specifies the
number crossing a source surface per unit area and time, so faster atoms
receive an additional speed weight. Its speed law is
`p(s) = s exp(-s)`, where `s = m_H v²/(2 k_B T)`; its cosine directions
have `p(mu) = 2 mu`, with `mu = cos(theta)`.

These describe different populations sampled from the same thermal gas.
The surface-crossing weighting is also documented in the
[CERN Molflow algorithm reference](https://molflow.docs.cern.ch/guide/molflow/general/attachments/molflow_algorithm.pdf).
It does not mean the flux fraction should equal the fraction of atoms in
the bulk distribution.

For `lambda = GM m_H/(r0 k_B T)`, the two upper tails are:

```
bulk fraction above escape speed = erfc(sqrt(lambda)) + 2 sqrt(lambda/pi) exp(-lambda)
fraction of outward flux escaping = (1 + lambda) exp(-lambda)
```

| Source condition | Bulk speed tail | Escaping outward flux |
| --- | --- | --- |
| 1,000 K, 500 km | 0.2817% | 0.7088% |
| 2,000 K, 1,000 km | 8.7487% | 16.1306% |

These numbers use THEORY’s constants and hydrogen mass; the slide plot labels
use 1 amu. That small mass difference does not remove the weighting distinction.
For a single thermal component matching the slide’s quiet/storm cases, set
hot launch fraction to zero, cold temperature to 1,000/2,000 K and source
altitude to 500/1,000 km. The default THEORY model instead includes a 10%
hot flux component at 6,000 K, so its default escape percentage is a mixture.

## What this comparison establishes

THEORY’s density is computed from the residence-time integral
`n(r) = F (r0/r)² <passes/v_r(r)>`, with two passages for returning bound
orbits and one for escaping orbits. It sums two assumed source components;
the slide deck does not provide this full density construction.

Both approaches are useful for understanding ballistic motion. The current
THEORY model does not reproduce the deck’s time-dependent storm scenario,
Lyman-alpha emission, a moving brightness maximum, charge exchange, ionization
losses, or radiation-belt evolution. A brightness comparison also requires
radiative transfer; the existing
[Qin–Waldrop paper](https://www.nature.com/articles/ncomms13655) uses remote
sensing and radiative-transfer inversion, which this exploratory model does
not implement.
