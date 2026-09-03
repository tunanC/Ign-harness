import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════
   OrbDockPeek — Half-head peeking from screen edge.
   Glasses-theme semi-sphere + goddess anime eyes in neon line-art.

   Head orientation (left-docked):
     Normal head → rotate 90° CW around Z.
     Top of head → +X (faceDir).  Left eye → upper, right eye → lower.
     Inner corners face the midline between eyes.
   ═══════════════════════════════════════════════════════════════════ */

interface OrbDockPeekProps {
  size: number;
  side: 'left' | 'right';
  onClick: () => void;
}

function readThemeColor(varName: string, fallback: string): THREE.Color {
  const style = getComputedStyle(document.documentElement);
  const hex = style.getPropertyValue(varName).trim() || fallback;
  return new THREE.Color(hex);
}

/* ── Goddess anime eye shape ──────────────────────────────────── */

function createGoddessEyeShape(hw: number, hh: number): {
  outline: THREE.Shape;
  upperLash: THREE.Shape;
  lowerLash: THREE.Shape;
} {
  // Full eye contour — elegant almond, long axis = X in local space
  const outline = new THREE.Shape();
  outline.moveTo(-hw, 0);
  outline.bezierCurveTo(-hw, -hh * 1.3, -hw * 0.15, -hh * 1.7, hw * 0.15, -hh * 1.45);
  outline.bezierCurveTo(hw * 0.55, -hh * 1.15, hw * 0.88, -hh * 0.35, hw, 0);
  outline.bezierCurveTo(hw * 0.82, hh * 0.55, hw * 0.35, hh * 0.95, 0, hh * 0.65);
  outline.bezierCurveTo(-hw * 0.3, hh * 0.75, -hw * 0.85, hh * 0.25, -hw, 0);

  // Thick upper lash (local +Y side = top of eye = faceDir after rotation)
  const upperLash = new THREE.Shape();
  upperLash.moveTo(-hw * 0.98, hh * 0.02);
  upperLash.bezierCurveTo(-hw * 0.98, -hh * 1.2, -hw * 0.15, -hh * 1.6, hw * 0.15, -hh * 1.38);
  upperLash.bezierCurveTo(hw * 0.55, -hh * 1.1, hw * 0.88, -hh * 0.3, hw * 0.98, hh * 0.02);
  upperLash.bezierCurveTo(hw * 0.85, -hh * 0.4, hw * 0.5, -hh * 1.2, hw * 0.12, -hh * 1.5);
  upperLash.bezierCurveTo(-hw * 0.15, -hh * 1.75, -hw * 0.95, -hh * 1.3, -hw * 0.98, hh * 0.02);

  // Subtle lower lash (local -Y side)
  const lowerLash = new THREE.Shape();
  lowerLash.moveTo(-hw * 0.9, -hh * 0.02);
  lowerLash.bezierCurveTo(-hw * 0.85, hh * 0.18, -hw * 0.3, hh * 0.68, 0, hh * 0.58);
  lowerLash.bezierCurveTo(hw * 0.35, hh * 0.88, hw * 0.82, hh * 0.48, hw * 0.92, -hh * 0.02);
  lowerLash.bezierCurveTo(hw * 0.8, hh * 0.35, hw * 0.3, hh * 0.72, 0, hh * 0.5);
  lowerLash.bezierCurveTo(-hw * 0.28, hh * 0.55, -hw * 0.8, hh * 0.12, -hw * 0.9, -hh * 0.02);

  return { outline, upperLash, lowerLash };
}

/* ── Eye parts ────────────────────────────────────────────────── */

interface EyeParts {
  irisGroup: THREE.Group;
  eyelid: THREE.Group;
}

/* ── Blink state ──────────────────────────────────────────────── */

interface BlinkState {
  phase: 'idle' | 'closing' | 'closed' | 'opening';
  timer: number;
  nextBlink: number;
  value: number;
}

const BLINK_SPEED = 0.10;
const CLOSED_PAUSE = 0.05;

/* ═══════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════ */

export function OrbDockPeek({ size, side, onClick }: OrbDockPeekProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.pointerEvents = 'none';
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    camera.position.z = 1.7;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.PointLight(0xffffff, 0.7, 5);
    key.position.set(0.5, 0.3, 2.0);
    scene.add(key);

    const accentColor = readThemeColor('--accent', '#00e5ff');
    const irisColorL = readThemeColor('--blob-1', '#00e5ff');
    const irisColorR = readThemeColor('--blob-2', '#a855f7');

    // ── Head ────────────────────────────────────────────────────
    const HEAD_R = 0.65;
    const headGeo = new THREE.SphereGeometry(HEAD_R, 48, 48);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a1e, roughness: 0.18, metalness: 0.25,
      transparent: true, opacity: 0.55,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    scene.add(head);

    const innerGeo = new THREE.SphereGeometry(HEAD_R - 0.04, 32, 32);
    const innerMat = new THREE.MeshBasicMaterial({
      color: accentColor, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    scene.add(new THREE.Mesh(innerGeo, innerMat));

    // ── Eyes ────────────────────────────────────────────────────
    // Head facing camera, upper hemisphere visible. Eyes horizontal, L-R symmetric.
    const EYE_HW = 0.095;
    const EYE_HH = 0.052;
    const eyeY = HEAD_R * 0.35;  // eyes in upper hemisphere
    const eyeGapX = 0.10;
    const eyeDefs = [
      { x: -eyeGapX, color: irisColorL, flipX: true  },  // left eye
      { x:  eyeGapX, color: irisColorR, flipX: false },  // right eye
    ];
    const eyes: EyeParts[] = [];
    const LID_W = 0.22;  // eyelid width (along X, sliding direction = toward nose)
    const LID_H = 0.20;  // eyelid height (along Y, across the eye)

    eyeDefs.forEach(({ x: ex, color: irisColor, flipX }) => {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(ex, eyeY, 0.38);
      // Left eye mirrored so inner corners face nose (midline)
      if (flipX) eyeGroup.scale.x = -1;
      scene.add(eyeGroup);

      const { outline: eyeShape, upperLash, lowerLash } = createGoddessEyeShape(EYE_HW, EYE_HH);

      // ── Neon glow aura ─────────────────────────────────────────
      const auraShape = createGoddessEyeShape(EYE_HW + 0.008, EYE_HH + 0.008).outline;
      const auraGeo = new THREE.ShapeGeometry(auraShape);
      const auraMat = new THREE.MeshBasicMaterial({
        color: irisColor, side: THREE.DoubleSide,
        transparent: true, opacity: 0.15,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const aura = new THREE.Mesh(auraGeo, auraMat);
      aura.position.z = -0.006;
      eyeGroup.add(aura);

      // ── Eye white ──────────────────────────────────────────────
      const whiteGeo = new THREE.ShapeGeometry(eyeShape);
      const whiteMat = new THREE.MeshBasicMaterial({
        color: 0xfafaff, side: THREE.DoubleSide,
      });
      eyeGroup.add(new THREE.Mesh(whiteGeo, whiteMat));

      // ── Upper lash (neon, thick) ───────────────────────────────
      const ulGeo = new THREE.ShapeGeometry(upperLash);
      const ulMat = new THREE.MeshBasicMaterial({
        color: irisColor, side: THREE.DoubleSide,
        transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ul = new THREE.Mesh(ulGeo, ulMat);
      ul.position.z = 0.002;
      eyeGroup.add(ul);

      // ── Lower lash (neon, subtle) ──────────────────────────────
      const llGeo = new THREE.ShapeGeometry(lowerLash);
      const llMat = new THREE.MeshBasicMaterial({
        color: irisColor, side: THREE.DoubleSide,
        transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ll = new THREE.Mesh(llGeo, llMat);
      ll.position.z = 0.001;
      eyeGroup.add(ll);

      // ── Iris group ─────────────────────────────────────────────
      const irisGroup = new THREE.Group();
      irisGroup.position.z = 0.003;
      eyeGroup.add(irisGroup);

      // Iris glow aura
      const irisAuraGeo = new THREE.CircleGeometry(0.032, 32);
      irisGroup.add(new THREE.Mesh(irisAuraGeo, new THREE.MeshBasicMaterial({
        color: irisColor, side: THREE.DoubleSide,
        transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })));

      // Iris body
      const irisGeo = new THREE.CircleGeometry(0.025, 32);
      irisGroup.add(new THREE.Mesh(irisGeo, new THREE.MeshBasicMaterial({
        color: irisColor, side: THREE.DoubleSide,
      })));

      // Iris inner ring
      const innerGeoI = new THREE.CircleGeometry(0.016, 24);
      irisGroup.add(new THREE.Mesh(innerGeoI, new THREE.MeshBasicMaterial({
        color: irisColor.clone().multiplyScalar(0.6), side: THREE.DoubleSide,
      })));

      // Pupil — bright, not black
      const pupilGeo = new THREE.CircleGeometry(0.007, 16);
      irisGroup.add(new THREE.Mesh(pupilGeo, new THREE.MeshBasicMaterial({
        color: 0xffeedd, side: THREE.DoubleSide,
      })));

      // Catchlights
      const sparkles = [
        { x: 0.010, y: 0.010, r: 0.006 },
        { x: -0.008, y: -0.006, r: 0.004 },
        { x: 0.002, y: 0.016, r: 0.003 },
      ];
      sparkles.forEach((s) => {
        const sg = new THREE.CircleGeometry(s.r, 8);
        const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
          color: 0xffffff, side: THREE.DoubleSide,
        }));
        sm.position.set(s.x, s.y, 0.003);
        irisGroup.add(sm);
      });

      // ── Eyelid group (slides from top +Y down to cover eye) ──
      const lidGroup = new THREE.Group();
      // Open: sits just above the eye on the thick-lash (+Y) side
      lidGroup.position.y = EYE_HH + LID_H / 2 + 0.01;
      eyeGroup.add(lidGroup);

      // Eyelid plane — covers eye when slid downward
      const lidGeo = new THREE.PlaneGeometry(LID_W, LID_H);
      lidGroup.add(new THREE.Mesh(lidGeo, new THREE.MeshBasicMaterial({
        color: 0x0d0d24, side: THREE.DoubleSide,
        transparent: true, opacity: 0.95, depthWrite: false,
      })));

      // Neon eyelashes on the bottom edge (-Y side of lid)
      const lashCount = 7;
      for (let i = 0; i < lashCount; i++) {
        const t = (i / (lashCount - 1) - 0.5) * 2;
        const lx = t * LID_W * 0.45;
        const lashLen = 0.014 + (1 - Math.abs(t)) * 0.012;

        const lashGeo = new THREE.PlaneGeometry(0.0035, lashLen);
        const lash = new THREE.Mesh(lashGeo, new THREE.MeshBasicMaterial({
          color: irisColor, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        lash.position.y = -(LID_H / 2 + lashLen / 2);
        lash.position.x = lx;
        lash.rotation.z = t * 0.25;
        lidGroup.add(lash);
      }

      eyes.push({ irisGroup, eyelid: lidGroup });
    });

    // ── Blink ───────────────────────────────────────────────────
    const blink: BlinkState = {
      phase: 'idle', timer: 0,
      nextBlink: 2.5 + Math.random() * 3.5, value: 0,
    };
    // Eyelid slides along Y (open above eye, closed covers it)
    const OPEN_Y = EYE_HH + LID_H / 2 + 0.01;
    const CLOSED_Y = -(EYE_HH + LID_H / 2 + 0.01);

    // ── Render loop ─────────────────────────────────────────────
    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = clock.getElapsedTime();

      // Blink state machine
      blink.timer += dt;
      switch (blink.phase) {
        case 'idle':
          if (blink.timer >= blink.nextBlink) { blink.phase = 'closing'; blink.timer = 0; }
          break;
        case 'closing': {
          const p = Math.min(blink.timer / BLINK_SPEED, 1);
          blink.value = p * p;
          if (p >= 1) { blink.value = 1; blink.phase = 'closed'; blink.timer = 0; }
          break;
        }
        case 'closed':
          if (blink.timer >= CLOSED_PAUSE) { blink.phase = 'opening'; blink.timer = 0; }
          break;
        case 'opening': {
          const p = Math.min(blink.timer / BLINK_SPEED, 1);
          blink.value = 1 - (1 - p) * (1 - p);
          if (p >= 1) { blink.value = 0; blink.phase = 'idle'; blink.timer = 0; blink.nextBlink = 2.5 + Math.random() * 4.0; }
          break;
        }
      }

      // Eyelid slides along local Y (→ world faceDir when open)
      eyes.forEach((eye) => {
        eye.eyelid.position.y = OPEN_Y + (CLOSED_Y - OPEN_Y) * blink.value;
      });

      // Iris drift (in local space, drift along X = across the eye)
      eyes.forEach((eye, i) => {
        const ph = i * 0.8;
        eye.irisGroup.position.x = Math.sin(t * 0.45 + ph) * 0.005;
        eye.irisGroup.position.y = Math.cos(t * 0.38 + ph) * 0.004;
      });

      // Head breathe
      head.rotation.y = Math.sin(t * 0.3) * 0.05;
      head.rotation.x = Math.cos(t * 0.25) * 0.03;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [size, side]);

  return (
    <div ref={containerRef} onClick={onClick} style={{
      width: size, height: size, pointerEvents: 'auto', cursor: 'pointer',
    }} />
  );
}
