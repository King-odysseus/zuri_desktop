import { useEffect, useMemo } from 'react';
import { tsParticles } from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';

/**
 * Drifting particles behind a panel, so the page reads as a live product
 * surface rather than a flat poster.
 *
 * The engine is loaded once for the whole app: `loadSlim` registers the
 * plugin set into the shared `tsParticles` singleton, and calling it per mount
 * would re-register every plugin on each navigation.
 */
let engineReady = null;

function ensureEngine() {
  if (engineReady === null) {
    engineReady = loadSlim(tsParticles).catch((error) => {
      // A failed load must not leave the page waiting forever; the surface
      // behind the canvas already looks finished on its own.
      engineReady = null;
      throw error;
    });
  }
  return engineReady;
}

// Two densities: the hero is seen at full size, the auth aside is a narrow
// column where the same count would look crowded.
const PRESETS = {
  hero: { count: 70, linkDistance: 130, size: 1.6, speed: 0.35 },
  auth: { count: 38, linkDistance: 110, size: 1.4, speed: 0.28 },
};

/** @param {{ variant?: 'hero' | 'auth', className?: string }} props */
export default function ParticleField({ variant = 'hero', className = '' }) {
  const id = `zuri-particles-${variant}`;
  const options = useMemo(() => {
    const preset = PRESETS[variant] ?? PRESETS.hero;
    return {
      fullScreen: { enable: false },
      detectRetina: true,
      // The canvas sits behind text, so nothing here may swallow a click.
      interactivity: { events: { onHover: { enable: false }, onClick: { enable: false }, resize: { enable: true } } },
      particles: {
        number: { value: preset.count, density: { enable: true } },
        color: { value: ['#a9b4ff', '#6a72ff', '#7fe7ff'] },
        links: {
          enable: true,
          color: '#8f9bff',
          distance: preset.linkDistance,
          opacity: 0.28,
          width: 1,
        },
        move: { enable: true, speed: preset.speed, direction: 'none', outModes: { default: 'out' } },
        opacity: { value: { min: 0.15, max: 0.6 }, animation: { enable: true, speed: 0.6, sync: false } },
        size: { value: { min: 0.6, max: preset.size } },
      },
      responsive: [
        {
          // Phones get a sparser field: the canvas is small and the motion
          // competes with scrolling.
          maxWidth: 640,
          options: { particles: { number: { value: Math.round(preset.count / 2) }, links: { distance: preset.linkDistance - 30 } } },
        },
      ],
    };
  }, [variant]);

  useEffect(() => {
    let container;
    let cancelled = false;

    (async () => {
      try {
        await ensureEngine();
        if (cancelled) return;
        const loaded = await tsParticles.load({ id, options });
        // The element can unmount while the engine is still starting; a
        // container left behind would keep animating off-screen.
        if (cancelled) {
          loaded?.destroy();
          return;
        }
        container = loaded;
      } catch (error) {
        console.warn('[zuri-cloud] particle background unavailable', error?.message ?? error);
      }
    })();

    return () => {
      cancelled = true;
      container?.destroy();
    };
  }, [id, options]);

  return <div id={id} className={`particle-field ${className}`.trim()} aria-hidden="true" />;
}
