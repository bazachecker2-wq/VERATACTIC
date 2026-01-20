
import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { Target } from '../types';
import { COLORS } from '../constants';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// Declare Heightmap as a global from the script import
declare const Heightmap: any; 

interface UserLocation {
  latitude: number;
  longitude: number;
}

interface TacticalMap3DProps {
  targets: Target[];
  myId: string;
  isFullMode: boolean;
  onToggleFullMode: () => void;
  userLocation: UserLocation | null;
}

const TacticalMap3D: React.FC<TacticalMap3DProps> = ({ targets, myId, isFullMode, onToggleFullMode, userLocation }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cssRendererRef = useRef<CSS2DRenderer | null>(null);
  const targetsGroupRef = useRef<THREE.Group>(new THREE.Group());
  const labelsGroupRef = useRef<THREE.Group>(new THREE.Group());
  const userIndicatorRef = useRef<THREE.Mesh | null>(null);
  const userLabelRef = useRef<CSS2DObject | null>(userLocation ? new CSS2DObject(document.createElement('div')) : null);

  // Maps to store active meshes and labels for reconciliation
  const targetMeshMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const targetLabelMapRef = useRef<Map<string, CSS2DObject>>(new Map());
  const targetGlowMapRef = useRef<Map<string, THREE.Mesh>>(new Map());


  const MAP_SIZE = 100; // Represents 100x100 units in 3D world
  const MAP_HEIGHT_SCALE = 10; // Max height for terrain features

  const cleanMaterial = (material: THREE.Material) => {
    material.dispose();
    for (const key in material) {
      const value = (material as any)[key];
      if (value && typeof value === 'object' && typeof value.dispose === 'function') {
        value.dispose();
      }
    }
  };

  const cleanMesh = (mesh: THREE.Mesh) => {
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
        mesh.material.forEach(cleanMaterial);
    } else {
        cleanMaterial(mesh.material as THREE.Material);
    }
  };

  const createTextLabel = useCallback((text: string, color: string = '#FFFFFF', size: string = '11px', isAiMarked: boolean = false) => {
    const div = document.createElement('div');
    div.className = 'label pixel-font';
    div.style.color = color;
    div.style.fontSize = size;
    div.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 100%)`; // Darker, more opaque background
    div.style.padding = '10px 16px'; // Increased padding from 8px 14px
    div.style.borderRadius = '8px'; // Rounded corners
    div.style.border = `1px solid ${color}`;
    div.style.textShadow = `0 0 20px ${color}`; // Stronger text glow
    div.style.boxShadow = `0 0 40px ${isAiMarked ? COLORS.ORANGE : color}`; // Stronger box shadow
    div.style.whiteSpace = 'nowrap';
    if (isAiMarked) {
      div.style.animation = `labelAppear 0.3s ease-out forwards, labelPulse 2s infinite ease-in-out`; // Apply pulsating animation
    } else {
      div.style.animation = `labelAppear 0.3s ease-out forwards`; // Only appear animation
    }
    div.textContent = text;
    const label = new CSS2DObject(div);
    return label;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const currentContainer = containerRef.current;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x050505);

    const camera = new THREE.PerspectiveCamera(75, currentContainer.clientWidth / currentContainer.clientHeight, 0.1, 1000);
    cameraRef.current = camera;
    camera.position.set(0, MAP_SIZE * 0.8, MAP_SIZE * 0.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    rendererRef.current = renderer;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0); // Transparent background
    currentContainer.appendChild(renderer.domElement);

    const cssRenderer = new CSS2DRenderer();
    cssRendererRef.current = cssRenderer;
    cssRenderer.setSize(currentContainer.clientWidth, currentContainer.clientHeight);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0px';
    cssRenderer.domElement.style.pointerEvents = 'none'; // Allow clicks to pass through
    currentContainer.appendChild(cssRenderer.domElement);

    const resizeRenderer = () => {
      const width = currentContainer.clientWidth;
      const height = currentContainer.clientHeight;
      renderer.setSize(width, height);
      cssRenderer.setSize(width, height);
      if (cameraRef.current) {
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
      }
    };

    resizeRenderer();
    window.addEventListener('resize', resizeRenderer);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(MAP_SIZE / 2, MAP_SIZE, MAP_SIZE / 2);
    scene.add(directionalLight);

    // Procedural Terrain (Heightmap.js)
    const segments = 64; // Number of segments for the plane
    const terrainGeometry = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segments, segments);
    terrainGeometry.rotateX(-Math.PI / 2); // Orient for Y-up terrain

    // Check if Heightmap is available
    if (typeof Heightmap !== 'undefined' && Heightmap.generate) {
        try {
            const heightData = Heightmap.generate({
                width: segments + 1,
                height: segments + 1,
                smootheningIterations: 10,
                maxHeight: MAP_HEIGHT_SCALE,
            });

            for (let i = 0; i < terrainGeometry.attributes.position.count; i++) {
                const x = i % (segments + 1);
                const y = Math.floor(i / (segments + 1));
                const z = heightData[y][x];
                terrainGeometry.attributes.position.setZ(i, z);
            }
            terrainGeometry.computeVertexNormals(); // For proper lighting
        } catch (error) {
            console.error("Error generating heightmap, falling back to flat terrain:", error);
            // Fallback: keep terrain flat if generation fails
        }
    } else {
        console.warn("Heightmap.js not found or not fully loaded. Using flat terrain.");
        // Fallback: keep terrain flat if Heightmap is not available
    }

    // Load terrain texture
    const textureLoader = new THREE.TextureLoader();
    const terrainTexture = textureLoader.load('https://threejs.org/examples/textures/terrain/water.jpg'); // Example texture
    terrainTexture.wrapS = THREE.RepeatWrapping;
    terrainTexture.wrapT = THREE.RepeatWrapping;
    terrainTexture.repeat.set(8, 8); // Repeat texture for better detail

    const terrainMaterial = new THREE.MeshLambertMaterial({ map: terrainTexture });
    const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
    scene.add(terrainMesh);

    // Grid Helper
    const gridHelper = new THREE.GridHelper(MAP_SIZE, 10, 0x404040, 0x404040);
    gridHelper.position.y = 0.1; // Slightly above terrain
    gridHelper.material.opacity = 0.3;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);
    
    // Add groups to the scene
    scene.add(targetsGroupRef.current);
    scene.add(labelsGroupRef.current);

    // User Position Indicator
    const userGeo = new THREE.SphereGeometry(1, 16, 16);
    const userMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 0.8 });
    const userSphere = new THREE.Mesh(userGeo, userMat);
    userSphere.position.set(0, MAP_HEIGHT_SCALE * 0.6, 0); // At the center of the map
    userIndicatorRef.current = userSphere;
    scene.add(userSphere);

    // User GPS Label
    userLabelRef.current = createTextLabel('', '#FFFFFF', '10px');
    userSphere.add(userLabelRef.current);

    // Animation Loop
    const animate = () => {
      requestAnimationFrame(animate);

      // Rotate camera slightly for dynamic view
      if (cameraRef.current) {
        cameraRef.current.position.x = Math.sin(Date.now() * 0.00003) * MAP_SIZE * 0.5;
        cameraRef.current.position.z = Math.cos(Date.now() * 0.00003) * MAP_SIZE * 0.5;
        cameraRef.current.lookAt(0, MAP_HEIGHT_SCALE * 0.3, 0); // Look slightly above ground
      }

      renderer.render(scene, camera);
      cssRenderer.render(scene, camera);
    };
    animate();

    return () => {
      window.removeEventListener('resize', resizeRenderer);
      if (currentContainer && rendererRef.current) {
        currentContainer.removeChild(renderer.domElement);
        currentContainer.removeChild(cssRenderer.domElement);
        renderer.dispose();
      }
      if (sceneRef.current) {
        // Dispose all meshes, geometries, and materials
        targetMeshMapRef.current.forEach(mesh => {
          targetsGroupRef.current.remove(mesh);
          cleanMesh(mesh);
        });
        targetLabelMapRef.current.forEach(label => {
            labelsGroupRef.current.remove(label);
            label.element.remove();
        });
        targetGlowMapRef.current.forEach(glowMesh => {
            targetsGroupRef.current.remove(glowMesh);
            cleanMesh(glowMesh);
            targetGlowMapRef.current.delete(glowMesh.name); // Ensure removal from map, use glowMesh.name or original target.id
        });

        // Clear maps
        targetMeshMapRef.current.clear();
        targetLabelMapRef.current.clear();
        targetGlowMapRef.current.clear();

        // Dispose terrain and grid
        if (terrainMesh) cleanMesh(terrainMesh);
        if (gridHelper) {
          gridHelper.geometry.dispose();
          (gridHelper.material as THREE.Material).dispose();
        }
        if (userIndicatorRef.current) cleanMesh(userIndicatorRef.current);
        if (userLabelRef.current) userLabelRef.current.element.remove();

        sceneRef.current = null;
      }
    };
  }, [createTextLabel]);

  useEffect(() => {
    // Update user GPS label
    if (userLabelRef.current && userLocation) {
        userLabelRef.current.element.textContent = 
            `GPS: ${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)}`;
        userLabelRef.current.position.set(0, 2, 0); // Position above user indicator
    }

    const currentTargetIds = new Set(targets.map(t => t.id));
    
    // Identify and remove targets that are no longer present
    targetMeshMapRef.current.forEach((mesh, id) => {
        if (!currentTargetIds.has(id)) {
            targetsGroupRef.current.remove(mesh);
            cleanMesh(mesh);
            targetMeshMapRef.current.delete(id);
            
            const label = targetLabelMapRef.current.get(id);
            if (label) {
                labelsGroupRef.current.remove(label);
                label.element.remove();
                targetLabelMapRef.current.delete(id);
            }
            const glowMesh = targetGlowMapRef.current.get(id);
            if (glowMesh) {
                targetsGroupRef.current.remove(glowMesh);
                cleanMesh(glowMesh);
                targetGlowMapRef.current.delete(id);
            }
        }
    });

    // Add or update current targets
    targets.forEach(target => {
      // Map screen percentage coordinates to 3D tactical map relative to user (center 0,0)
      const relativeX = (target.x / 100 - 0.5) * MAP_SIZE;
      const relativeZ = (target.y / 100 - 0.5) * MAP_SIZE;

      const actualDistance = target.distance || 5;
      const angle = Math.atan2(relativeZ, relativeX);
      const mappedX = Math.cos(angle) * actualDistance * 2;
      const mappedZ = Math.sin(angle) * actualDistance * 2;

      let height = 0;
      const terrainMesh = sceneRef.current?.children[2] as THREE.Mesh; // Assuming terrainMesh is at index 2
      if (terrainMesh && terrainMesh.geometry.attributes.position) {
          const segments = 64;
          // Calculate grid indices, clamped to valid range
          const xIdx = Math.max(0, Math.min(segments, Math.floor((mappedX / MAP_SIZE + 0.5) * (segments))));
          const yIdx = Math.max(0, Math.min(segments, Math.floor((mappedZ / MAP_SIZE + 0.5) * (segments))));
          
          const vertexIndex = yIdx * (segments + 1) + xIdx;
          if (vertexIndex < terrainMesh.geometry.attributes.position.count) {
              height = terrainMesh.geometry.attributes.position.getZ(vertexIndex);
          }
      }
      
      const y = Math.max(height + 1, 1);
      const sizeMultiplier = target.distance ? Math.max(0.5, 3 - (target.distance / 10)) : 1;
      const radius = 1.5 * sizeMultiplier;

      const isLocal = target.ownerId === myId;
      const targetColor = target.isAiMarked ? COLORS.ORANGE : (isLocal ? '#FFFFFF' : COLORS.CYAN);

      let mesh = targetMeshMapRef.current.get(target.id);
      let label = targetLabelMapRef.current.get(target.id);
      let glowMesh = targetGlowMapRef.current.get(target.id);

      // Create or update mesh
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 16, 16),
          new THREE.MeshLambertMaterial({ color: new THREE.Color(targetColor), transparent: true, opacity: 0.8 })
        );
        targetsGroupRef.current.add(mesh);
        targetMeshMapRef.current.set(target.id, mesh);
      } else {
        // Update existing mesh properties
        (mesh.material as THREE.MeshLambertMaterial).color.set(targetColor);
        // Only update geometry if radius truly changes to avoid unnecessary re-creations
        if ((mesh.geometry as THREE.SphereGeometry).parameters.radius !== radius) {
             mesh.geometry.dispose();
             mesh.geometry = new THREE.SphereGeometry(radius, 16, 16);
        }
      }
      mesh.position.set(mappedX, y, mappedZ);

      // Create or update glow mesh for AI marked targets
      if (target.isAiMarked) {
        if (!glowMesh) {
            const glowMaterial = new THREE.MeshBasicMaterial({
                color: new THREE.Color(COLORS.ORANGE),
                transparent: true,
                opacity: 0.2, // Base opacity
                blending: THREE.AdditiveBlending,
                side: THREE.BackSide,
            });
            glowMesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.5, 16, 16), glowMaterial);
            targetsGroupRef.current.add(glowMesh);
            targetGlowMapRef.current.set(target.id, glowMesh);
        }
        glowMesh.position.copy(mesh.position);
        (glowMesh.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(Date.now() * 0.005) * 0.1; // Pulsing glow
        // Update glow geometry if radius changes
        if ((glowMesh.geometry as THREE.SphereGeometry).parameters.radius !== radius * 1.5) {
            glowMesh.geometry.dispose();
            glowMesh.geometry = new THREE.SphereGeometry(radius * 1.5, 16, 16);
        }
      } else if (glowMesh) {
          targetsGroupRef.current.remove(glowMesh);
          cleanMesh(glowMesh);
          targetGlowMapRef.current.delete(target.id);
      }


      // Create or update label
      const labelText = `${target.label} (${Math.round(actualDistance)}m)`; // Use rounded distance
      if (!label) {
        label = createTextLabel(labelText, targetColor, '11px', target.isAiMarked); // Explicitly pass 11px
        labelsGroupRef.current.add(label);
        targetLabelMapRef.current.set(target.id, label);
      } else {
        // Update existing label properties
        label.element.textContent = labelText;
        label.element.style.color = targetColor;
        label.element.style.border = `1px solid ${targetColor}`;
        label.element.style.textShadow = `0 0 20px ${targetColor}`; // Stronger text glow
        label.element.style.boxShadow = `0 0 40px ${target.isAiMarked ? COLORS.ORANGE : targetColor}`; // Stronger box shadow
        if (target.isAiMarked) {
            label.element.style.animation = `labelAppear 0.3s ease-out forwards, labelPulse 2s infinite ease-in-out`;
        } else {
            label.element.style.animation = `labelAppear 0.3s ease-out forwards`;
        }
      }
      // Dynamically adjust label height based on distance
      // Closer objects have labels lifted higher to avoid overlap and improve visibility
      const labelHeightOffset = radius + 2 + Math.max(0, 10 / (actualDistance + 1)); // Max 10 units additional lift for very close
      label.position.set(mappedX, y + labelHeightOffset, mappedZ);
    });
  }, [targets, myId, userLocation, createTextLabel]);

  return (
    <div
      ref={containerRef}
      className={`relative bg-black/40 border border-cyan-700/50 rounded-lg overflow-hidden cursor-pointer map-window-animation
        ${isFullMode ? 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/2 h-1/2 z-90 shadow-[0_0_50px_rgba(0,255,255,0.4)]' : 'w-64 h-64 opacity-70 shadow-none'}`}
      onClick={onToggleFullMode}
    />
  );
};

export default TacticalMap3D;