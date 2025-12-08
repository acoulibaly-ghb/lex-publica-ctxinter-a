import React, { useState } from 'react';
import { ChatMode } from './types';
import TextChat from './components/TextChat';
import VoiceChat from './components/VoiceChat';

const App: React.FC = () => {
  const [mode, setMode] = useState<ChatMode>(ChatMode.TEXT);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-700">
      {/* Background decoration */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-200/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-200/20 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        <header className="mb-10 text-center space-y-4">
          <div className="inline-flex items-center justify-center p-4 bg-white rounded-2xl shadow-lg shadow-indigo-100 ring-1 ring-indigo-50 mb-2 transform hover:scale-105 transition-transform duration-300">
             <svg className="w-10 h-10 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"></path></svg>
          </div>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl mb-2">
              Lex publica IA <span className="text-4xl font-extrabold tracking-tight text-slate-400 sm:text-5xl mb-2"> by </span><span className="text-indigo-600">Coulibaly</span>
            </h1>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
              Votre assistante virtuelle experte en droit du contentieux international.
              <span className="block text-sm text-slate-400 mt-1 font-medium">Introduction générale • Première partie • Seconde partie</span>
            </p>
          </div>
        </header>

        <main className="w-full shadow-2xl shadow-indigo-200/50 rounded-3xl overflow-hidden bg-white ring-1 ring-slate-200/60">
          {/* Mode Switcher */}
          <div className="bg-slate-50/80 border-b border-slate-200 p-2">
            <div className="relative flex bg-slate-200/60 p-1 rounded-xl max-w-md mx-auto">
              <div 
                className={`absolute inset-y-1 w-1/2 bg-white rounded-lg shadow-sm transition-all duration-300 ease-out transform ${mode === ChatMode.TEXT ? 'translate-x-0' : 'translate-x-full'}`}
              ></div>
              <button
                onClick={() => setMode(ChatMode.TEXT)}
                className={`relative z-10 flex-1 py-2.5 text-sm font-bold rounded-lg transition-colors duration-300 flex items-center justify-center gap-2 ${
                  mode === ChatMode.TEXT ? 'text-indigo-700' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                Discussion Texte
              </button>
              <button
                onClick={() => setMode(ChatMode.VOICE)}
                className={`relative z-10 flex-1 py-2.5 text-sm font-bold rounded-lg transition-colors duration-300 flex items-center justify-center gap-2 ${
                  mode === ChatMode.VOICE ? 'text-indigo-700' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                Mode Vocal (Live)
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="bg-white min-h-[600px] relative">
             {mode === ChatMode.TEXT ? <TextChat /> : <VoiceChat />}
          </div>
        </main>
        
        <footer className="mt-12 text-center space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Basé sur le cours de M. Coulibaly 2025-2026</p>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <span>Propulsé par</span>
              <span className="flex items-center gap-1 font-bold text-slate-500">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                Google Gemini 2.5
              </span>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <span>Webmaster</span>
              <span className="flex items-center gap-1 font-bold text-slate-500">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                A. Coulibaly
              </span>
            </div>
        </footer>
      </div>
    </div>
  );
};

export default App;
