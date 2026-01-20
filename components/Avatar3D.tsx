
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface Avatar3DProps {
  intensity: number;
  modelUrl?: string | null;
  isFullMode?: boolean;
}

const Avatar3D: React.FC<Avatar3DProps> = ({ intensity, modelUrl, isFullMode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<THREE.Group>(null);
  const customModelRef = useRef<THREE.Group | null>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, logarithmicDepthBuffer: true });
    rendererRef.current = renderer;
    
    renderer.setPixelRatio(window.devicePixelRatio);
    const size = containerRef.current.clientWidth;
    renderer.setSize(size, size);
    containerRef.current.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);
    (groupRef as any).current = group;

    // Dynamic Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0x00FFFF, 0.5, 100); // Cyan light
    pointLight.position.set(0, 0, 5);
    scene.add(pointLight);

    // Procedural Fallback (always present until model loads)
    const fallback = new THREE.Group();
    const sphereGeo = new THREE.IcosahedronGeometry(1, 2);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00FFFF, wireframe: true, transparent: true, opacity: 0.1 });
    const fallbackMesh = new THREE.Mesh(sphereGeo, sphereMat);
    fallback.add(fallbackMesh);
    group.add(fallback);

    const loader = new GLTFLoader();
    const reliableUrl = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb';
    const finalUrl = modelUrl || reliableUrl;

    loader.load(finalUrl, (gltf) => {
      fallback.visible = false;
      const model = gltf.scene;
      
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const sizeVec = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
      // Adjusted scale factor for corner mode to fill window more
      const scaleFactor = isFullMode ? 5 : 5.0; // Increased from 3.5 to 5.0
      const scale = scaleFactor / maxDim;
      
      model.scale.set(scale, scale, scale);
      model.position.sub(center.multiplyScalar(scale));
      
      model.traverse((o: any) => {
        if (o.isMesh) {
          o.material.transparent = true;
          o.material.opacity = 1.0;
        }
      });
      
      group.add(model);
      customModelRef.current = model;
    }, undefined, (err) => {
      console.warn("Failed to load custom model, sticking with procedural fallback.", err);
    });

    camera.position.z = isFullMode ? 8 : 5; // Camera distance adjusted for full mode

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const animate = () => {
      requestAnimationFrame(animate);
      
      const lerpSpeed = 0.08 + intensity * 0.1; // Rotation speed slightly affected by intensity
      const targetRX = -mouseRef.current.y * 0.4;
      const targetRY = mouseRef.current.x * 0.8;
      
      const pulseEffect = 1 + (intensity * 0.15); // Scale pulse effect
      const currentBaseScale = isFullMode ? 1.5 : 1.0; // Base scale for the model

      if (customModelRef.current) {
        customModelRef.current.rotation.x += (targetRX - customModelRef.current.rotation.x) * lerpSpeed;
        customModelRef.current.rotation.y += (targetRY - customModelRef.current.rotation.y) * lerpSpeed;
        customModelRef.current.scale.setScalar(pulseEffect * currentBaseScale);
      } else {
        fallback.rotation.y += 0.01 + intensity * 0.05;
        fallback.rotation.x += 0.005;
        fallback.scale.setScalar(pulseEffect);
        // Animate fallback material properties
        (fallbackMesh.material as THREE.MeshBasicMaterial).opacity = 0.1 + intensity * 0.4;
        (fallbackMesh.material as THREE.MeshBasicMaterial).color.setHSL(0.5 + intensity * 0.2, 1, 0.7); // Shift color slightly
      }

      // Animate point light
      pointLight.intensity = 0.5 + intensity * 1.5;
      pointLight.color.setHSL(0.5 + intensity * 0.1, 1, 0.7); // Shift color to match fallback

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (containerRef.current && rendererRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
        scene.traverse((object: any) => {
          if (!object.isMesh) return;
          object.geometry.dispose();
          if (object.material.isMaterial) {
            cleanMaterial(object.material);
          } else {
            for (const material of object.material) cleanMaterial(material);
          }
        });
      }
    };
  }, [modelUrl, isFullMode, intensity]);

  // Helper to dispose materials
  const cleanMaterial = (material: THREE.Material) => {
    material.dispose(); // Dispose the material itself

    // Iterate over material properties to dispose textures and other disposable objects
    for (const key in material) {
      const value = (material as any)[key];
      // Only dispose of objects that explicitly have a dispose function
      // This includes Textures, RenderTargets, etc. but excludes basic objects like THREE.Color
      if (value && typeof value === 'object' && typeof value.dispose === 'function') {
        value.dispose();
      }
    }
  };

  return <div ref={containerRef} className="w-full h-full relative" />;
};

export default Avatar3D;
