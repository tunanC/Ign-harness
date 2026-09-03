import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════
   OrbThree — Siri-like glowing blobs inside a dark sphere.
   ═══════════════════════════════════════════════════════════════════ */

interface OrbThreeProps {
  size: number;
  hovered: boolean;
  listening?: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

interface Blob {
  mesh: THREE.Mesh;
  glows: THREE.Mesh[];
  phaseX: number;
  phaseY: number;
  phaseZ: number;
  phaseS: number;
  baseScale: number;
  rotSpeed: number;
}

function readBlobColors(): string[] {
  const style = getComputedStyle(document.documentElement);
  return [
    style.getPropertyValue('--blob-1').trim() || '#00e5ff',
    style.getPropertyValue('--blob-2').trim() || '#a855f7',
    style.getPropertyValue('--blob-3').trim() || '#ff6b9d',
    style.getPropertyValue('--blob-4').trim() || '#4d94ff',
  ];
}

function readBlobParams(): { opacity: number; halos: number[] } {
  const style = getComputedStyle(document.documentElement);
  const opacity = parseFloat(style.getPropertyValue('--blob-opacity').trim()) || 0.55;
  const halos = [
    parseFloat(style.getPropertyValue('--blob-halo-1').trim()) || 0.10,
    parseFloat(style.getPropertyValue('--blob-halo-2').trim()) || 0.05,
    parseFloat(style.getPropertyValue('--blob-halo-3').trim()) || 0.02,
  ];
  return { opacity, halos };
}

export function OrbThree({ size, hovered, listening, onClick, onMouseEnter, onMouseLeave }: OrbThreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobsRef = useRef<Blob[]>([]);
  const groupRef = useRef<THREE.Group | null>(null);
  const targetRotation = useRef(0);
  const currentRotation = useRef(0);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());

  // ── Scene setup ──────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = size;
    const h = size;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.pointerEvents = 'none';
    container.appendChild(renderer.domElement);

    // Camera
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.z = 2.2;

    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    // ── Glowing blobs — irregular shape + gradient via vertex colors ──
    const colorHex = readBlobColors();
    const { opacity: blobOpacity, halos: haloOpacities } = readBlobParams();
    const blobs: Blob[] = [];
    colorHex.forEach((hex, i) => {
      const color = new THREE.Color(hex);
      // Base sphere geometry
      const blobRadius = 0.22 + Math.random() * 0.25;
      const baseGeo = new THREE.SphereGeometry(blobRadius, 24, 18);

      // Displace vertices for irregular shape
      const positions = baseGeo.attributes.position;
      for (let j = 0; j < positions.count; j++) {
        const x = positions.getX(j);
        const y = positions.getY(j);
        const z = positions.getZ(j);
        const noise = 1.0 + (Math.random() - 0.5) * 0.6;
        positions.setXYZ(j, x * noise, y * noise, z * noise);
      }
      baseGeo.computeVertexNormals();

      // Vertex colors — vary around base color for gradient
      const count = positions.count;
      const colors = new Float32Array(count * 3);
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      for (let j = 0; j < count; j++) {
        const hueShift = (Math.random() - 0.5) * 0.08;
        const lightShift = (Math.random() - 0.5) * 0.2;
        const c = new THREE.Color();
        c.setHSL(
          (hsl.h + hueShift + 1) % 1,
          Math.max(0, Math.min(1, hsl.s + lightShift * 0.5)),
          Math.max(0.3, Math.min(0.9, hsl.l + lightShift)),
        );
        colors[j * 3] = c.r;
        colors[j * 3 + 1] = c.g;
        colors[j * 3 + 2] = c.b;
      }
      baseGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: blobOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(baseGeo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 0.6,
        0.05 + Math.random() * 0.15,
      );
      group.add(mesh);

      // Glow halos — multi-layer soft falloff
      const glows: THREE.Mesh[] = [];
      const glowSizes = [1.8, 3.0, 5.0];
      glowSizes.forEach((size, idx) => {
        const glowGeo = new THREE.SphereGeometry(blobRadius * size, 16, 12);
        const glowMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: haloOpacities[idx],
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const g = new THREE.Mesh(glowGeo, glowMat);
        g.position.copy(mesh.position);
        group.add(g);
        glows.push(g);
      });

      blobs.push({
        mesh,
        glows,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        phaseZ: Math.random() * Math.PI * 2,
        phaseS: Math.random() * Math.PI * 2,
        baseScale: 0.3 + Math.random() * 0.5,  // max geo radius 0.4 × max scale (0.8+0.3) = 0.44 < 0.46 ✓
        rotSpeed: 0.1 + Math.random() * 0.3,
      });
    });
    blobsRef.current = blobs;

    // ── Render loop ─────────────────────────────────────────────
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      const t = clockRef.current.getElapsedTime();
      const spd = speedRef.current;

      // Smooth rotation lerp (speed up when listening)
      currentRotation.current += (targetRotation.current - currentRotation.current) * (0.06 * spd);
      group.rotation.z = currentRotation.current;

      // Amplify oscillation when listening
      const scaleAmp = spd > 1 ? 0.45 : 0.2;
      const moveAmp = spd > 1 ? 0.008 : 0.002;

      // Animate blobs
      blobs.forEach((b) => {
        const s = b.baseScale + Math.sin(t * 0.8 * spd + b.phaseS) * scaleAmp;
        b.mesh.scale.setScalar(Math.max(0.15, s));
        b.mesh.rotation.x += 0.005 * b.rotSpeed * spd;
        b.mesh.rotation.y += 0.008 * b.rotSpeed * spd;
        b.mesh.position.x += Math.sin(t * 1.2 * spd + b.phaseX) * moveAmp;
        b.mesh.position.y += Math.cos(t * 1.1 * spd + b.phaseY) * moveAmp;
        // Glows follow
        b.glows.forEach((g) => {
          g.scale.copy(b.mesh.scale);
          g.position.copy(b.mesh.position);
        });
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [size]);

  // ── Hover → rotate + brighten ring ─────────────────────────────
  useEffect(() => {
    targetRotation.current = hovered || listening ? Math.PI / 2 : 0;
  }, [hovered, listening]);

  // ── Listening → speed up blob animation ─────────────────────────
  const speedRef = useRef(1);
  useEffect(() => {
    speedRef.current = listening ? 5 : 1;
  }, [listening]);

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        cursor: 'pointer',
        flexShrink: 0,
        pointerEvents: 'none',  // let parent wrapper handle all mouse events
      }}
    />
  );
}
