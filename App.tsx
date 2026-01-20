
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, FunctionDeclaration, Type } from '@google/genai';
import BootSequence from './components/BootSequence';
import Avatar3D from './components/Avatar3D';
import TacticalMap3D from './components/TacticalMap3D';
import LogModal from './components/LogModal'; // Import new LogModal component
import { HUDMode, TacticalLog, Target } from './types';
import { COLORS, SYSTEM_INSTRUCTION, KNOWN_OBJECT_SIZES } from './constants';
import { encode, decode, decodeAudioData } from './services/audioHelper';
import * as tf from '@tensorflow/tfjs';

interface Subtitle {
  id: string;
  text: string;
  type: 'AI' | 'USER';
}

interface UserLocation {
  latitude: number;
  longitude: number;
}

const translationMap: { [key: string]: string } = {
  person: 'ЧЕЛОВЕК', bicycle: 'ВЕЛОСИПЕД', car: 'АВТО', motorcycle: 'МОТОЦИКЛ',
  airplane: 'САМОЛЕТ', bus: 'АВТОБУС', train: 'ПОЕЗД', truck: 'ГРУЗОВИК',
  boat: 'ЛОДКА', 'traffic light': 'СВЕТОФОР', 'fire hydrant': 'ГИДРАНТ',
  'stop sign': 'СТОП-ЗНАК', 'parking meter': 'ПАРКОМАТ', bench: 'СКАМЬЯ',
  bird: 'ПТИЦА', cat: 'КОТ', dog: 'СОБАКА', horse: 'ЛОШАДЬ', sheep: 'ОВЦА',
  cow: 'КОРОВА', elephant: 'СЛОН', bear: 'МЕДВЕДЬ', zebra: 'ЗЕБРА',
  giraffe: 'ЖИРАФ', backpack: 'РЮКЗАК', umbrella: 'ЗОНТ', handbag: 'СУМКА',
  tie: 'ГАЛСТУК', suitcase: 'ЧЕМОДАН', frisbee: 'ФРИСБИ', skis: 'ЛЫЖИ',
  snowboard: 'СНОУБОРД', 'sports ball': 'МЯЧ', kite: 'ВОЗДУШНЫЙ_ЗМЕЙ',
  'baseball bat': 'БЕЙСБОЛЬНАЯ_БИТА', 'baseball glove': 'БЕЙСБОЛЬНАЯ_ПЕРЧАТКА',
  skateboard: 'СКЕЙТБОРД', surfboard: 'СЕРФБОРД', tennis: 'ТЕННИС',
  bottle: 'БУТЫЛКА', 'wine glass': 'БОКАЛ', cup: 'ЧАШКА', fork: 'ВИЛКА',
  knife: 'НОЖ', spoon: 'ЛОЖКА', bowl: 'МИСКА', banana: 'БАНАН', apple: 'ЯБЛОКО',
  sandwich: 'СЭНДВИЧ', orange: 'АПЕЛЬСИН', broccoli: 'БРОККОЛИ', carrot: 'МОРКОВЬ',
  'hot dog': 'ХОТ-ДОГ', pizza: 'ПИЦЦА', donut: 'ПОНЧИК', cake: 'ТОРТ',
  chair: 'СТУЛ', couch: 'ДИВАН', 'potted plant': 'РАСТЕНИЕ_В_ГОРШКЕ',
  bed: 'КРОВАТЬ', 'dining table': 'ОБЕДЕННЫЙ_СТОЛ', toilet: 'ТУАЛЕТ', tv: 'ТВ',
  laptop: 'НОУТБУК', mouse: 'МЫШЬ', remote: 'ПУЛЬТ', keyboard: 'КЛАВИАТУРА',
  'cell phone': 'ТЕЛЕФОН', microwave: 'МИКРОВОЛНОВКА', oven: 'ДУХОВКА',
  toaster: 'ТОСТЕР', sink: 'РАКОВИНА', refrigerator: 'ХОЛОДИЛЬНИК', book: 'КНИГА',
  clock: 'ЧАСЫ', vase: 'ВАЗА', scissors: 'НОЖНИЦЫ', 'teddy bear': 'ПЛЮШЕВЫЙ_МИШКА',
  'hair drier': 'ФЕН', toothbrush: 'ЗУБНАЯ_ЩЕТКА'
};

const calculateDistance = (p: any, videoElement: HTMLVideoElement, videoWidth: number, videoHeight: number): number => {
  const objectHeightPixels = p.bbox[3];
  const objectYCenter = p.bbox[1] + p.bbox[3] / 2;
  const knownObjectHeight = KNOWN_OBJECT_SIZES[p.class] || KNOWN_OBJECT_SIZES['default'];

  let dist = 10;
  if (videoElement && objectHeightPixels > 0) {
    const verticalFovRadians = (50 * Math.PI) / 180;
    const focalLengthPixels = (videoHeight / 2) / Math.tan(verticalFovRadians / 2);
    
    dist = (knownObjectHeight * focalLengthPixels) / objectHeightPixels;

    const cameraHeightAboveGround = 1.6;
    const verticalCenterNormalized = (objectYCenter / videoHeight);

    if (verticalCenterNormalized > 0.7) {
        const angleFromHorizontal = (verticalCenterNormalized - 0.5) * verticalFovRadians;
        const groundDistance = cameraHeightAboveGround / Math.tan(Math.PI / 2 - angleFromHorizontal);
        dist = Math.min(dist, groundDistance + 1);
    }
  }
  return Math.max(0.5, Math.min(100, dist));
};

// Replaced WS_SERVER_URL and WS_ROOM_ID with localStorage keys
const LOCAL_STORAGE_KEY = 'aegis_multiplayer_db';
const ROOM_ID = 'agent-mkn3sq1r'; // Still need a conceptual room ID for localStorage
const FADE_OUT_TIME_MS = 1500; // Define globally for consistency

const App: React.FC = () => {
  const [booting, setBooting] = useState(true);
  
  const [isVisionLiteReady, setIsVisionLiteReady] = useState(false);
  const [isVisionHeavyReady, setIsVisionHeavyReady] = useState(false);
  const [isGeminiReady, setIsGeminiReady] = useState(false);
  const [isGeolocationReady, setIsGeolocationReady] = useState(false);
  const [isNetworkReady, setIsNetworkReady] = useState(false); // Now indicates localStorage/simulated DB readiness

  const [loadProgress, setLoadProgress] = useState(0); 

  const [zoom, setZoom] = useState(1.0);
  const [logs, setLogs] = useState<TacticalLog[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  
  const [localTargets, setLocalTargets] = useState<Target[]>([]);
  const [syncedRemoteTargets, setSyncedRemoteTargets] = useState<Target[]>([]); 

  const [currentAiStream, setCurrentAiStream] = useState('');
  const [currentUserStream, setCurrentUserStream] = useState('');
  const [historySubtitles, setHistorySubtitles] = useState<Subtitle[]>([]);
  
  const [showFullAvatar, setShowFullAvatar] = useState(false);
  const [showFullMap, setShowFullMap] = useState(false);
  const [outputLevel, setOutputLevel] = useState(0);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);

  const [myId] = useState(() => Math.random().toString(36).substr(2, 6).toUpperCase());

  // isMonitoringActive is now true if localStorage operations are working
  const sendTargetsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  
  const trackedObjectsRef = useRef<Map<string, Target>>(new Map());

  // WebRTC related refs removed


  const userStreamClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiStreamClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback((message: string, level: TacticalLog['level'] = 'INFO') => {
    const newLog: TacticalLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      message,
      level
    };
    setLogs(prev => [newLog, ...prev].slice(0, 15));
  }, []);

  const isInitialLoadingComplete = useMemo(() => {
    return isVisionHeavyReady && isGeminiReady && isGeolocationReady && isNetworkReady;
  }, [isVisionHeavyReady, isGeminiReady, isGeolocationReady, isNetworkReady]);

  const isSystemProcessing = useMemo(() => {
    // isMonitoringActive is now determined by whether localStorage is accessible
    return isThinking || (isNetworkReady && isVisionLiteReady);
  }, [isThinking, isNetworkReady, isVisionLiteReady]);


  const targets = useMemo(() => {
    const combined = new Map<string, Target>();

    // Add remote targets
    syncedRemoteTargets.forEach(t => combined.set(t.id, t));
    // Add local targets, ensuring they override remote if IDs conflict
    localTargets.forEach(t => combined.set(t.id, t));

    // All targets (local or remote) are subject to fade out if not refreshed
    return Array.from(combined.values()).filter((t: Target) => (Date.now() - t.timestamp < FADE_OUT_TIME_MS));
  }, [localTargets, syncedRemoteTargets]);


  // --- Database-like Synchronization via localStorage ---

  // Writes a user's local targets to localStorage
  const writeTargetsToLocalStorage = useCallback((userId: string, roomId: string, targetsToStore: Target[]) => {
    try {
      const dbString = localStorage.getItem(LOCAL_STORAGE_KEY) || '{}';
      const db = JSON.parse(dbString);
      if (!db[roomId]) {
        db[roomId] = {};
      }
      // Clean up old entries from current user to prevent stale data
      for (const key in db[roomId]) {
        if (key === userId) {
          // Only update the current user's targets, others are handled by their own instances
          db[roomId][userId] = targetsToStore.filter(t => t.ownerId === userId); 
        } else {
          // For other users, remove targets older than FADE_OUT_TIME_MS
          db[roomId][key] = (db[roomId][key] || []).filter((t: Target) => (Date.now() - t.timestamp < FADE_OUT_TIME_MS));
        }
      }
      
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(db));
      setIsNetworkReady(true);
    } catch (e) {
      console.error("Failed to write targets to localStorage:", e);
      addLog("СЕТЬ: Ошибка записи целей в локальное хранилище.", "ALERT");
      setIsNetworkReady(false);
    }
  }, [addLog]);

  // Reads all targets from localStorage for a given room, excluding current user's targets
  const readTargetsFromLocalStorage = useCallback((roomId: string, currentUserId: string): Target[] => {
    try {
      const dbString = localStorage.getItem(LOCAL_STORAGE_KEY) || '{}';
      const db = JSON.parse(dbString);
      const roomData = db[roomId] || {};
      let allRemoteTargets: Target[] = [];

      // Also clean up old entries when reading
      let updatedRoomData = { ...roomData };
      for (const userId in roomData) {
        if (userId !== currentUserId) {
          updatedRoomData[userId] = (roomData[userId] || []).filter((t: Target) => (Date.now() - t.timestamp < FADE_OUT_TIME_MS));
          allRemoteTargets = allRemoteTargets.concat(updatedRoomData[userId]);
        }
      }
      // Save the cleaned state back to localStorage to prevent continuous accumulation of stale data
      db[roomId] = updatedRoomData;
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(db));

      setIsNetworkReady(true);
      return allRemoteTargets;
    } catch (e) {
      console.error("Failed to read targets from localStorage:", e);
      addLog("СЕТЬ: Ошибка чтения целей из локального хранилища.", "ALERT");
      setIsNetworkReady(false);
      return [];
    }
  }, [addLog]);

  const uploadLocalTargetsToDB = useCallback((targetsToPush: Target[]) => {
    if (sendTargetsDebounceRef.current) {
      clearTimeout(sendTargetsDebounceRef.current);
    }
    sendTargetsDebounceRef.current = setTimeout(() => {
      writeTargetsToLocalStorage(myId, ROOM_ID, targetsToPush);
      addLog(`СЕТЬ: Отправлено ${targetsToPush.length} локальных целей в "базу данных".`, "INFO");
    }, 500); // Debounce by 500ms
  }, [myId, writeTargetsToLocalStorage, addLog]);

  // Periodically fetch remote targets
  useEffect(() => {
    let syncInterval: ReturnType<typeof setInterval>;
    if (booting) return; // Wait for boot sequence to complete

    if (isVisionHeavyReady && isGeminiReady && isGeolocationReady) { // Only sync if main systems are ready
      syncInterval = setInterval(() => {
        const remoteTargets = readTargetsFromLocalStorage(ROOM_ID, myId);
        setSyncedRemoteTargets(remoteTargets);
      }, 500); // Check for updates every 500ms
    }

    return () => {
      if (syncInterval) clearInterval(syncInterval);
    };
  }, [booting, isVisionHeavyReady, isGeminiReady, isGeolocationReady, myId, readTargetsFromLocalStorage]);


  // Get User Geolocation
  useEffect(() => {
    if ('geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setUserLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          setIsGeolocationReady(true);
        },
        (error) => {
          console.error('Geolocation error:', error);
          addLog(`ГЕОЛОКАЦИЯ: ОШИБКА (${error.message})`, "WARN");
          setIsGeolocationReady(false);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      addLog('ГЕОЛОКАЦИЯ: НЕ ПОДДЕРЖИВАЕТСЯ', "WARN");
      setIsGeolocationReady(false);
    }
  }, [addLog]);

  useEffect(() => {
    if (booting) return;
    let isMounted = true;
    const initVision = async () => {
      try {
        tf.setBackend('webgl');
        addLog("TF.js backend установлен на WebGL.", "INFO");

        const totalLoadSteps = 100;
        let currentProgress = 0;

        const updateProgressAndLog = async (percentageIncrement: number, message: string, delayMs = 100) => {
          if (!isMounted) return;
          currentProgress = Math.min(totalLoadSteps, currentProgress + percentageIncrement);
          setLoadProgress(Math.floor(currentProgress));
          addLog(message, "INFO");
          await new Promise(resolve => setTimeout(resolve, delayMs));
        };

        await updateProgressAndLog(5, "Инициализация TF.js движка...");
        await updateProgressAndLog(5, "Загрузка архитектуры модели AEGIS-LITE...");
        const liteModel = await (window as any).cocoSsd.load({ base: 'lite_mobilenet_v2' });
        if (!isMounted) return;
        modelRef.current = liteModel;
        setIsVisionLiteReady(true);
        await updateProgressAndLog(20, "Базовое видение AEGIS-LITE активировано. (25%)");
        
        await updateProgressAndLog(5, "Предварительная загрузка данных AEGIS-HEAVY...");
        await updateProgressAndLog(5, "Загрузка весов модели AEGIS-HEAVY (высокая точность)...");
        const heavyModel = await (window as any).cocoSsd.load({ base: 'mobilenet_v2' });
        if (!isMounted) return;
        modelRef.current = heavyModel;
        setIsVisionHeavyReady(true);
        await updateProgressAndLog(50, "Система AEGIS обновлена до версии ULTRA. (80%)");
        
        await updateProgressAndLog(10, "Калибровка внутренних систем...");
        setLoadProgress(100);
        addLog("СИСТЕМЫ ПАРАЛЛЕЛЬНОГО ОБНАРУЖЕНИЯ АКТИВНЫ", "INFO");
      } catch (e) {
        addLog("КРИТИЧЕСКАЯ ОШИБКА ВИДЕОМОДУЛЯ", "ALERT");
        console.error("Error loading models:", e);
        setIsVisionLiteReady(false);
        setIsVisionHeavyReady(false);
      }
    };
    initVision();
    return () => { isMounted = false; };
  }, [booting, addLog]);

  useEffect(() => {
    let animId: number;
    const loop = async () => {
      if (videoRef.current?.readyState === 4 && modelRef.current && (isVisionLiteReady || isVisionHeavyReady)) { 
        // Changed minConfidence to 0.7 (70%)
        const predictions = await modelRef.current.detect(videoRef.current, 6, 0.7);
        const videoWidth = videoRef.current.videoWidth;
        const videoHeight = videoRef.current.videoHeight;

        const nextTrackedObjects = new Map<string, Target>();
        
        const SMOOTHING_ALPHA = 0.4;
        const AI_MARKED_SMOOTHING_ALPHA = 0.2;

        const MERGE_THRESHOLD_PX = 0.1 * Math.max(videoWidth, videoHeight); 
        // FADE_OUT_TIME_MS defined globally

        predictions.forEach((prediction: any) => {
            const rawX = (prediction.bbox[0] + prediction.bbox[2] / 2);
            const rawY = (prediction.bbox[1] + prediction.bbox[3] / 2);

            let bestMatchId: string | null = null;
            let minDistance = Infinity;

            for (const [id, trackedObject] of trackedObjectsRef.current.entries()) {
                if (trackedObject.label !== (translationMap[prediction.class] || prediction.class.toUpperCase())) {
                    continue;
                }
                
                const trackedPixelX = (trackedObject.x / 100) * videoWidth;
                const trackedPixelY = (trackedObject.y / 100) * videoHeight;

                const distance = Math.sqrt(
                    Math.pow(rawX - trackedPixelX, 2) +
                    Math.pow(rawY - trackedPixelY, 2)
                );

                if (distance < MERGE_THRESHOLD_PX && distance < minDistance) {
                    minDistance = distance;
                    bestMatchId = id;
                }
            }

            const newTargetData: Target = {
                id: '',
                label: translationMap[prediction.class] || prediction.class.toUpperCase(),
                x: (rawX / videoWidth) * 100,
                y: (rawY / videoHeight) * 100,
                w: (prediction.bbox[2] / videoWidth) * 100,
                h: (prediction.bbox[3] / videoHeight) * 100,
                threatLevel: prediction.class === 'person' ? 'MEDIUM' : 'LOW',
                type: 'OBJECT',
                timestamp: Date.now(),
                distance: calculateDistance(prediction, videoRef.current!, videoWidth, videoHeight),
                ownerId: myId
            };

            if (bestMatchId && trackedObjectsRef.current.has(bestMatchId)) {
                const existing = trackedObjectsRef.current.get(bestMatchId)!;
                const currentSmoothing = existing.isAiMarked ? AI_MARKED_SMOOTHING_ALPHA : SMOOTHING_ALPHA;

                nextTrackedObjects.set(bestMatchId, {
                    ...existing,
                    x: existing.x * (1 - currentSmoothing) + newTargetData.x * currentSmoothing,
                    y: existing.y * (1 - currentSmoothing) + newTargetData.y * currentSmoothing,
                    w: existing.w * (1 - currentSmoothing) + newTargetData.w * currentSmoothing,
                    h: existing.h * (1 - currentSmoothing) + newTargetData.h * currentSmoothing,
                    distance: existing.distance! * (1 - currentSmoothing) + newTargetData.distance! * currentSmoothing,
                    timestamp: Date.now(),
                    isAnchoredToView: false // Object is actively tracked, not anchored
                });
            } else {
                newTargetData.id = `${newTargetData.label.substring(0,4).toUpperCase()}-${myId}-${Math.random().toString(36).substr(2, 9)}`;
                nextTrackedObjects.set(newTargetData.id, newTargetData);
            }
        });

        // AI-marked targets are now also subject to FADE_OUT_TIME_MS if not re-detected.
        // They will keep their last known screen position during fade-out.
        trackedObjectsRef.current.forEach((trackedObject: Target, id) => {
            if (!nextTrackedObjects.has(id) && (Date.now() - trackedObject.timestamp < FADE_OUT_TIME_MS)) {
                nextTrackedObjects.set(id, { 
                  ...trackedObject, 
                  timestamp: Date.now(), // Refresh timestamp for fade out logic
                  isAnchoredToView: trackedObject.isAiMarked ? true : false // Keep anchored behavior for AI-marked during fade
                }); 
            }
        });
        
        trackedObjectsRef.current = nextTrackedObjects;
      }
      animId = requestAnimationFrame(loop);
    };
    
    if (isVisionLiteReady || isVisionHeavyReady) {
      loop();
    }

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isVisionLiteReady, isVisionHeavyReady, myId]);

  useEffect(() => {
    let updateInterval: ReturnType<typeof setInterval>;
    if (isVisionLiteReady || isVisionHeavyReady) {
      updateInterval = setInterval(() => {
        const currentTracked = Array.from(trackedObjectsRef.current.values()).filter((t: Target) => 
            (Date.now() - t.timestamp < FADE_OUT_TIME_MS) // All targets, including AI-marked, respect fade-out
        );
        setLocalTargets(currentTracked);
        uploadLocalTargetsToDB(currentTracked); // Use new database-like upload function
      }, 33);
    }
    return () => {
      if (updateInterval) clearInterval(updateInterval);
      if (sendTargetsDebounceRef.current) clearTimeout(sendTargetsDebounceRef.current);
    };
  }, [isVisionLiteReady, isVisionHeavyReady, uploadLocalTargetsToDB]);

  const sendVisionSummaryToGemini = useCallback((objects: Target[]) => {
    if (!sessionRef.current || !isGeminiReady) return;

    const summary = objects.map(t => 
        `${t.label} ${Math.round(t.distance || 0)}м ${t.x > 60 ? 'справа' : (t.x < 40 ? 'слева' : 'по центру')}`
    ).join(', ');

    if (summary) {
        sessionRef.current?.sendRealtimeInput({ message: `ВИЗУАЛЬНАЯ СВОДКА: В поле зрения: ${summary}. Есть ли что-то, что нужно пометить или описать подробнее?` });
    }
  }, [isGeminiReady]);

  const debouncedSendVisionSummary = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isGeminiReady && (isVisionLiteReady || isVisionHeavyReady)) {
      // Changed interval from 1500ms to 500ms for improved understanding
      debouncedSendVisionSummary.current = setInterval(() => {
        const currentTracked = Array.from(trackedObjectsRef.current.values()).filter((t: Target) => 
            (Date.now() - t.timestamp < FADE_OUT_TIME_MS) && !t.isAiMarked
        );
        if (currentTracked.length > 0) {
            sendVisionSummaryToGemini(currentTracked);
        }
      }, 500); // Send summary every 0.5 seconds
    } else {
      if (debouncedSendVisionSummary.current) {
        clearInterval(debouncedSendVisionSummary.current);
        debouncedSendVisionSummary.current = null;
      }
    }
    return () => {
      if (debouncedSendVisionSummary.current) clearInterval(debouncedSendVisionSummary.current);
    };
  }, [isGeminiReady, isVisionLiteReady, isVisionHeavyReady, sendVisionSummaryToGemini]);


  useEffect(() => {
    const render = () => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      targets.forEach(target => {
        let dX = (target.x / 100) * canvas.width;
        let dY = (target.y / 100) * canvas.height;
        const dW = (target.w / 100) * canvas.width;
        const dH = (target.h / 100) * canvas.height;

        // Apply anchoring logic for AI-marked targets during fade-out
        if (target.isAnchoredToView && videoRef.current) {
            // Keep AI-marked targets at their last known screen position relative to the frame
            // This is a simple interpretation of "not move with the camera" in 2D
            // More complex world-anchoring would require 3D scene understanding.
        }

        const dist = target.distance || 10;
        
        const thickness = Math.max(1.5, 6 - (dist / 3));
        const blurAmount = Math.min(3, Math.max(0, (dist - 8) / 4));

        const isLocal = target.ownerId === myId;
        const color = target.isAiMarked ? COLORS.ORANGE : (isLocal ? "#FFFFFF" : COLORS.CYAN);

        ctx.save();
        if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.shadowBlur = target.isAiMarked ? 18 : 12; 
        ctx.shadowColor = color;

        const p = 12; 
        const l = dX - dW/2 - p; const r = dX + dW/2 + p;
        const t = dY - dH/2 - p; const b_ = dY + dH/2 + p;
        const cl = Math.min(dW, dH) * 0.35; 

        ctx.beginPath();
        ctx.moveTo(l, t + cl); ctx.lineTo(l, t); ctx.lineTo(l + cl, t);
        ctx.moveTo(r - cl, t); ctx.lineTo(r, t); ctx.lineTo(r, t + cl);
        ctx.moveTo(l, b_ - cl); ctx.lineTo(l, b_); ctx.lineTo(l + cl, b_);
        ctx.moveTo(r - cl, b_); ctx.lineTo(r, b_); ctx.lineTo(r, b_ - cl);
        ctx.stroke();
        ctx.restore();

        ctx.font = 'bold 11px "Press Start 2P"'; 
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom'; 

        const labelText = `${target.label} // ${Math.round(dist)}М`;
        const textMetrics = ctx.measureText(labelText);
        const textWidth = textMetrics.width;
        const textHeight = parseInt(ctx.font, 10);

        const labelPaddingX = 10;
        const labelPaddingY = 6;
        const labelRectWidth = textWidth + labelPaddingX * 2;
        const labelRectHeight = textHeight + labelPaddingY * 2;

        const labelX = dX;
        const labelY = t - 18;

        const labelRectLeft = labelX - labelRectWidth / 2;
        const labelRectTop = labelY - labelRectHeight + 5;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(labelRectLeft, labelRectTop, labelRectWidth, labelRectHeight);

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(labelRectLeft, labelRectTop, labelRectWidth, labelRectHeight);

        ctx.fillStyle = color;
        ctx.shadowBlur = 5;
        ctx.shadowColor = color;
        ctx.fillText(labelText, labelX, labelY - labelPaddingY);

        ctx.beginPath();
        ctx.setLineDash([5, 3]);
        ctx.moveTo(dX, t + 4);
        ctx.lineTo(labelX, labelRectTop + labelRectHeight);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.setLineDash([]);
      });
      requestAnimationFrame(render);
    };
    render();
  }, [targets, myId]);


  const handleLiveMessage = useCallback(async (message: LiveServerMessage) => {
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && audioContextRef.current) {
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContextRef.current.currentTime);
      const decoded = decode(base64Audio);
      const audioBuffer = await decodeAudioData(decoded, audioContextRef.current, 24000, 1);
      const data = new Int16Array(decoded.buffer);
      let sum = 0; for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]);
      setOutputLevel(sum / data.length / 32768);
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outputNodeRef.current!);
      source.addEventListener('ended', () => setOutputLevel(0));
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
    }

    if (message.serverContent?.inputTranscription) {
      setCurrentUserStream(prev => {
        const newText = prev + message.serverContent!.inputTranscription!.text;
        if (userStreamClearTimeoutRef.current) {
          clearTimeout(userStreamClearTimeoutRef.current);
        }
        userStreamClearTimeoutRef.current = setTimeout(() => {
          setCurrentUserStream('');
          userStreamClearTimeoutRef.current = null;
        }, 5000);
        return newText;
      });
      setIsThinking(true);
    }
    if (message.serverContent?.outputTranscription) {
      setCurrentAiStream(prev => {
        const newText = prev + message.serverContent!.outputTranscription!.text;
        if (aiStreamClearTimeoutRef.current) {
          clearTimeout(aiStreamClearTimeoutRef.current);
        }
        aiStreamClearTimeoutRef.current = setTimeout(() => {
          setCurrentAiStream('');
          aiStreamClearTimeoutRef.current = null;
        }, 5000);
        return newText;
      });
    }

    if (message.serverContent?.turnComplete) {
      setIsThinking(false);
      
      if (userStreamClearTimeoutRef.current) clearTimeout(userStreamClearTimeoutRef.current);
      if (aiStreamClearTimeoutRef.current) clearTimeout(aiStreamClearTimeoutRef.current);

      if (currentUserStream) {
        setHistorySubtitles(prev => [...prev.slice(-3), { id: Math.random().toString(), text: currentUserStream, type: 'USER' }]);
        setCurrentUserStream('');
      }
      if (currentAiStream) {
        setHistorySubtitles(prev => [...prev.slice(-3), { id: Math.random().toString(), text: currentAiStream, type: 'AI' }]);
        setCurrentAiStream('');
      }
    }

    if (message.toolCall) {
      for (const fc of message.toolCall.functionCalls || []) {
        const args = fc.args as any;
        if (fc.name === 'setVisualZoom') setZoom(args.level || 1.0);
        if (fc.name === 'toggleFullMap') setShowFullMap(prev => !prev);
        if (fc.name === 'toggleFullAvatar') setShowFullAvatar(prev => !prev);
        if (fc.name === 'markTarget') {
          const aiMarkedLabel = translationMap[args.label.toLowerCase()] || args.label.toUpperCase();
          const markId = `AI-${myId}-${aiMarkedLabel}`;
          
          const newAiTarget: Target = { 
            id: markId,
            label: aiMarkedLabel,
            x: args.x, y: args.y, w: 10, h: 10,
            threatLevel: args.threatLevel || 'LOW', type: 'AI_MARK',
            timestamp: Date.now(), 
            distance: args.distance || 5, 
            isAiMarked: true, 
            isAnchoredToView: true,
            ownerId: myId
          };

          trackedObjectsRef.current.set(newAiTarget.id, newAiTarget);
          
          addLog(`AEGIS: МАРКЕР ОБЪЕКТА [${newAiTarget.label}] ДОБАВЛЕН [${Math.round(newAiTarget.distance || 0)}М]`, "INFO");
        }
        if (fc.id) {
          sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } });
        } else {
          console.warn('Function call received without an ID, cannot send tool response:', fc);
        }
      }
    }
  }, [myId, currentAiStream, currentUserStream, addLog]);

  const startAegis = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true }, 
        video: { width: 1280, height: 720, frameRate: 60 } 
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputNodeRef.current = audioContextRef.current.createGain();
      outputNodeRef.current.connect(audioContextRef.current.destination);

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      sessionRef.current = await ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const ctx = new AudioContext({ sampleRate: 16000 });
            const src = ctx.createMediaStreamSource(stream);
            // FIX: Reduced buffer size for lower audio latency
            const proc = ctx.createScriptProcessor(1024, 1, 1); // Reduced from 2048
            proc.onaudioprocess = (e) => {
              const data = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(data.length);
              for(let i=0; i<data.length; i++) int16[i] = data[i] * 32768;
              sessionRef.current?.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
            };
            src.connect(proc); proc.connect(ctx.destination);
            
            setInterval(() => {
              if (canvasRef.current && videoRef.current) {
                const c = canvasRef.current.getContext('2d');
                c?.drawImage(videoRef.current, 0, 0, 640, 480);
                canvasRef.current.toBlob(b => {
                  if (b) {
                    const r = new FileReader();
                    r.onloadend = () => sessionRef.current?.sendRealtimeInput({ media: { data: (r.result as string).split(',')[1], mimeType: 'image/jpeg' } });
                    r.readAsDataURL(b);
                  }
                }, 'image/jpeg', 0.3);
              }
            }, 3000);
          },
          onmessage: handleLiveMessage
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [
            { name: 'setVisualZoom', parameters: { type: Type.OBJECT, properties: { level: { type: Type.NUMBER } } } },
            { name: 'markTarget', parameters: { type: Type.OBJECT, properties: { 
                label: { type: Type.STRING }, x: { type: Type.NUMBER }, y: { type: Type.NUMBER },
                distance: { type: Type.NUMBER }, threatLevel: { type: Type.STRING }
            }, required: ['label', 'x', 'y'] } },
            { name: 'toggleFullMap', parameters: { type: Type.OBJECT, properties: {} } },
            { name: 'toggleFullAvatar', parameters: { type: Type.OBJECT, properties: {} } }
          ] }]
        }
      });
      setIsGeminiReady(true);
    } catch(e) { 
      addLog("СЕНСОРНЫЙ СБОЙ / ОШИБКА GEMINI LIVE", "ALERT"); 
      setIsGeminiReady(false);
    }
  };

  useEffect(() => {
    if (!booting) {
      startAegis();
    }
  }, [booting]);

  useEffect(() => {
    return () => {
      if (userStreamClearTimeoutRef.current) clearTimeout(userStreamClearTimeoutRef.current);
      if (aiStreamClearTimeoutRef.current) clearTimeout(aiStreamClearTimeoutRef.current);
    };
  }, []);

  if (booting) return <BootSequence onComplete={() => { setBooting(false); }} />;

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden select-none font-['Rajdhani']">
      {showFullMap && <div className="map-expanded-overlay" onClick={() => setShowFullMap(false)} />}

      {/* BACKGROUND VIDEO */}
      <div className="absolute inset-0 transition-transform duration-700" style={{ transform: `scale(${zoom})` }}>
        <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
      </div>

      <canvas ref={overlayCanvasRef} width={window.innerWidth} height={window.innerHeight} className="absolute inset-0 z-10 pointer-events-none" />
      <canvas ref={canvasRef} width="640" height="480" className="hidden" />

      {/* INSTALLATION OVERLAY */}
      {!isInitialLoadingComplete ? (
        <div className="absolute top-0 left-0 right-0 z-[100]">
           <div className="installation-bar" style={{ width: `${loadProgress}%` }} />
           <div className="pixel-font mt-4 ml-12 text-[12px] tracking-[0.3em] font-bold drop-shadow-md">
              {loadProgress < 100 ? (
                  <>
                      ИНИЦИАЛИЗАЦИЯ AEGIS CORE... {loadProgress}%<br/>
                      <span className={`text-[8px] opacity-50 ${isVisionLiteReady ? 'text-green-400' : 'text-orange-400'}`}>ВИДЕНИЕ LITE: {isVisionLiteReady ? 'ОК' : 'ОЖИДАНИЕ'}</span> |&nbsp;
                      <span className={`text-[8px] opacity-50 ${isVisionHeavyReady ? 'text-green-400' : 'text-orange-400'}`}>ВИДЕНИЕ ULTRA: {isVisionHeavyReady ? 'ОК' : 'ОЖИДАНИЕ'}</span> |&nbsp;
                      <span className={`text-[8px] opacity-50 ${isGeminiReady ? 'text-green-400' : 'text-orange-400'}`}>GEMINI LIVE: {isGeminiReady ? 'ОК' : 'ОЖИДАНИЕ'}</span> |&nbsp;
                      <span className={`text-[8px] opacity-50 ${isGeolocationReady ? 'text-green-400' : 'text-orange-400'}`}>ГЕОЛОКАЦИЯ: {isGeolocationReady ? 'ОК' : 'ОЖИДАНИЕ'}</span> |&nbsp;
                      <span className={`text-[8px] opacity-50 ${isNetworkReady ? 'тАКТИВНО' : 'ОЖИДАНИЕ'} `}>СЕТЬ: {isNetworkReady ? 'АКТИВНО' : 'ОЖИДАНИЕ'}</span>
                  </>
              ) : 'СИСТЕМЫ ПАРАЛЛЕЛЬНОГО ОБНАРУЖЕНИЯ АКТИВНЫ'}
           </div>
        </div>
      ) : null}

      {/* HUD INTERFACE */}
      <div className="absolute top-16 left-16 right-16 flex justify-between items-start z-30 pointer-events-none">
        <div className="space-y-8 pointer-events-auto">
          <div className="pixel-font">
            <div className="flex items-center gap-6 mb-4">
               <span className="text-[20px] font-bold tracking-tighter drop-shadow-lg">ID_{myId}</span>
               <span className={`w-5 h-5 rounded-full ${isThinking ? 'bg-red-600 animate-pulse shadow-[0_0_15px_red]' : 'bg-white/30'}`}></span>
            </div>
            <div className="hud-data space-y-2 font-bold uppercase">
               <div>ОПТИКА: x{zoom.toFixed(1)}</div>
               <div>СЕТЬ: {isNetworkReady ? 'АКТИВНО' : 'ОФЛАЙН'}</div>
            </div>
          </div>
          
          {/* Replaced log display with a clickable element to open the modal */}
          <button 
            onClick={() => setShowLogModal(true)}
            className="hud-data pixel-font text-[10px] text-cyan-400 mt-4 px-6 py-3 border border-cyan-700 hover:border-cyan-400 bg-black/30 backdrop-blur-sm shadow-[0_0_15px_rgba(0,255,255,0.2)] hover:shadow-[0_0_25px_rgba(0,255,255,0.4)] transition-all duration-200 cursor-pointer w-fit"
          >
            СИСТЕМНЫЙ_ЖУРНАЛ
          </button>
        </div>

        {/* PROMINENT AVATAR & TACTICAL MAP */}
        <div className="flex flex-col items-end gap-12 pointer-events-auto z-40">
          <TacticalMap3D 
            targets={targets} 
            myId={myId} 
            isFullMode={showFullMap} 
            onToggleFullMode={() => setShowFullMap(!showFullMap)} 
            userLocation={userLocation} 
          />

          <div 
            onClick={() => setShowFullAvatar(true)} 
            className="w-80 h-80 rounded-full overflow-hidden cursor-pointer border-4 border-white/30 hover:border-white/90 transition-all shadow-[0_0_60px_rgba(255,255,255,0.2)] relative"
          >
            <Avatar3D intensity={outputLevel * 6} modelUrl={null} />
            <div className="absolute inset-0 border-4 border-white/10 rounded-full pointer-events-none"></div>
          </div>
          <button 
            onClick={() => { /* Implement actual tactical channel functionality if needed */ }}
            className="pixel-font text-[12px] border-4 border-white/40 px-12 py-6 hover:bg-white/90 hover:text-black transition-all font-bold tracking-[0.3em] bg-black/30 backdrop-blur-md shadow-[0_0_20px_rgba(255,255,255,0.2)]"
          >
             ТАКТИЧЕСКИЙ_КАНАЛ
          </button>
        </div>
      </div>

      {/* STREAMING SUBTITLES */}
      <div className="absolute bottom-40 left-0 right-0 z-[60] flex flex-col items-center gap-4 pointer-events-none px-40">
         {historySubtitles.map(s => (
           <div 
             key={s.id} 
             className={`fading-subtitle pixel-font text-center tracking-tight ${s.type === 'AI' ? 'text-orange-300 text-[10px] ai-subtitle-shadow' : 'text-white text-[11px]'}`}
           >
             {s.text}
           </div>
         ))}
         
         {(currentUserStream || currentAiStream) && (
           <div 
             className={`subtitle-stream pixel-font text-center max-w-6xl font-bold tracking-tight ${currentAiStream ? 'text-orange-400 text-[16px] ai-stream-shadow' : 'text-white text-[18px]'}`}
           >
             {currentAiStream || currentUserStream}
           </div>
         )}
      </div>

      {/* BOTTOM PANEL */}
      <div className="absolute bottom-12 left-16 right-16 flex justify-between items-end z-20 pointer-events-none">
        <div className="flex flex-col gap-6">
           <div className={`system-activity-indicator ${isSystemProcessing ? 'active' : ''}`}>
             {[...Array(5)].map((_, i) => (
                <div key={i} className="segment" style={{ animationDelay: `${i * 0.1}s` }}></div>
             ))}
           </div>
           <div className="pixel-font hud-data opacity-50 font-bold tracking-[0.6em] uppercase text-cyan-500 drop-shadow-[0_0_8px_rgba(0,255,255,0.4)]">AEGIS_QUANTUM_SIGNAL_v2.5</div>
        </div>
        <div className="pixel-font text-[32px] font-bold border-b-4 border-white pb-4 opacity-95 drop-shadow-xl tracking-widest text-white">AEGIS_HUD</div>
      </div>

      {/* FULL AVATAR MODE */}
      {showFullAvatar && (
        <div className="absolute inset-0 z-[100] bg-black/98 backdrop-blur-3xl flex flex-col items-center justify-center p-32 animate-in fade-in duration-500">
           <button onClick={() => setShowFullAvatar(false)} className="absolute top-24 right-24 pixel-font text-[20px] p-6 border-4 border-white/40 uppercase tracking-[0.4em] hover:bg-white/90 hover:text-black transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)]">ЗАКРЫТЬ [ESC]</button>
           <div className="w-full h-full max-w-7xl max-h-[85vh]">
              <Avatar3D intensity={outputLevel * 10} modelUrl={null} isFullMode={true} />
           </div>
           <div className="absolute bottom-32 pixel-font text-center w-full px-48">
              <div className="text-[32px] font-bold mb-10 tracking-tighter uppercase max-w-[85%] mx-auto leading-normal drop-shadow-[0_0_25px_rgba(255,255,255,0.6)]">
                 {currentAiStream || "СИСТЕМА СИНХРОНИЗИРОВАНА. СЛУШАЮ ВАС..."}
              </div>
              <div className="text-[14px] opacity-40 tracking-[4em] uppercase animate-pulse text-cyan-400">ВИРТУАЛЬНОЕ_ЯДРО_АКТИВНО</div>
           </div>
        </div>
      )}

      {/* Log Modal */}
      <LogModal show={showLogModal} onClose={() => setShowLogModal(false)} logs={logs} />
    </div>
  );
};

export default App;