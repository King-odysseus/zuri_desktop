import { Suspense, lazy } from 'react';

/**
 * The two animated layers behind the hero and the account screens.
 *
 * Both are split into their own chunks and loaded after the page paints:
 * three.js alone is far larger than the rest of this dashboard, and a reader
 * who never scrolls to the hero (or the signed-in shell) should not pay for it.
 * The panel already has a gradient and a photo, so a blank moment is invisible.
 */
const ThreeScene = lazy(() => import('./ThreeScene.jsx'));
const ParticleField = lazy(() => import('./ParticleField.jsx'));

const LAYERS = {
  hero: { scene: 'hero-scene', particles: 'hero-particles' },
  auth: { scene: 'auth-scene', particles: 'auth-particles' },
};

/** @param {{ theme?: 'dark' | 'light', variant?: 'hero' | 'auth' }} props */
export default function HeroBackdrop({ theme = 'dark', variant = 'hero' }) {
  const layers = LAYERS[variant] ?? LAYERS.hero;
  return (
    <Suspense fallback={null}>
      <ThreeScene theme={theme} className={layers.scene} />
      <ParticleField variant={variant} className={layers.particles} />
    </Suspense>
  );
}
