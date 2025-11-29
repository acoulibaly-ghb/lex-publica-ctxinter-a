
import React from 'react';

interface VisualizerProps {
  isActive: boolean;
  mode: 'listening' | 'speaking' | 'idle';
  volume?: number;
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, mode, volume = 0 }) => {
  const barCount = 20; 
  
  return (
    <div className="flex items-center justify-center h-full gap-1">
      {Array.from({ length: barCount }).map((_, i) => {
        // Create a symmetric wave pattern base height
        const center = barCount / 2;
        const dist = Math.abs(i - center);
        
        // Calculate dynamic height based on volume
        // Bars closer to center react more to volume
        const sensitivity = 1 - (dist / center); 
        const dynamicHeight = Math.max(4, (volume * sensitivity * 0.8) + Math.random() * 5);
        
        let heightStyle = {};
        let colorClass = "bg-white/10";
        
        if (isActive) {
            if (mode === 'listening') {
                // Breathing wave effect when listening
                colorClass = "bg-indigo-400/80";
                heightStyle = {
                    height: `${8 + Math.sin(Date.now() / 200 + i) * 4}px`
                };
            } else if (mode === 'speaking') {
                // Reactive to volume when speaking
                colorClass = "bg-emerald-400";
                heightStyle = {
                    height: `${Math.min(40, dynamicHeight)}px`,
                    transition: 'height 0.05s ease'
                };
            }
        } else {
            // Idle state
            heightStyle = { height: '4px' };
        }

        return (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-colors duration-300 ${colorClass}`}
            style={heightStyle}
          />
        );
      })}
    </div>
  );
};

export default Visualizer;
