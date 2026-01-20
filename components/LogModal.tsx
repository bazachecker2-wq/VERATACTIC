
import React, { useEffect, useRef } from 'react';
import { TacticalLog } from '../types';
import { COLORS } from '../constants';

interface LogModalProps {
  show: boolean;
  onClose: () => void;
  logs: TacticalLog[];
}

const LogModal: React.FC<LogModalProps> = ({ show, onClose, logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new log or when modal opens
  useEffect(() => {
    if (show && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, show]);

  // Close with ESC key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    if (show) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-lg z-[110] flex items-center justify-center p-8 animate-in fade-in duration-300"
      onClick={onClose} // Close on backdrop click
    >
      <div 
        className="bg-black/90 border-4 border-cyan-700 shadow-[0_0_50px_rgba(0,255,255,0.4)] rounded-lg flex flex-col w-full max-w-4xl h-3/4 max-h-[800px] p-8 relative animate-in zoom-in duration-300"
        onClick={e => e.stopPropagation()} // Prevent closing when clicking inside modal
      >
        <h2 className="pixel-font text-2xl text-cyan-400 mb-6 border-b-2 border-cyan-700 pb-2 drop-shadow-[0_0_15px_rgba(0,255,255,0.6)]">
          СИСТЕМНЫЙ ЖУРНАЛ
        </h2>

        <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar pr-4">
          <div className="space-y-3 opacity-90 font-bold text-cyan-200">
            {logs.map(l => (
              <div 
                key={l.id} 
                className={`pixel-font text-[10px] drop-shadow-[0_0_5px_rgba(0,255,255,0.4)] transition-opacity duration-300 ease-out 
                            ${l.level === 'WARN' ? 'text-yellow-400 drop-shadow-[0_0_5px_rgba(255,255,0,0.4)]' : ''}
                            ${l.level === 'ALERT' ? 'text-red-500 drop-shadow-[0_0_5px_rgba(255,0,0,0.6)]' : ''}`}
              >
                <span className="opacity-60 mr-3">[{l.timestamp}]</span> {l.message}
              </div>
            ))}
          </div>
        </div>

        <button 
          onClick={onClose} 
          className="pixel-font text-[12px] border-2 border-cyan-700 px-6 py-3 mt-6 self-end hover:border-cyan-400 hover:text-cyan-400 bg-black/50 shadow-[0_0_10px_rgba(0,255,255,0.2)] hover:shadow-[0_0_20px_rgba(0,255,255,0.4)] transition-all duration-200 uppercase"
        >
          ЗАКРЫТЬ [ESC]
        </button>
      </div>
    </div>
  );
};

export default LogModal;
