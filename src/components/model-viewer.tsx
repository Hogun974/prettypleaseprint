"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createTranslator } from "next-intl";
import type * as THREE from "three";

import type { PageMessages } from "@/i18n/page-messages";
import { VIEWER_MAX_BYTES } from "@/lib/upload-limits";

/**
 * The real geometry, rotatable. Handoff §4.
 *
 * Replaces the stand-in primitive the prototype used — it could not parse a
 * mesh, so it drew a torus knot and hoped. This loads the actual uploaded
 * `.stl` or `.3mf` from `/api/models/[id]`, which is same-origin and scoped
 * by the ownership rule, so nothing here needs a CSP relaxation.
 *
 * three.js is ~600 KB, so it is imported dynamically inside the effect: it is
 * fetched when someone opens a ticket, and never on the board or the queue.
 *
 * The handoff's lighting rig is kept exactly — hemisphere, a key at (3,5,4)
 * and a cool rim behind — because it reads well on filament colours from
 * near-black to bone white. The grid and the ground are the ones that moved
 * to the new palette: the print bed should look like the app it lives in.
 */

/**
 * Why there is no preview. `said` is one of the viewer's own sentences, by its
 * key; `message` is whatever else threw — a loader's or the theme's, shown as
 * it was written.
 */
type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; said: ViewerProblem }
  | { kind: "error"; message: string };

type ViewerProblem = "notAvailable" | "notFetched" | "notDisplayed";

/** A refusal of the viewer's own, carried by its key to the render. */
class ViewerError extends Error {
  constructor(readonly said: ViewerProblem) {
    super(said);
  }
}

export function ModelViewer({
  storyId,
  filename,
  colorHex,
  dims,
  fileSize,
  words,
}: {
  storyId: number;
  filename: string;
  colorHex: string;
  /** Used for the text alternative, so the canvas is not a dead end. */
  dims: string | null;
  /** Measured on upload. Decides whether the preview is attempted at all. */
  fileSize: number;
  /** Its words, from the page: `getPageMessages(VIEWER_WORDS)`. */
  words: PageMessages;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const t = useMemo(() => createTranslator({ ...words, namespace: "viewer" }), [words]);

  /*
   * Decided from the stored size, before anything is fetched.
   *
   * The order matters: the viewer's first act is to download the entire model
   * through the app, so a check that ran after the fetch would still have
   * pulled a quarter of a gigabyte across the office and only then given up.
   * Uploads may now be five times what a browser can rebuild, so this is the
   * guard on a hole the raised cap opened.
   */
  const tooLarge = fileSize > VIEWER_MAX_BYTES;

  useEffect(() => {
    if (tooLarge) return;
    const el = host.current;
    if (!el) return;

    let disposed = false;
    let frame = 0;
    let cleanupInput: (() => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any;

    (async () => {
      try {
        const THREE = await import("three");
        const isStl = /\.stl$/i.test(filename);
        const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
        const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");

        const response = await fetch(`/api/models/${storyId}`);
        if (!response.ok) {
          throw new ViewerError(response.status === 404 ? "notAvailable" : "notFetched");
        }
        const buffer = await response.arrayBuffer();
        if (disposed) return;

        // Both loaders parse from an ArrayBuffer, so the bytes never touch a
        // second URL and nothing is cached where it should not be.
        // The cast is a typings wrinkle, not a real mismatch: STLLoader is
        // declared as returning BufferGeometry<NormalOrGLBufferAttributes>,
        // which three's own Mesh and EdgesGeometry do not accept. The runtime
        // object is an ordinary BufferGeometry.
        let geometry: THREE.BufferGeometry | null = null;
        let group: THREE.Object3D | null = null;
        if (isStl) {
          geometry = new STLLoader().parse(buffer) as unknown as THREE.BufferGeometry;
        } else {
          group = new ThreeMFLoader().parse(buffer);
        }

        const width = el.clientWidth || 480;
        const height = el.clientHeight || 380;

        // Every colour in the scene is read from the theme's CSS variables
        // rather than written out here, so whatever redefines them repaints the
        // viewer too. The lights have tokens of their own (--color-scene-*):
        // they are light, not paint, and a dark theme darkening the counter
        // should not darken the lamp. A variable that is not defined is an
        // error the viewer shows, not a black scene.
        const styles = getComputedStyle(el);
        const token = (name: string) => {
          const value = styles.getPropertyValue(`--color-${name}`).trim();
          if (!value) throw new Error(`The theme does not define --color-${name}.`);
          return new THREE.Color(value);
        };

        const scene = new THREE.Scene();
        scene.background = token("cream-2"); // the counter

        const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 2000);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        el.replaceChildren(renderer.domElement);

        scene.add(new THREE.HemisphereLight(token("scene-light"), token("scene-ground"), 1.1));
        const key = new THREE.DirectionalLight(token("scene-light"), 1.5);
        key.position.set(3, 5, 4);
        scene.add(key);
        const rim = new THREE.DirectionalLight(token("scene-rim"), 0.6);
        rim.position.set(-4, 1, -3);
        scene.add(rim);

        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(colorHex),
          roughness: 0.62,
          metalness: 0.05,
        });

        /*
         * Scene graph, and the reason it has three levels:
         *
         *   pivot   sits on the plate, and is the thing that rotates
         *     └ inner   shifted by -centre, so the model's own middle lands
         *               on the pivot's origin
         *         └ mesh + edge overlay
         *
         * Rotating a group whose children sit at their original coordinates
         * turns the model around the scene origin instead of around itself,
         * and it swings off the bed as it spins. Centring inside an inner
         * group fixes the pivot without moving the geometry.
         */
        const inner = new THREE.Group();
        if (geometry) {
          geometry.computeVertexNormals();
          inner.add(new THREE.Mesh(geometry, material));
        } else if (group) {
          group.traverse((child: unknown) => {
            const mesh = child as { isMesh?: boolean; material?: unknown };
            if (mesh.isMesh) mesh.material = material;
          });
          inner.add(group);
        }

        /*
         * Auto-frame. An uploaded model can be a 5 mm grommet or a 250 mm
         * bracket, and it may be centred anywhere in its own coordinate
         * space — plenty of exporters put the origin at a corner. So measure
         * it, centre it, stand it on the plate, and pull the camera back to
         * fit whichever dimension is largest. The prototype never had to do
         * any of this because it drew a unit primitive.
         */
        const box = new THREE.Box3().setFromObject(inner);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const largest = Math.max(size.x, size.y, size.z) || 1;

        // A faint edge overlay, as the handoff specifies. STL only: a 3MF
        // arrives as a group of meshes, and deriving one edge set from it
        // would mean walking the tree for a line that is 16% opaque anyway.
        // In a sign's ink, not the counter's: the edges lie on the model,
        // which the same lamps light in every theme, so they are drawn as
        // they are by day rather than in a dark counter's light ink.
        if (geometry) {
          inner.add(
            new THREE.LineSegments(
              new THREE.EdgesGeometry(geometry, 28),
              new THREE.LineBasicMaterial({
                color: token("sign-ink"),
                transparent: true,
                opacity: 0.16,
              }),
            ),
          );
        }

        inner.position.sub(centre);

        const pivot = new THREE.Group();
        pivot.position.y = size.y / 2; // stand it on the bed
        pivot.add(inner);
        scene.add(pivot);

        // The build plate, in the app's ink rather than the prototype's grey.
        const grid = new THREE.GridHelper(largest * 2.4, 18, token("ink"), token("scene-grid"));
        (grid.material as { opacity: number; transparent: boolean }).opacity = 0.35;
        (grid.material as { opacity: number; transparent: boolean }).transparent = true;
        scene.add(grid);

        camera.position.set(largest * 0.9, largest * 0.95, largest * 1.6);
        camera.lookAt(0, size.y / 2, 0);

        setPhase({ kind: "ready" });

        // --- drag to rotate, with an idle spin that stops on first touch ---
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        let rotX = 0.25;
        let rotY = 0.6;
        let spinning = !reduceMotion;
        let dragging = false;
        let lastX = 0;
        let lastY = 0;

        const dom = renderer.domElement;
        dom.style.cursor = "grab";
        const down = (e: PointerEvent) => {
          dragging = true;
          spinning = false;
          lastX = e.clientX;
          lastY = e.clientY;
          dom.style.cursor = "grabbing";
          dom.setPointerCapture?.(e.pointerId);
        };
        const move = (e: PointerEvent) => {
          if (!dragging) return;
          rotY += (e.clientX - lastX) * 0.008;
          rotX += (e.clientY - lastY) * 0.008;
          lastX = e.clientX;
          lastY = e.clientY;
        };
        const up = () => {
          dragging = false;
          dom.style.cursor = "grab";
        };
        dom.addEventListener("pointerdown", down);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        cleanupInput = () => {
          dom.removeEventListener("pointerdown", down);
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };

        const resize = () => {
          const w = el.clientWidth || width;
          const h = el.clientHeight || height;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(el);
        const previousCleanup = cleanupInput;
        cleanupInput = () => {
          previousCleanup?.();
          observer.disconnect();
        };

        const loop = () => {
          if (disposed) return;
          if (spinning) rotY += 0.004;
          pivot.rotation.set(rotX, rotY, 0);
          renderer.render(scene, camera);
          frame = requestAnimationFrame(loop);
        };
        loop();
      } catch (error) {
        if (disposed) return;
        console.error("[viewer]", error);
        setPhase(
          error instanceof ViewerError
            ? { kind: "error", said: error.said }
            : error instanceof Error && error.message
              ? { kind: "error", message: error.message }
              : { kind: "error", said: "notDisplayed" },
        );
      }
    })();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      cleanupInput?.();
      renderer?.dispose?.();
    };
  }, [storyId, filename, colorHex, tooLarge]);

  // The page draws `ModelTooLarge` (./model-too-large.tsx) instead of this for
  // such a file; this is the guard that keeps the download from starting even
  // if one ever did not.
  if (tooLarge) return null;

  return (
    <div className="relative overflow-hidden rounded-panel border-[3px] border-ink bg-cream-2 shadow-stamp-lg">
      {/* The canvas carries no information for a screen reader, so the file is
          described here instead — the handoff asks for exactly this. */}
      <div
        ref={host}
        className="h-[380px] w-full"
        role="img"
        aria-label={dims ? t("ariaDims", { filename, dims }) : t("aria", { filename })}
      />

      {phase.kind === "loading" && (
        <div className="layers absolute inset-0 flex items-center justify-center bg-cream-2">
          <p className="m-0 font-mono text-[12px] uppercase tracking-[0.1em] text-ink-3">
            {t("warming")}
          </p>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[8px] bg-cream-2 px-[26.4px] text-center">
          <p className="m-0 font-display text-[18px] text-ink">
            {t("noPreview")}
          </p>
          <p className="m-0 max-w-[34ch] text-[14px] leading-[1.5] text-ink-2">
            {t("fileFine", { message: "said" in phase ? t(phase.said) : phase.message })}
          </p>
        </div>
      )}

      {phase.kind === "ready" && (
        <p className="absolute bottom-[13.2px] left-[13.2px] m-0 rounded-chip border-2 border-ink bg-porcelain px-[11px] py-[3px] font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-ink">
          {t("dragHint", { filename })}
        </p>
      )}
    </div>
  );
}
