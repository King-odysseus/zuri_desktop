import { useEffect, useRef } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
} from 'three';

/**
 * A slowly turning wireframe globe of linked points: the "network" image the
 * landing page leads with. Drawn with three.js rather than a video so it stays
 * sharp at any width and costs one small canvas.
 *
 * Everything here is deliberately conservative:
 * - one static frame when the reader asked for reduced motion,
 * - no animation while the tab is hidden or the panel is off-screen,
 * - every geometry, material and the WebGL context disposed on unmount,
 * - a WebGL failure leaves the CSS gradient behind it untouched.
 */

const PALETTES = {
  dark: { point: '#a9b4ff', line: '#6a72ff', halo: '#7fe7ff' },
  light: { point: '#3478e5', line: '#5b8ee8', halo: '#1a9fd4' },
};

/** Points on a sphere with a slight jitter, so it reads organic, not geometric. */
function buildSphere(count, radius) {
  const points = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    // The jitter breaks the spiral pattern that a perfect fibonacci sphere shows.
    const jitter = 0.94 + Math.random() * 0.12;
    points[index * 3] = Math.cos(theta) * ring * radius * jitter;
    points[index * 3 + 1] = y * radius * jitter;
    points[index * 3 + 2] = Math.sin(theta) * ring * radius * jitter;
  }
  return points;
}

/** Lines between points that sit close enough to look connected. */
function buildLinks(points, maxDistance) {
  const segments = [];
  const limit = maxDistance * maxDistance;
  for (let a = 0; a < points.length; a += 3) {
    for (let b = a + 3; b < points.length; b += 3) {
      const dx = points[a] - points[b];
      const dy = points[a + 1] - points[b + 1];
      const dz = points[a + 2] - points[b + 2];
      if (dx * dx + dy * dy + dz * dz < limit) {
        segments.push(points[a], points[a + 1], points[a + 2], points[b], points[b + 1], points[b + 2]);
      }
    }
  }
  return new Float32Array(segments);
}

/** @param {{ theme?: 'dark' | 'light', className?: string }} props */
export default function ThreeScene({ theme = 'dark', className = '' }) {
  const host = useRef(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;

    const palette = PALETTES[theme] ?? PALETTES.dark;
    let renderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (error) {
      // No WebGL (blocked driver, headless browser): the gradient behind the
      // canvas is the whole visual, so there is nothing to report to the reader.
      console.warn('[zuri-cloud] 3D scene unavailable', error?.message ?? error);
      return undefined;
    }

    const width = element.clientWidth || 1;
    const height = element.clientHeight || 1;

    const scene = new Scene();
    const camera = new PerspectiveCamera(46, width / height, 0.1, 100);
    camera.position.z = 8.4;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.setClearAlpha(0);
    element.append(renderer.domElement);
    renderer.domElement.className = 'three-scene-canvas';

    const radius = 3.1;
    const sphere = buildSphere(240, radius);

    const pointGeometry = new BufferGeometry();
    pointGeometry.setAttribute('position', new Float32BufferAttribute(sphere, 3));
    const pointMaterial = new PointsMaterial({
      color: new Color(palette.point),
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const cloud = new Points(pointGeometry, pointMaterial);

    const linkGeometry = new BufferGeometry();
    linkGeometry.setAttribute('position', new Float32BufferAttribute(buildLinks(sphere, 1.05), 3));
    const linkMaterial = new LineBasicMaterial({
      color: new Color(palette.line),
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    const links = new LineSegments(linkGeometry, linkMaterial);

    const haloGeometry = new BufferGeometry();
    haloGeometry.setAttribute('position', new Float32BufferAttribute(buildSphere(90, radius * 1.22), 3));
    const haloMaterial = new PointsMaterial({
      color: new Color(palette.halo),
      size: 0.03,
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const halo = new Points(haloGeometry, haloMaterial);

    const globe = new Scene();
    globe.add(cloud, links, halo);
    globe.rotation.z = 0.32;
    scene.add(globe);

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    let frame = 0;
    let visible = true;

    const draw = (elapsed) => {
      // A fixed tilt with a slow spin: enough life to read as "live", slow
      // enough not to pull the eye off the headline.
      globe.rotation.y = elapsed * 0.00016;
      globe.rotation.x = Math.sin(elapsed * 0.00022) * 0.12 + 0.18;
      renderer.render(scene, camera);
    };

    const loop = (time) => {
      frame = window.requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      draw(time);
    };

    if (reduceMotion) {
      draw(0);
    } else {
      frame = window.requestAnimationFrame(loop);
    }

    const resize = () => {
      const nextWidth = element.clientWidth || 1;
      const nextHeight = element.clientHeight || 1;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight, false);
      if (reduceMotion) draw(0);
    };

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(element);

    const onVisibility = () => {
      if (!reduceMotion && !document.hidden) draw(performance.now());
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Off-screen is the normal state halfway down the page, so pausing there
    // keeps the page scroll smooth on a laptop.
    const intersection = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
        })
      : null;
    intersection?.observe(element);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      scene.remove(globe);
      globe.clear();
      pointGeometry.dispose();
      pointMaterial.dispose();
      linkGeometry.dispose();
      linkMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [theme]);

  return <div ref={host} className={`three-scene ${className}`.trim()} aria-hidden="true" />;
}
