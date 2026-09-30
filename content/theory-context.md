### Overall idea

Hydrogen atoms are supplied continuously and uniformly across a spherical source shell representing the exobase. The upward flux $F$ specifies how many atoms are launched per unit area per second. Each atom has a total launch speed and a launch direction.

At a given radius $r$, the model determines which launch conditions produce trajectories that reach that spherical shell and how quickly those atoms move through it. Escaping atoms contribute one outward passage. Ballistic atoms that reach the shell contribute an outward and a returning passage. Atoms that turn around before reaching the shell contribute zero there.

The number density follows from the supply of atoms multiplied by the time they spend in the shell, divided by the shell volume. The model averages over a continuous distribution of launch conditions. It combines analytic reduction with numerical integration, rather than launching and tracking individual atoms through time.

### Source and physical assumptions

The source radius is prescribed as

$$
r_0=R_E+h_0,
$$

where $R_E=6370\ \mathrm{km}$ is Earth's radius and $h_0$ is the selected launch altitude. The model does not calculate the physical exobase location from atmospheric conditions. Both $r_0$ and $r$ are measured from Earth's center.

- The source is stationary and spherically symmetric. Its cold and hot components have prescribed temperatures and fractions of the outward launch flux.
- Each component uses a flux-weighted Maxwell launch-speed distribution. This is a source assumption; it does not require the hydrogen distribution at every altitude to remain Maxwellian.
- Atoms move under Earth's inverse-square gravity, conserving energy and angular momentum. Collisions, ionization, charge exchange, and solar radiation pressure are omitted.
- Returning atoms are absorbed at the source shell. There is no finite source age or particle lifetime, so returning passages are included even for trajectories whose apogees lie beyond the plotted domain.
- There is no independently trapped satellite population whose orbits never intersect the source shell. The region inside the source shell is not modeled.

### Number density and residence time

Conceptually, partition the launch conditions into small speed–angle bins. Using one representative trajectory per bin gives the approximation

$$
n(r)\approx F\left(\frac{r_0}{r}\right)^2
\left[
\underbrace{\sum_{i\in\mathcal E}\frac{w_i}{|v_{r,i}(r)|}}_{P=1:\ \text{escaping}}
+
\underbrace{2\sum_{i\in\mathcal B(r)}\frac{w_i}{|v_{r,i}(r)|}}_{P=2:\ \text{ballistic}}
\right].
$$

The exact continuous model is given by the integrals below; the finite-bin sum is an explanatory approximation.

- **$F$** is the total outward launch flux, in atoms/cm²/s, summed over both temperature components.
- **$w_i$** is the fraction of all launched atoms assigned to bin $i$. The weights sum to one over a partition of the full launch distribution.
- **$\mathcal E$** is the set of escaping launch conditions. This is a calligraphic capital E, distinct from the energy symbol $\varepsilon$.
- **$\mathcal B(r)$** is the set of ballistic launch conditions that reach radius $r$.
- **$|v_{r,i}(r)|$** is the magnitude of the radial velocity of trajectory $i$ at radius $r$.
- **$P$** counts passages: one for an escaping trajectory, two for a ballistic trajectory that reaches the shell, and zero for a trajectory that cannot reach it.

The geometric factor is a ratio of spherical surface areas:

$$
\left(\frac{r_0}{r}\right)^2
=\frac{4\pi r_0^2}{4\pi r^2}
=\frac{\text{area of the launch shell}}{\text{area of the shell at }r}.
$$

The factor $1/|v_{r,i}(r)|$ is time per unit radial distance. A passage through a thin shell of thickness $dr$ takes

$$
dt=\frac{dr}{|v_{r,i}(r)|}.
$$

Slower radial motion therefore produces a larger residence-time contribution. The total launch rate is $4\pi r_0^2F$, and the thin-shell volume is $4\pi r^2dr$. Multiplying the launch rate by the launch-weighted residence time and dividing by this volume produces the density equation.

**Units:** with $F$ in atoms/cm²/s and $n(r)$ in atoms/cm³, the radial speed in the displayed density equation must be in cm/s. The code calculates speeds in km/s and divides the resulting inverse-speed coefficients by $10^5$ to make this conversion. All lengths, speeds, and gravitational constants used together in an equation must have consistent units.

### Radial velocity and changing gravity

Energy and angular-momentum conservation give

$$
|v_{r,i}(r)|
=
\sqrt{
v_{0,i}^{\,2}
-
2GM\left(\frac{1}{r_0}-\frac{1}{r}\right)
-
\left(\frac{r_0v_{0,i}\sin\theta_i}{r}\right)^2
}.
$$

- **$v_{0,i}$** is the total launch speed, including radial and tangential motion.
- **$\theta_i$** is the launch angle measured from the outward radial direction.
- **$GM$** is Earth's gravitational parameter, $398600.4418\ \mathrm{km^3\,s^{-2}}$ when distances and speeds are expressed in km and km/s.

The gravitational term accounts for the change in potential from $r_0$ to $r$; gravity is not held constant. The final term accounts for tangential motion through conserved specific angular momentum:

$$
\ell_i=r_0v_{0,i}\sin\theta_i.
$$

The signed radial velocity is positive on an outward passage and negative on an inward passage. The density calculation uses its magnitude. If the expression inside the square root is negative, that trajectory cannot reach the specified radius. At a turning point, the radial speed vanishes; the residence-time integral is understood as an improper integral, with the turning-point behavior handled by the analytic reduction used in the code.

For an outward launch, the specific energy determines escape:

$$
\varepsilon_i=\frac{v_{0,i}^2}{2}-\frac{GM}{r_0}.
$$

Trajectories with $\varepsilon_i\geq0$ escape. Those with $\varepsilon_i<0$ are bound and contribute to $\mathcal B(r)$ only if they reach that radius before returning.

### Launch speeds, angles, and probability weights

For one component at temperature $T$, the probability density of total launch speed is the flux-weighted Maxwell distribution:

$$
p(v;T)=\frac{v^3}{2\sigma^4}
\exp\left(-\frac{v^2}{2\sigma^2}\right),
\qquad
\sigma^2=\frac{k_BT}{m_H},
\qquad v\geq0.
$$

Here $k_B$ is Boltzmann's constant and $m_H$ is the mass of a hydrogen atom. Throughout the launch integrals, $v$ means the **total speed at the source**, not the radial speed at the observation shell.

The ordinary Maxwell speed distribution for atoms occupying a volume is proportional to $v^2\exp[-v^2/(2\sigma^2)]$. Counting outward surface crossings adds a factor of $v$: faster atoms cross more frequently. The resulting distribution above is normalized over all nonnegative launch speeds. It is an assumed source distribution, not one inferred from Carruthers measurements.

In the default cosine-law mode, the launch-angle probability density is

$$
p(\theta)=2\sin\theta\cos\theta,
\qquad 0\leq\theta\leq\frac{\pi}{2}.
$$

Angles are measured from outward radial and integrated in radians. Azimuth around the local radial direction is uniform and has already been integrated out. This surface-crossing law is not uniform in solid angle, even though the underlying thermal source is isotropic. Equivalently, the code uses $\mu=\cos\theta$ with $p(\mu)=2\mu$ for $0\leq\mu\leq1$.

For one temperature component, speed and direction are independent. The probability of a finite speed–angle bin is therefore

$$
w_i(T)=
\underbrace{\int_{v_1}^{v_2}p(v;T)\,dv}_{\text{probability of this speed range}}
\;\times\;
\underbrace{\int_{\theta_1}^{\theta_2}2\sin\theta\cos\theta\,d\theta}_{\text{probability of this angle range}}.
$$

Each bin is a conceptual range of possible launch conditions, not a physical clump of hydrogen. Smaller bins have smaller weights. A single exact speed–angle pair has zero probability under this continuous law; finite ranges have finite probability.

The continuous counterpart of these weights is the joint probability density

$$
p_{\mathrm{launch}}(v,\theta;T)
=
\underbrace{p(v;T)}_{\text{speed probability density}}
\;\times\;
\underbrace{2\sin\theta\cos\theta}_{\text{angle probability density}}.
$$

Lowercase $p_{\mathrm{launch}}$ supplies the launch-probability weighting. Capital $P$ is the passage count.

### Combining the cold and hot source components

Let $T_c$ and $T_h$ be the cold and hot temperatures, and let $f_h$ be the hot fraction of the **outgoing launch flux**. The component fluxes are

$$
F_c=(1-f_h)F,
\qquad
F_h=f_hF.
$$

The combined bin weights and joint launch distribution are

$$
w_i=(1-f_h)w_i(T_c)+f_hw_i(T_h),
$$

$$
p_{\mathrm{launch}}(v,\theta)
=
\left[(1-f_h)p(v;T_c)+f_hp(v;T_h)\right]
2\sin\theta\cos\theta.
$$

This mixture is the $p_{\mathrm{launch}}$ used in the total-density integrals below. It is normalized over the full launch domain:

$$
\int_0^\infty\int_0^{\pi/2}
p_{\mathrm{launch}}(v,\theta)\,d\theta\,dv=1.
$$

The code equivalently calculates the density of each temperature component using its own flux, then adds the two densities. The hot launch fraction need not equal the hot fraction of the density at a particular radius because the components have different trajectories and residence times.

**Radial-only mode:** all atoms launch at $\theta=0$. The speed laws and cold/hot flux mixture remain the same, but the angular integral collapses to evaluating the integrand at zero angle. The continuous cosine-angle formulas above describe the default mode only.

### The continuum density integral

Let $\mathcal D(r)=\mathcal E\cup\mathcal B(r)$ be the launch conditions that reach the shell at radius $r$. On this domain, $P(v,\theta;r)$ is one for escaping trajectories and two for ballistic trajectories. The continuous density model is

$$
n(r)=F\left(\frac{r_0}{r}\right)^2
\iint_{\mathcal D(r)}
p_{\mathrm{launch}}(v,\theta)
\frac{P(v,\theta;r)}{|v_r(r;v,\theta)|}
\,dv\,d\theta.
$$

Equivalently, separating the two contributions gives

$$
n(r)=F\left(\frac{r_0}{r}\right)^2
\left[
\underbrace{\iint_{\mathcal E}
\frac{p_{\mathrm{launch}}(v,\theta)}{|v_r(r;v,\theta)|}
\,dv\,d\theta}_{\text{one outward passage}}
+
\underbrace{2\iint_{\mathcal B(r)}
\frac{p_{\mathrm{launch}}(v,\theta)}{|v_r(r;v,\theta)|}
\,dv\,d\theta}_{\text{outward and returning passages}}
\right].
$$

Launch conditions outside $\mathcal D(r)$ contribute zero. The launch probability density retains its original normalization over **all** launched atoms; it is not renormalized to count only those that reach the shell.

### Numerical evaluation

The code does not directly sum infinitely many trajectories or integrate over a two-dimensional grid of launch conditions. The speed–angle integrals are reduced analytically to combinations of one-dimensional Gaussian moments:

$$
I_0(x)=\int_0^{\sqrt{x}}e^{-t^2}\,dt,
\qquad
I_2(x)=\int_0^{\sqrt{x}}t^2e^{-t^2}\,dt.
$$

Here $t$ is a dimensionless integration variable, and $x$ is a dimensionless bound determined by the radius and source parameters; it is not a spatial coordinate in the image.

The `moments()` function in `lib/theory.ts` evaluates these integrals using 32-point Gauss–Legendre quadrature. These points and their numerical integration weights are not physical hydrogen populations. For sufficiently large arguments, the implementation uses the limiting values $I_0(\infty)=\sqrt{\pi}/2$ and $I_2(\infty)=\sqrt{\pi}/4$.

The results enter the reduced formulas for outward and returning density. The bound contribution is twice the returning contribution; the escaping contribution is the outward contribution minus the returning contribution. Thus, the calculation combines analytic reduction with numerical integration.

### Escaping and returning fractions

For one temperature component, define

$$
s=\frac{m_Hv^2}{2k_BT},
\qquad
\lambda(T)=\frac{GMm_H}{r_0k_BT}.
$$

The launch-speed law becomes $p(s)=s\exp(-s)$. Escape requires $s\geq\lambda$, so the escaping fraction of that component's launch flux is

$$
f_{\mathrm{esc}}(T)
=\int_{\lambda(T)}^\infty s\exp(-s)\,ds
=\left[1+\lambda(T)\right]\exp[-\lambda(T)].
$$

For the two-component source, the values shown in the interface are

$$
f_{\mathrm{esc,total}}
=(1-f_h)f_{\mathrm{esc}}(T_c)+f_hf_{\mathrm{esc}}(T_h),
\qquad
f_{\mathrm{return,total}}=1-f_{\mathrm{esc,total}}.
$$

These describe the eventual fate of the outgoing launch flux, not the fractions of atoms occupying a particular shell at an instant. The return fraction includes atoms that turn around below a selected radius as well as those that reach it.

### From number density to the displayed image

The density depends only on distance from Earth's center. Each pixel in the density slice is assigned a radius from its position in the cross-section, and the corresponding density is obtained from the radial profile. A logarithmic color scale maps density to color. Adjusting the color limits changes the display without changing the calculated density.

The image represents **local hydrogen density in atoms/cm³**. It does not integrate along the line of sight or calculate Lyman-alpha scattering brightness, and the model parameters are not fitted to observations. The separate example-trajectory view draws selected Kepler trajectories; those displayed paths are not used to build the density image.

### Derivation: from a weighted sum to an integral

Divide the reachable launch-condition region into small bins. For a bin of widths $\Delta v_i$ and $\Delta\theta_i$, with representative launch conditions $(v_i,\theta_i)$,

$$
w_i
=\iint_{\text{bin }i}p_{\mathrm{launch}}(v,\theta)\,dv\,d\theta
\approx
p_{\mathrm{launch}}(v_i,\theta_i)\,\Delta v_i\,\Delta\theta_i.
$$

This is probability density multiplied by bin area. Substituting into the weighted residence-time sum gives

$$
\sum_i w_i\frac{P_i}{|v_{r,i}(r)|}
\approx
\sum_i
p_{\mathrm{launch}}(v_i,\theta_i)
\frac{P(v_i,\theta_i;r)}{|v_r(r;v_i,\theta_i)|}
\,\Delta v_i\,\Delta\theta_i.
$$

Each term represents the contribution of a small rectangle in speed–angle space. With the turning-point boundaries interpreted in the improper-integral sense, refining these bins gives the continuum limit:

$$
\lim_{\max_i\Delta v_i,\;\max_i\Delta\theta_i\to0}
\sum_i
p_{\mathrm{launch}}(v_i,\theta_i)
\frac{P(v_i,\theta_i;r)}{|v_r(r;v_i,\theta_i)|}
\,\Delta v_i\,\Delta\theta_i
=
\iint_{\mathcal D(r)}
p_{\mathrm{launch}}(v,\theta)
\frac{P(v,\theta;r)}{|v_r(r;v,\theta)|}
\,dv\,d\theta.
$$

The integral accounts for a continuous range of possible launch conditions. Its numerical evaluation uses the reduced Gaussian moments described above.
