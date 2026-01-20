
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

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, logarithmicDepthBuffer: true });
    
    renderer.setPixelRatio(window.devicePixelRatio);
    const size = containerRef.current.clientWidth;
    renderer.setSize(size, size);
    containerRef.current.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);
    (groupRef as any).current = group;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    // Procedural Fallback (always present until model loads)
    const fallback = new THREE.Group();
    const sphereGeo = new THREE.IcosahedronGeometry(1, 2);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.1 });
    fallback.add(new THREE.Mesh(sphereGeo, sphereMat));
    group.add(fallback);

    const loader = new GLTFLoader();
    // Using a more reliable cross-origin compatible model
    const reliableUrl = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb';
    const finalUrl = modelUrl || reliableUrl;

    loader.load(finalUrl, (gltf) => {
      fallback.visible = false;
      const model = gltf.scene;
      
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const sizeVec = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
      const scale = (isFullMode ? 6 : 4) / maxDim;
      
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

    camera.position.z = 5;

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    const animate = () => {
      requestAnimationFrame(animate);
      
      const lerpSpeed = 0.08;
      const targetRX = -mouseRef.current.y * 0.4;
      const targetRY = mouseRef.current.x * 0.8;
      
      if (customModelRef.current) {
        customModelRef.current.rotation.x += (targetRX - customModelRef.current.rotation.x) * lerpSpeed;
        customModelRef.current.rotation.y += (targetRY - customModelRef.current.rotation.y) * lerpSpeed;
        
        const pulse = 1 + (intensity * 0.15);
        customModelRef.current.scale.setScalar(pulse * (isFullMode ? 1.5 : 1.0));
      } else {
        fallback.rotation.y += 0.01 + intensity * 0.05;
        fallback.rotation.x += 0.005;
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, [modelUrl, isFullMode]);

  return <div ref={containerRef} className="w-full h-full relative" />;
};

export default Avatar3D;
