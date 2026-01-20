
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import BootSequence from './components/BootSequence';
import Avatar3D from './components/Avatar3D';
import { HUDMode, TacticalLog, Target, PeerMessage } from './types';
import { COLORS, SYSTEM_INSTRUCTION } from './constants';
import { encode, decode, decodeAudioData } from './services/audioHelper';

interface Subtitle {
  id: string;
  text: string;
  type: 'AI' | 'USER';
}

const App: React.FC = () => {
  const [booting, setBooting] = useState(true);
  const [isSystemReady, setIsSystemReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [logs, setLogs] = useState<TacticalLog[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  
  const [currentAiStream, setCurrentAiStream] = useState('');
  const [currentUserStream, setCurrentUserStream] = useState('');
  const [historySubtitles, setHistorySubtitles] = useState<Subtitle[]>([]);
  
  const [showFullAvatar, setShowFullAvatar] = useState(false);
  const [outputLevel, setOutputLevel] = useState(0);

  const [myId] = useState(() => Math.random().toString(36).substr(2, 6).toUpperCase());
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map());

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const smoothedTargetsRef = useRef<Map<string, any>>(new Map());

  const addLog = useCallback((message: string, level: TacticalLog['level'] = 'INFO') => {
    const newLog: TacticalLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      message,
      level
    };
    setLogs(prev => [newLog, ...prev].slice(0, 15));
  }, []);

  const syncToPeers = useCallback((data: any) => {
    dataChannels.current.forEach(ch => {
      if (ch.readyState === 'open') ch.send(JSON.stringify(data));
    });
  }, []);

  // WebRTC Networking
  useEffect(() => {
    if (booting) return;
    const connectWS = () => {
        const ws = new WebSocket('ws://localhost:8080'); 
        wsRef.current = ws;
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'join', userId: myId, room: 'tactical-alpha' }));
            ws.send(JSON.stringify({ type: 'broadcast', data: { type: 'HELLO', senderId: myId } }));
            addLog("СЕТЕВОЙ МОДУЛЬ: ПОДКЛЮЧЕНО", "INFO");
        };
        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'signal') handlePeerSignal(data.senderId, data.signal);
            else if (data.type === 'broadcast') {
                if (data.data.type === 'HELLO') createPeerConnection(data.data.senderId, true);
                else handleBroadcastData(data.data);
            }
        };
        ws.onclose = () => {
            addLog("СЕТЕВОЙ МОДУЛЬ: ПОТЕРЯ СВЯЗИ", "WARN");
            setTimeout(connectWS, 5000);
        };
    };
    connectWS();
    return () => wsRef.current?.close();
  }, [booting, myId, addLog]);

  const handlePeerSignal = async (peerId: string, signal: any) => {
      let pc = peerConnections.current.get(peerId);
      if (!pc) pc = createPeerConnection(peerId, false);
      if (signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          if (signal.sdp.type === 'offer') {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              wsRef.current?.send(JSON.stringify({ type: 'signal', targetId: peerId, signal: { sdp: pc.localDescription } }));
          }
      } else if (signal.candidate) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
  };

  const createPeerConnection = (peerId: string, isInitiator: boolean) => {
      if (peerConnections.current.has(peerId)) return peerConnections.current.get(peerId)!;
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peerConnections.current.set(peerId, pc);
      pc.onicecandidate = (e) => {
          if (e.candidate) wsRef.current?.send(JSON.stringify({ type: 'signal', targetId: peerId, signal: { candidate: e.candidate } }));
      };
      const setupChannel = (channel: RTCDataChannel) => {
          dataChannels.current.set(peerId, channel);
          channel.onopen = () => {
              setConnectedPeers(prev => [...new Set([...prev, peerId])]);
              addLog(`СИНХРОНИЗАЦИЯ С ${peerId}`, "INFO");
          };
          channel.onmessage = (e) => handleBroadcastData(JSON.parse(e.data));
      };
      if (isInitiator) {
          const channel = pc.createDataChannel('tactical_sync');
          setupChannel(channel);
          pc.createOffer().then(offer => {
              pc.setLocalDescription(offer);
              wsRef.current?.send(JSON.stringify({ type: 'signal', targetId: peerId, signal: { sdp: offer } }));
          });
      } else pc.ondatachannel = (e) => setupChannel(e.channel);
      return pc;
  };

  const handleBroadcastData = (data: any) => {
      if (data.type === 'TARGET_UPDATE') {
          setTargets(prev => [...prev.filter(t => t.id !== data.data.id), { ...data.data, timestamp: Date.now() }]);
      }
  };

  // Lite -> Heavy Model Loading
  useEffect(() => {
    if (booting) return;
    let isMounted = true;
    const initVision = async () => {
      try {
        setLoadProgress(10);
        addLog("ЗАГРУЗКА ЯДРА AEGIS-LITE...", "INFO");
        const liteModel = await (window as any).cocoSsd.load({ base: 'lite_mobilenet_v2' });
        if (!isMounted) return;
        modelRef.current = liteModel;
        setIsSystemReady(true);
        setLoadProgress(50);
        addLog("БАЗОВОЕ ВИДЕНИЕ: АКТИВИРОВАНO", "INFO");

        addLog("ЗАГРУЗКА AEGIS-HEAVY (ВЫСОКАЯ ТОЧНОСТЬ)...", "INFO");
        const heavyModel = await (window as any).cocoSsd.load({ base: 'mobilenet_v2' });
        if (!isMounted) return;
        modelRef.current = heavyModel;
        setLoadProgress(100);
        addLog("СИСТЕМА ОБНОВЛЕНА ДО ВЕРСИИ ULTRA", "INFO");
      } catch (e) {
        addLog("КРИТИЧЕСКАЯ ОШИБКА ВИДЕОМОДУЛЯ", "ALERT");
      }
    };
    initVision();
    return () => { isMounted = false; };
  }, [booting, addLog]);

  // Object Detection Loop
  useEffect(() => {
    let animId: number;
    const loop = async () => {
      if (videoRef.current?.readyState === 4 && modelRef.current && isSystemReady) {
        const predictions = await modelRef.current.detect(videoRef.current, 8, 0.45);
        const newTargets = predictions.map((p: any) => {
          const area = p.bbox[2] * p.bbox[3];
          // Расстояние: чем больше площадь, тем меньше дистанция (нормировано под 1280x720)
          const dist = Math.max(0.5, 35 * (1 - Math.min(1, area / (1280 * 720 * 0.45))));
          return {
            id: `${p.class}-${myId}`,
            label: p.class.toUpperCase() === 'PERSON' ? 'ЧЕЛОВЕК' : p.class.toUpperCase(),
            x: ((p.bbox[0] + p.bbox[2] / 2) / videoRef.current!.videoWidth) * 100,
            y: ((p.bbox[1] + p.bbox[3] / 2) / videoRef.current!.videoHeight) * 100,
            w: (p.bbox[2] / videoRef.current!.videoWidth) * 100,
            h: (p.bbox[3] / videoRef.current!.videoHeight) * 100,
            threatLevel: p.class === 'person' ? 'MEDIUM' : 'LOW',
            type: 'OBJECT',
            timestamp: Date.now(),
            distance: dist,
            ownerId: myId
          };
        });
        setTargets(prev => [...prev.filter(t => t.ownerId !== myId && (Date.now() - t.timestamp < 3500)), ...newTargets]);
        newTargets.forEach(t => syncToPeers({ type: 'TARGET_UPDATE', data: t }));
      }
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [isSystemReady, myId, syncToPeers]);

  // HUD Graphics Engine: Depth-based Styles
  useEffect(() => {
    const render = () => {
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      targets.forEach(target => {
        const cur = smoothedTargetsRef.current.get(target.id) || { x: target.x, y: target.y, w: target.w, h: target.h };
        const nx = cur.x + (target.x - cur.x) * 0.2;
        const ny = cur.y + (target.y - cur.y) * 0.2;
        const nw = cur.w + (target.w - cur.w) * 0.15;
        const nh = cur.h + (target.h - cur.h) * 0.15;
        smoothedTargetsRef.current.set(target.id, { x: nx, y: ny, w: nw, h: nh });

        const dX = (nx / 100) * canvas.width;
        const dY = (ny / 100) * canvas.height;
        const dW = (nw / 100) * canvas.width;
        const dH = (nh / 100) * canvas.height;

        const dist = target.distance || 10;
        
        // Визуальные эффекты глубины
        // Близкие (dist < 3): толстые линии, четкие
        // Дальние (dist > 15): тонкие линии, размытие
        const thickness = Math.max(1, 6 - (dist / 4));
        const blurAmount = Math.min(3.5, Math.max(0, (dist - 8) / 4));
        
        const isLocal = target.ownerId === myId;
        const color = target.isAiMarked ? COLORS.ORANGE : (isLocal ? "#FFFFFF" : COLORS.CYAN);

        ctx.save();
        if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.shadowBlur = target.isAiMarked ? 15 : 10;
        ctx.shadowColor = color;

        const p = 10;
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

        // Текст всегда четкий
        ctx.fillStyle = color;
        ctx.font = 'bold 12px "Press Start 2P"';
        ctx.shadowBlur = 0;
        ctx.fillText(`${target.label} // ${dist.toFixed(1)}М`, l, t - 15);
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
      setCurrentUserStream(prev => prev + message.serverContent!.inputTranscription!.text);
      setIsThinking(true);
    }
    if (message.serverContent?.outputTranscription) {
      setCurrentAiStream(prev => prev + message.serverContent!.outputTranscription!.text);
    }

    if (message.serverContent?.turnComplete) {
      setIsThinking(false);
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
      for (const fc of message.toolCall.functionCalls) {
        const args = fc.args as any;
        if (fc.name === 'setVisualZoom') setZoom(args.level || 1.0);
        if (fc.name === 'markTarget') {
          const t: Target = { 
            id: `AI-${Date.now()}`, label: args.label.toUpperCase(), 
            x: args.x, y: args.y, w: 10, h: 10, 
            threatLevel: args.threatLevel || 'LOW', type: 'AI_MARK',
            timestamp: Date.now(), distance: args.distance || 3, isAiMarked: true, ownerId: myId
          };
          setTargets(p => [...p, t]);
          syncToPeers({ type: 'TARGET_UPDATE', data: t });
          addLog(`ОБЪЕКТ ВЫДЕЛЕН ИИ: ${args.label}`, "INFO");
        }
        sessionRef.current?.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } });
      }
    }
  }, [myId, syncToPeers, currentAiStream, currentUserStream, addLog]);

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
            const proc = ctx.createScriptProcessor(2048, 1, 1);
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
                }, 'image/jpeg', 0.4);
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
            { name: 'setVisualZoom', parameters: { type: 'OBJECT' as any, properties: { level: { type: 'NUMBER' as any } } } },
            { name: 'markTarget', parameters: { type: 'OBJECT' as any, properties: { 
                label: { type: 'STRING' as any }, x: { type: 'NUMBER' as any }, y: { type: 'NUMBER' as any },
                distance: { type: 'NUMBER' as any }, threatLevel: { type: 'STRING' as any }
            }, required: ['label', 'x', 'y'] } }
          ] }]
        }
      });
    } catch(e) { addLog("СЕНСОРНЫЙ СБОЙ", "ALERT"); }
  };

  if (booting) return <BootSequence onComplete={() => { setBooting(false); startAegis(); }} />;

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden select-none font-['Rajdhani']">
      
      {/* BACKGROUND VIDEO */}
      <div className="absolute inset-0 transition-transform duration-700" style={{ transform: `scale(${zoom})` }}>
        <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
      </div>

      <canvas ref={overlayCanvasRef} width={window.innerWidth} height={window.innerHeight} className="absolute inset-0 z-10 pointer-events-none" />
      <canvas ref={canvasRef} width="640" height="480" className="hidden" />

      {/* INSTALLATION OVERLAY */}
      {!isSystemReady || loadProgress < 100 ? (
        <div className="absolute top-0 left-0 right-0 z-[100]">
           <div className="installation-bar" style={{ width: `${loadProgress}%` }} />
           <div className="pixel-font mt-4 ml-12 text-[12px] tracking-[0.3em] font-bold drop-shadow-md">
              {loadProgress < 100 ? `ИНИЦИАЛИЗАЦИЯ AEGIS CORE... ${loadProgress}%` : 'СИСТЕМЫ ПАРАЛЛЕЛЬНОГО ОБНАРУЖЕНИЯ АКТИВНЫ'}
           </div>
        </div>
      ) : null}

      {/* HUD INTERFACE */}
      <div className="absolute top-16 left-16 right-16 flex justify-between items-start z-30 pointer-events-none">
        <div className="space-y-8 pointer-events-auto">
          <div className="pixel-font">
            <div className="flex items-center gap-6 mb-4">
               <span className="text-[20px] font-bold tracking-tighter drop-shadow-lg">ID_{myId}</span>
               <span className={`w-4 h-4 rounded-full ${isThinking ? 'bg-red-600 animate-pulse shadow-[0_0_15px_red]' : 'bg-white/30'}`}></span>
            </div>
            <div className="hud-data space-y-2 font-bold uppercase">
               <div>ОПТИКА: x{zoom.toFixed(1)}</div>
               <div>СЕТЬ: {connectedPeers.length ? `СИНХРОНИЗАЦИЯ [${connectedPeers.length}]` : 'ЛОКАЛЬНЫЙ РЕЖИМ'}</div>
            </div>
          </div>
          
          <div className="h-96 overflow-hidden">
            <div className="space-y-3 opacity-60 font-bold">
               {logs.map(l => (
                 <div key={l.id} className="pixel-font lowercase text-[8px]">
                   <span className="opacity-30 mr-3">[{l.timestamp}]</span> {l.message}
                 </div>
               ))}
            </div>
          </div>
        </div>

        {/* PROMINENT AVATAR */}
        <div className="flex flex-col items-end gap-12 pointer-events-auto">
          <div 
            onClick={() => setShowFullAvatar(true)} 
            className="w-64 h-64 rounded-full overflow-hidden cursor-pointer border-2 border-white/20 hover:border-white/70 transition-all shadow-[0_0_40px_rgba(255,255,255,0.1)] relative"
          >
            <Avatar3D intensity={outputLevel * 6} modelUrl={null} />
            <div className="absolute inset-0 border-2 border-white/5 rounded-full pointer-events-none"></div>
          </div>
          <button className="pixel-font text-[10px] border-2 border-white/30 px-10 py-4 hover:bg-white hover:text-black transition-all font-bold tracking-[0.2em] bg-black/20 backdrop-blur-sm">
             ТАКТИЧЕСКИЙ_КАНАЛ
          </button>
        </div>
      </div>

      {/* STREAMING SUBTITLES */}
      <div className="absolute bottom-40 left-0 right-0 z-[60] flex flex-col items-center gap-4 pointer-events-none px-40">
         {historySubtitles.map(s => (
           <div key={s.id} className="fading-subtitle pixel-font text-[10px] opacity-20 text-center tracking-tight">
             {s.text}
           </div>
         ))}
         
         {(currentUserStream || currentAiStream) && (
           <div className={`subtitle-stream pixel-font text-[18px] text-center max-w-6xl font-bold tracking-tight ${currentAiStream ? 'text-cyan-400' : 'text-white'}`}>
             {currentAiStream || currentUserStream}
           </div>
         )}
      </div>

      {/* BOTTOM PANEL */}
      <div className="absolute bottom-12 left-16 right-16 flex justify-between items-end z-20 pointer-events-none">
        <div className="flex flex-col gap-6">
           <div className="flex gap-2 h-14 items-end opacity-20">
              {[...Array(40)].map((_, i) => (
                <div key={i} className="w-1 bg-white" style={{ height: `${10 + Math.random() * 90}%` }}></div>
              ))}
           </div>
           <div className="pixel-font hud-data opacity-40 font-bold tracking-[0.5em] uppercase">AEGIS_QUANTUM_SIGNAL_v2.5</div>
        </div>
        <div className="pixel-font text-[28px] font-bold border-b-4 border-white pb-4 opacity-90 drop-shadow-xl tracking-widest">AEGIS_HUD</div>
      </div>

      {/* FULL AVATAR MODE */}
      {showFullAvatar && (
        <div className="absolute inset-0 z-[100] bg-black/98 backdrop-blur-3xl flex flex-col items-center justify-center p-32 animate-in fade-in duration-500">
           <button onClick={() => setShowFullAvatar(false)} className="absolute top-24 right-24 pixel-font text-[18px] p-4 border-2 border-white/30 uppercase tracking-[0.3em]">ЗАКРЫТЬ [ESC]</button>
           <div className="w-full h-full max-w-7xl max-h-[85vh]">
              <Avatar3D intensity={outputLevel * 10} modelUrl={null} isFullMode={true} />
           </div>
           <div className="absolute bottom-32 pixel-font text-center w-full px-48">
              <div className="text-[28px] font-bold mb-10 tracking-tighter uppercase max-w-[85%] mx-auto leading-normal drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]">
                 {currentAiStream || "СИСТЕМА СИНХРОНИЗИРОВАНА. СЛУШАЮ ВАС..."}
              </div>
              <div className="text-[12px] opacity-30 tracking-[3em] uppercase animate-pulse">ВИРТУАЛЬНОЕ_ЯДРО_АКТИВНО</div>
           </div>
        </div>
      )}

    </div>
  );
};

export default App;
