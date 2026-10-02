'use client';
import type { ModelChoice } from '@/lib/model-overlay';

export function ModelOverlayControls({
  model,
  setModel,
  opacity,
  setOpacity,
  irradiance,
  setIrradiance,
}: {
  model: ModelChoice;
  setModel: (value: ModelChoice) => void;
  opacity: number;
  setOpacity: (value: number) => void;
  irradiance: number;
  setIrradiance: (value: number) => void;
}) {
  return (
    <section className="model-controls" aria-labelledby="model-overlay-heading">
      <h3 id="model-overlay-heading">
        <span className="model-swatch" />
        Zoennchen overlay
      </h3>
      <label>
        Density model
        <select
          aria-label="Zoennchen density model"
          value={model}
          onChange={(e) => setModel(e.target.value as ModelChoice)}
        >
          <option value="off">Off</option>
          <option value="Z15MAX">2015 · solar maximum</option>
          <option value="Z15MIN">2015 · solar minimum</option>
        </select>
      </label>
      {model !== 'off' && (
        <>
          <label>
            Opacity <output>{Math.round(opacity * 100)}%</output>
            <input
              aria-label="Model contour opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>
          <label>
            Solar Lyα · mW/m²
            <input
              aria-label="Model solar Lyman-alpha irradiance"
              type="number"
              min="1"
              max="15"
              step="0.1"
              defaultValue={irradiance}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              onBlur={(e) => {
                const value = Number(e.currentTarget.value);
                if (Number.isFinite(value) && value >= 1 && value <= 15)
                  setIrradiance(Math.round(value * 1000) / 1000);
                else e.currentTarget.value = String(irradiance);
              }}
            />
          </label>
          <p>
            3–8 Rᴇ shell contribution · kR. Fixed reference illumination; adjust
            to the observation’s daily irradiance.
          </p>
          <details>
            <summary>Model scope &amp; sources</summary>
            <p>
              Dashed cyan contours are a single-scattering reference in the 2D
              image view. They include only hydrogen between 3 and 8 Earth
              radii; sightlines passing inside 3 Rᴇ are omitted.
            </p>
            <p>
              Solar maximum uses TWINS 2012 densities; minimum uses 2008/2010.
              These are not fits to the selected Carruthers observation. Earth’s
              geometric shadow is included; absorption, multiple scattering,
              albedo, interplanetary background and camera blur are omitted.
              This is not total predicted brightness.
            </p>
            <p>
              <a
                href="https://angeo.copernicus.org/articles/33/413/2015/"
                target="_blank"
                rel="noreferrer"
              >
                Zoennchen et al. (2015)
              </a>{' '}
              ·{' '}
              <a
                href="https://www.frontiersin.org/journals/astronomy-and-space-sciences/articles/10.3389/fspas.2023.1082150/full"
                target="_blank"
                rel="noreferrer"
              >
                EXOSpy method
              </a>
            </p>
          </details>
        </>
      )}
    </section>
  );
}
