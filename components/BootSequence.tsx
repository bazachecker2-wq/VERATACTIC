
import React, { useState, useEffect } from 'react';
import { BOOT_SEQUENCE_LOGS, COLORS } from '../constants';

interface BootSequenceProps {
  onComplete: () => void;
}

const BootSequence: React.FC<BootSequenceProps> = ({ onComplete }) => {
  const [visibleLogs, setVisibleLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let currentIdx = 0;
    const interval = setInterval(() => {
      if (currentIdx < BOOT_SEQUENCE_LOGS.length) {
        setVisibleLogs(prev => [...prev, BOOT_SEQUENCE_LOGS[currentIdx]]);
        setProgress(((currentIdx + 1) / BOOT_SEQUENCE_LOGS.length) * 100);
        currentIdx++;
      } else {
        clearInterval(interval);
        setTimeout(onComplete, 1000);
      }
    }, 400); // Ускорен интервал вывода логов
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-[100] font-mono border-8 border-orange-900/10">
      <div className="w-[600px] space-y-10">
        <div className="flex justify-between items-end">
          <h1 className="text-5xl font-bold tracking-widest text-orange-500 uppercase">AEGIS OS v2.5</h1>
          <span className="text-2xl text-orange-700 font-bold">{progress.toFixed(0)}%</span>
        </div>
        
        <div className="h-3 bg-orange-900/30 w-full overflow-hidden rounded-full">
          <div 
            className="h-full bg-orange-500 transition-all duration-300 shadow-[0_0_25px_rgba(255,127,0,0.9)]" 
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="h-72 overflow-hidden space-y-3 text-lg opacity-90 text-orange-400 font-bold">
          {visibleLogs.map((log, i) => (
            <div key={i} className="animate-in slide-in-from-left duration-300">
              <span className="text-orange-900 mr-4">[{new Date().toLocaleTimeString()}]</span>
              {log}
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-20 text-sm tracking-[0.6em] opacity-40 text-orange-600 font-bold uppercase">
        СИСТЕМА ТАКТИЧЕСКОЙ ПОДДЕРЖКИ AEGIS // СТРОГО КОНФИДЕНЦИАЛЬНО
      </div>
    </div>
  );
};

export default BootSequence;
