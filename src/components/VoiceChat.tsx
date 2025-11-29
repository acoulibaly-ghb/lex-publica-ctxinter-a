import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { SYSTEM_INSTRUCTION } from '../constants';
import { createPcmBlob, decodeAudioData } from '../utils/audio-utils';
import Visualizer from './Visualizer';

const VoiceChat: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'listening' | 'speaking'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  
  // Transcription state
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [transcriptionHistory, setTranscriptionHistory] = useState<{role: 'user' | 'model', text: string}[]>([]);

  // Refs for audio context and processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Refs for playback
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  
  // Ref for session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const transcriptionRef = useRef('');
  const historyRef = useRef<HTMLDivElement>(null);

  const API_KEY = import.meta.env.VITE_API_KEY;

  const analyzeAudio = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    
    // Normalize somewhat (0-100 range approx)
    const vol = Math.min(100, average * 2.5);
    setVolume(vol);

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  };

  useEffect(() => {
      if (historyRef.current) {
          historyRef.current.scrollTop = historyRef.current.scrollHeight;
      }
  }, [transcriptionHistory, currentTranscription]);

  const cleanupAudio = () => {
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    scheduledSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    scheduledSourcesRef.current = [];
    nextStartTimeRef.current = 0;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const stopSession = () => {
    cleanupAudio();
    setIsConnected(false);
    setStatus('disconnected');
    setVolume(0);
    setCurrentTranscription('');
    transcriptionRef.current = '';
    sessionPromiseRef.current = null;
  };

  const startSession = async () => {
    setError(null);
    setStatus('connecting');
    setTranscriptionHistory([]);

    if (!API_KEY) {
        setError("Clé API manquante (process.env.API_KEY).");
        setStatus('disconnected');
        return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
      
      // Browser policy: resume context if suspended
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      const inputContext = new AudioContextClass({ sampleRate: 16000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Setup Analyser
      const analyser = inputContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      
      const source = inputContext.createMediaStreamSource(stream);
      const processor = inputContext.createScriptProcessor(4096, 1, 1);
      
      inputSourceRef.current = source;
      processorRef.current = processor;

      // Connect graph: Source -> Analyser -> Processor -> Destination
      source.connect(analyser);
      source.connect(processor);
      processor.connect(inputContext.destination);

      // Start visualizer loop
      analyzeAudio();

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM_INSTRUCTION,
      };

      const sessionPromise = ai.live.connect({
        model: config.model,
        config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: config.systemInstruction,
            outputAudioTranscription: {}, // Corrected: Empty object to enable default transcription
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setStatus('listening');
            console.log("Gemini Live Session Opened");
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcription
            if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                transcriptionRef.current += text;
                setCurrentTranscription(transcriptionRef.current);
            }
            
            if (message.serverContent?.turnComplete) {
                 if (transcriptionRef.current) {
                    setTranscriptionHistory(prev => [...prev, { role: 'model', text: transcriptionRef.current }]);
                    transcriptionRef.current = '';
                    setCurrentTranscription('');
                 }
            }

            // Handle Audio
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            
            if (base64Audio && audioContextRef.current) {
              setStatus('speaking');
              try {
                const audioBuffer = await decodeAudioData(base64Audio, audioContextRef.current);
                
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContextRef.current.destination);
                
                const currentTime = audioContextRef.current.currentTime;
                const startTime = Math.max(currentTime, nextStartTimeRef.current);
                source.start(startTime);
                
                nextStartTimeRef.current = startTime + audioBuffer.duration;
                scheduledSourcesRef.current.push(source);
                
                source.onended = () => {
                   const index = scheduledSourcesRef.current.indexOf(source);
                   if (index > -1) {
                     scheduledSourcesRef.current.splice(index, 1);
                   }
                   if (scheduledSourcesRef.current.length === 0) {
                       setStatus('listening');
                   }
                };
              } catch (err) {
                console.error("Audio decoding error", err);
              }
            }

            if (message.serverContent?.interrupted) {
               scheduledSourcesRef.current.forEach(src => {
                   try { src.stop(); } catch(e) {}
               });
               scheduledSourcesRef.current = [];
               nextStartTimeRef.current = 0;
               transcriptionRef.current = ''; // Clear partial transcription on interrupt
               setCurrentTranscription('');
               setStatus('listening');
            }
          },
          onclose: () => {
            stopSession();
          },
          onerror: (err) => {
            console.error("Session error", err);
            setError("Erreur de connexion. Vérifiez votre API Key ou la console.");
            stopSession();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createPcmBlob(inputData);
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
            });
        }
      };

    } catch (err) {
      console.error("Failed to start session", err);
      setError("Impossible d'accéder au microphone.");
      setStatus('disconnected');
    }
  };

  useEffect(() => {
    return () => {
      if (isConnected) {
        stopSession();
      }
    };
  }, [isConnected]);

  // Helper for Orb Color
  const getOrbColor = () => {
    switch(status) {
        case 'connecting': return 'bg-amber-400 shadow-[0_0_60px_rgba(251,191,36,0.4)]';
        case 'listening': return 'bg-indigo-500 shadow-[0_0_60px_rgba(99,102,241,0.6)]';
        case 'speaking': return 'bg-emerald-400 shadow-[0_0_80px_rgba(52,211,153,0.6)]';
        default: return 'bg-slate-500 shadow-none';
    }
  };

  // Dynamic scaling based on volume
  const getScale = () => {
      if (status === 'disconnected') return 0.9;
      if (status === 'connecting') return 1;
      const baseScale = 1;
      const volumeScale = Math.max(0, volume / 150); 
      return baseScale + volumeScale;
  };

  return (
    <div className="flex flex-col h-[600px] bg-[#0f172a] relative overflow-hidden transition-colors duration-700">
      {/* Animated Background */}
      <div className="absolute inset-0 z-0">
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[120px] opacity-20 transition-all duration-1000 ${
            status === 'listening' ? 'bg-indigo-600' : status === 'speaking' ? 'bg-emerald-600' : 'bg-slate-800'
        }`}></div>
      </div>

      {/* Content Container */}
      <div className="flex-1 flex flex-col z-10 relative">
          
          {/* Top Half: Orb & Status */}
          <div className="flex-1 flex flex-col items-center justify-center min-h-[300px]">
            {/* Status Text */}
            <div className="mb-8 h-8">
                <span className={`text-sm font-medium tracking-[0.2em] uppercase transition-all duration-300 ${
                    status === 'disconnected' ? 'text-slate-500' : 'text-white/90'
                }`}>
                    {status === 'disconnected' && 'Prêt à commencer'}
                    {status === 'connecting' && 'Connexion...'}
                    {status === 'listening' && 'Je vous écoute'}
                    {status === 'speaking' && 'Je réponds'}
                </span>
            </div>

            {/* The ORB */}
            <div className="relative mb-8 group">
                {/* Pulse Rings */}
                <div className={`absolute inset-0 rounded-full transition-colors duration-500 ${status === 'listening' ? 'bg-indigo-500' : status === 'speaking' ? 'bg-emerald-400' : 'bg-transparent'} opacity-20 animate-ping ${status === 'disconnected' ? 'hidden' : ''}`}></div>
                
                {/* Core Orb */}
                <div 
                    className={`w-24 h-24 rounded-full relative z-10 transition-all duration-200 ease-out flex items-center justify-center ${getOrbColor()} ${status === 'disconnected' ? 'opacity-50 grayscale' : 'scale-100'}`}
                    style={{ transform: `scale(${getScale()})` }}
                >
                    <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/30 flex items-center justify-center overflow-hidden shadow-inner">
                        {status === 'speaking' ? (
                            <div className="flex gap-1 h-8 items-center justify-center">
                            {[1,2,3,4,5].map((i) => (
                                <div key={i} className="w-1 bg-white rounded-full animate-[music_0.8s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.1}s`, height: `${20 + Math.random() * 60}%` }}></div>
                            ))}
                            </div>
                        ) : status === 'listening' ? (
                            <div className="w-16 h-16 rounded-full border-2 border-white/20 animate-[spin_4s_linear_infinite]">
                                <div className="w-full h-full rounded-full border-t-2 border-white/60"></div>
                            </div>
                        ) : (
                            <svg className="w-8 h-8 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                        )}
                    </div>
                </div>
            </div>

            <div className="h-8 w-full max-w-xs opacity-80">
                <Visualizer isActive={status !== 'disconnected'} mode={status === 'speaking' ? 'speaking' : status === 'listening' ? 'listening' : 'idle'} volume={volume} />
            </div>
          </div>

          {/* Bottom Half: Live Transcriptions */}
          {isConnected && (
             <div className="h-48 w-full bg-slate-900/50 backdrop-blur-sm border-t border-slate-800 p-4 overflow-y-auto scroll-smooth" ref={historyRef}>
                <div className="space-y-3 max-w-2xl mx-auto">
                    {transcriptionHistory.map((item, i) => (
                        <div key={i} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                             <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${item.role === 'user' ? 'bg-slate-800 text-slate-300' : 'bg-indigo-900/40 text-indigo-100 border border-indigo-500/30'}`}>
                                {item.text}
                             </div>
                        </div>
                    ))}
                    {/* Current Real-time stream */}
                    {currentTranscription && (
                        <div className="flex justify-start">
                            <div className="max-w-[80%] rounded-xl px-3 py-2 text-sm bg-emerald-900/40 text-emerald-100 border border-emerald-500/30 animate-pulse">
                                {currentTranscription}
                            </div>
                        </div>
                    )}
                </div>
             </div>
          )}
      </div>

      {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 px-6 py-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-200 text-sm backdrop-blur-md z-30">
                {error}
            </div>
      )}

      {/* Controls */}
      <div className="p-6 z-20 flex justify-center items-center bg-slate-900 border-t border-slate-800">
        {!isConnected ? (
          <button
            onClick={startSession}
            className="group relative inline-flex items-center justify-center px-8 py-3 font-semibold text-white transition-all duration-300 bg-indigo-600 rounded-xl hover:bg-indigo-500 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(99,102,241,0.4)] focus:outline-none"
          >
            <span className="mr-3 text-lg tracking-wide">Démarrer la conversation</span>
            <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
          </button>
        ) : (
          <button
            onClick={stopSession}
            className="inline-flex items-center justify-center px-8 py-3 font-medium text-red-100 transition-all duration-300 bg-red-500/20 border border-red-500/30 rounded-xl hover:bg-red-500/30 hover:border-red-500/60"
          >
             <div className="w-2.5 h-2.5 bg-red-400 rounded-full mr-3 animate-pulse"></div>
             Terminer la session
          </button>
        )}
      </div>
      
      <style>{`
        @keyframes music {
          0%, 100% { height: 20%; }
          50% { height: 80%; }
        }
      `}</style>
    </div>
  );
};

export default VoiceChat;
