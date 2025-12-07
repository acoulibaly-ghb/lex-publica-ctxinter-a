import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { Message, ChatSession, ChatMode } from '../types';
import { SYSTEM_INSTRUCTION } from '../constants';
import { decodeAudioData, playAudioBuffer } from '../utils/audio-utils';
import { fileToBase64 } from '../utils/file-utils';

// --- Markdown Component Helper ---
const parseBold = (text: string) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold underline decoration-indigo-300/50 underline-offset-2">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

const SimpleMarkdown = ({ text, isUser }: { text: string, isUser: boolean }) => {
  if (!text) return null;
  
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: React.ReactNode[] = [];

  const flushList = (key: string) => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={key} className="list-disc pl-5 mb-4 space-y-2 marker:text-indigo-400">
          {[...currentList]}
        </ul>
      );
      currentList = [];
    }
  };

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // Titles (###)
    if (line.startsWith('### ')) {
      flushList(`list-before-${index}`);
      elements.push(
        <h3 key={`h3-${index}`} className={`text-lg font-bold mt-6 mb-3 ${isUser ? 'text-white' : 'text-indigo-800'}`}>
          {parseBold(line.replace('### ', ''))}
        </h3>
      );
    } 
    // Titles (##)
    else if (line.startsWith('## ')) {
        flushList(`list-before-${index}`);
        elements.push(
          <h2 key={`h2-${index}`} className={`text-xl font-bold mt-7 mb-4 ${isUser ? 'text-white' : 'text-indigo-900'}`}>
            {parseBold(line.replace('## ', ''))}
          </h2>
        );
      }
    // Titles (#### or #####) -> Bold Paragraphs
    else if (line.startsWith('#### ') || line.startsWith('##### ')) {
        flushList(`list-before-${index}`);
        elements.push(
          <p key={`h-bold-${index}`} className={`font-bold mt-4 mb-2 ${isUser ? 'text-white' : 'text-indigo-700'}`}>
            {parseBold(line.replace(/#{4,5} /, ''))}
          </p>
        );
    }
    // List items
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      currentList.push(
        <li key={`item-${index}`} className="pl-1">
          {parseBold(line.replace(/^[-*] /, ''))}
        </li>
      );
    } 
    // Standard paragraphs
    else {
      if (trimmedLine !== '') {
        flushList(`list-before-${index}`);
        elements.push(
          <p key={`p-${index}`} className="mb-4 last:mb-0">
            {parseBold(line)}
          </p>
        );
      } else {
          // Empty line, maybe flush list
          flushList(`list-before-${index}`);
      }
    }
  });

  flushList('list-end');

  return <div className={`text-[15px] ${isUser ? 'leading-relaxed' : 'leading-8'}`}>{elements}</div>;
};

const cleanTextForTTS = (text: string) => {
    return text
        .replace(/[*#]/g, '') 
        .replace(/- /g, '') 
        .trim();
};

// --- MAIN COMPONENT ---

const TextChat: React.FC = () => {
  // --- STATE ---
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  
  // Renaming state
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState("");

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [attachment, setAttachment] = useState<{ file: File; base64: string } | null>(null);
  
  // --- REFS ---
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef(false);

  const API_KEY = import.meta.env.VITE_API_KEY;

  const DEFAULT_WELCOME_MESSAGE: Message = { 
    role: 'model', 
    text: '### Bonjour !\n\nJe suis **Ada**, votre assistante juridique spécialisée en Contentieux International.\n\nJe peux vous aider sur les thèmes suivants :\n- **La Cour Internationale de Justice**\n- **Les procédures contentieuse et consultative**\n- **La responsabilité internationale de l\'État**\n\nQuelle est votre question ?', 
    timestamp: new Date() 
  };

  const suggestions = [
    "Définis ou explique...",
    "Soumets-moi un petit cas pratique",
    "Pose-moi un QCM",
    "Pose-moi une question Vrai/Faux"    
  ];

  // --- HISTORY MANAGEMENT ---

  useEffect(() => {
    const savedSessions = localStorage.getItem('juriste_admin_sessions');
    if (savedSessions) {
        try {
            const parsed: ChatSession[] = JSON.parse(savedSessions);
            // Filter for TEXT sessions only in this component
            const textSessions = parsed.filter(s => s.mode === ChatMode.TEXT);
            
            const hydratedSessions = textSessions.map(s => ({
                ...s,
                messages: s.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
            }));
            hydratedSessions.sort((a, b) => b.lastModified - a.lastModified);
            setSessions(hydratedSessions);
            
            if (hydratedSessions.length > 0) {
                loadSession(hydratedSessions[0]);
            } else {
                createNewSession();
            }
        } catch (e) {
            console.error("Failed to load sessions", e);
            createNewSession();
        }
    } else {
        createNewSession();
    }
  }, []);

  const saveSessionsToStorage = (updatedSessions: ChatSession[]) => {
      // We need to merge with VOICE sessions potentially stored
      const allSaved = localStorage.getItem('juriste_admin_sessions');
      let otherSessions: ChatSession[] = [];
      if (allSaved) {
          const parsed = JSON.parse(allSaved);
          otherSessions = parsed.filter((s: ChatSession) => s.mode !== ChatMode.TEXT);
      }
      const toSave = [...otherSessions, ...updatedSessions];
      localStorage.setItem('juriste_admin_sessions', JSON.stringify(toSave));
  };

  const createNewSession = () => {
      const newId = Date.now().toString();
      const newSession: ChatSession = {
          id: newId,
          title: 'Nouvelle conversation',
          messages: [DEFAULT_WELCOME_MESSAGE],
          lastModified: Date.now(),
          mode: ChatMode.TEXT
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newId);
      setMessages(newSession.messages);
      setShowHistory(false);
      saveSessionsToStorage([newSession, ...sessions]);
  };

  const loadSession = (session: ChatSession) => {
      setCurrentSessionId(session.id);
      setMessages(session.messages);
      setShowHistory(false);
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const newSessions = sessions.filter(s => s.id !== id);
      setSessions(newSessions);
      saveSessionsToStorage(newSessions);
      
      if (currentSessionId === id) {
          if (newSessions.length > 0) {
              loadSession(newSessions[0]);
          } else {
              createNewSession();
          }
      }
  };

  // --- RENAMING LOGIC ---
  const startEditing = (e: React.MouseEvent, session: ChatSession) => {
      e.stopPropagation();
      setEditingSessionId(session.id);
      setEditTitleInput(session.title);
  };

  const saveTitle = (id: string) => {
      const newSessions = sessions.map(s => 
          s.id === id ? { ...s, title: editTitleInput } : s
      );
      setSessions(newSessions);
      saveSessionsToStorage(newSessions);
      setEditingSessionId(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
      if (e.key === 'Enter') {
          saveTitle(id);
      }
  };

  const updateCurrentSession = (newMessages: Message[]) => {
      if (!currentSessionId) return;
      
      setMessages(newMessages);

      setSessions(prevSessions => {
          const updated = prevSessions.map(session => {
              if (session.id === currentSessionId) {
                  let title = session.title;
                  // Auto-title only if it's the default one
                  if (session.title === 'Nouvelle conversation' && newMessages.length > 1) {
                      const firstUserMsg = newMessages.find(m => m.role === 'user');
                      if (firstUserMsg) {
                          title = firstUserMsg.text.slice(0, 30) + (firstUserMsg.text.length > 30 ? '...' : '');
                      }
                  }
                  return {
                      ...session,
                      messages: newMessages,
                      title: title,
                      lastModified: Date.now()
                  };
              }
              return session;
          }).sort((a, b) => b.lastModified - a.lastModified);
          
          saveSessionsToStorage(updated);
          return updated;
      });
  };


  // --- UI EFFECTS ---

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  useEffect(() => {
    return () => {
        if (audioContextRef.current) {
            audioContextRef.current.close();
        }
    };
  }, []);

  // --- AUDIO LOGIC ---

  const processAudioQueue = async () => {
    if (isProcessingQueueRef.current || audioQueueRef.current.length === 0) return;
    
    isProcessingQueueRef.current = true;
    const textChunk = audioQueueRef.current.shift();

    if (textChunk) {
        try {
            await generateAndPlayTTS(textChunk);
        } catch (e) {
            console.error("Queue processing error", e);
        }
    }

    isProcessingQueueRef.current = false;
    if (audioQueueRef.current.length > 0) {
        processAudioQueue();
    } else {
        setIsPlayingAudio(false);
    }
  };

  const addToAudioQueue = (text: string) => {
      if (!text.trim()) return;
      audioQueueRef.current.push(text);
      setIsPlayingAudio(true);
      processAudioQueue();
  };

  const generateAndPlayTTS = async (text: string) => {
    if (!API_KEY) return;
    
    const cleanText = cleanTextForTTS(text);
    if (!cleanText) return;

    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: cleanText }] }],
            config: {
                responseModalities: [Modality.AUDIO], 
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) return;

        if (!audioContextRef.current) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
        }

        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        const audioBuffer = await decodeAudioData(base64Audio, audioContextRef.current);
        
        await new Promise<void>((resolve) => {
            if (!audioContextRef.current) { resolve(); return; }
            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);
            source.onended = () => resolve();
            source.start();
        });

    } catch (error) {
        console.error("Erreur TTS:", error);
    }
  };

  // --- HANDLERS ---

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const base64 = await fileToBase64(file);
        setAttachment({ file, base64 });
      } catch (err) {
        console.error("Error reading file", err);
      }
    }
  };

  const clearAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleQuizStart = () => sendMessage("Lance une session de quiz interactif. Pose-moi une question de cours pour me tester (collez-moi).");
  //04/12/2025 19:12:14 const handleWhoAmI = () => sendMessage("Qui êtes-vous ?");

  const sendMessage = async (text: string) => {
    if ((!text.trim() && !attachment) || isLoading) return;
    
    if (!API_KEY) {
        const errorMsg: Message = { role: 'model', text: "### Erreur de Configuration\n\nLa clé API est manquante. Vérifiez `VITE_API_KEY`.", timestamp: new Date() };
        updateCurrentSession([...messages, errorMsg]);
        return;
    }

    // Audio Reset
    if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
    }
    audioQueueRef.current = [];
    isProcessingQueueRef.current = false;
    setIsPlayingAudio(false);

    const userMsgText = attachment ? `[Fichier joint: ${attachment.file.name}] ${text}` : text;
    const userMsg: Message = { role: 'user', text: userMsgText, timestamp: new Date() };
    
    // Update UI with User Message immediately
    const msgsWithUser = [...messages, userMsg];
    updateCurrentSession(msgsWithUser);

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    
    const currentAttachment = attachment; 
    clearAttachment(); 
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      const parts: any[] = [];
      if (currentAttachment) {
        parts.push({
          inlineData: {
            mimeType: currentAttachment.file.type,
            data: currentAttachment.base64
          }
        });
      }
      if (text.trim()) {
        parts.push({ text: text });
      } else if (currentAttachment) {
        parts.push({ text: "Analyse ce document et résume-le." });
      }

      // Convert message history for context
      const historyContent = messages.map(m => ({
          role: m.role === 'model' ? 'model' : 'user',
          parts: [{ text: m.text }]
      }));

      const result = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: [...historyContent, { role: 'user', parts: parts }],
        config: {
            systemInstruction: SYSTEM_INSTRUCTION
        }
      });

      let fullText = '';
      let sentenceBuffer = '';
      
      const msgsWithModel = [...msgsWithUser, { role: 'model', text: '', timestamp: new Date() } as Message];
      updateCurrentSession(msgsWithModel);

      for await (const chunk of result) {
          const chunkText = chunk.text; 
          if (chunkText) {
            fullText += chunkText;
            sentenceBuffer += chunkText;
  
            updateCurrentSession(msgsWithModel.map((m, i) => 
                i === msgsWithModel.length - 1 ? { ...m, text: fullText } : m
            ));
  
            const sentences = sentenceBuffer.match(/[^.?!]+[.?!]+(\s|$)/g);
            if (sentences) {
                sentences.forEach(sentence => {
                    addToAudioQueue(sentence);
                });
                const lastMatch = sentences[sentences.length - 1];
                const lastIndex = sentenceBuffer.lastIndexOf(lastMatch);
                sentenceBuffer = sentenceBuffer.substring(lastIndex + lastMatch.length);
            }
          }
      }

      if (sentenceBuffer.trim()) {
          addToAudioQueue(sentenceBuffer);
      }

      setIsLoading(false);

    } catch (error) {
      console.error(error);
      const errorMsg: Message = {
        role: 'model',
        text: "### Erreur\n\nUne erreur est survenue lors du traitement.",
        timestamp: new Date()
      };
      updateCurrentSession([...msgsWithUser, errorMsg]);
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => sendMessage(input);

  // Icons
  const UserIcon = () => (
    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white shadow-md ring-2 ring-white">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
    </div>
  );

  const BotIcon = () => (
    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-md ring-2 ring-white relative">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"></path></svg>
      {isPlayingAudio && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-400 rounded-full animate-ping"></span>
      )}
    </div>
  );

  return (
    <div className="flex h-[600px] relative bg-slate-50/50 overflow-hidden">
      
      {/* SIDEBAR (HISTORY) - Width 80 (320px) */}
      <div 
        className={`absolute inset-y-0 left-0 z-30 w-80 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out ${showHistory ? 'translate-x-0' : '-translate-x-full'} flex flex-col border-r border-slate-100`}
      >
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="font-bold text-slate-700 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                Historique
              </h2>
              <button onClick={() => setShowHistory(false)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
          </div>
          
          <div className="p-4">
              <button 
                onClick={createNewSession}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all text-sm font-semibold shadow-sm active:scale-95"
              >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                  Nouvelle discussion
              </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 space-y-2 pb-4">
              {sessions.map(session => (
                  <div 
                    key={session.id}
                    className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border border-transparent ${currentSessionId === session.id ? 'bg-indigo-50 text-indigo-800 border-indigo-100 shadow-sm' : 'hover:bg-slate-50 text-slate-600 hover:border-slate-100'}`}
                    onClick={() => loadSession(session)}
                  >
                      <div className={`p-2 rounded-lg flex-shrink-0 ${currentSessionId === session.id ? 'bg-white text-indigo-500 shadow-sm' : 'bg-slate-100 text-slate-400 group-hover:bg-white'}`}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                      </div>
                      
                      {editingSessionId === session.id ? (
                          <input 
                            type="text" 
                            value={editTitleInput} 
                            onChange={(e) => setEditTitleInput(e.target.value)}
                            onBlur={() => saveTitle(session.id)}
                            onKeyDown={(e) => handleEditKeyDown(e, session.id)}
                            autoFocus
                            className="flex-1 min-w-0 text-sm px-1 py-0.5 border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                      ) : (
                        <div className="flex-1 min-w-0">
                            <div className="truncate text-sm font-medium leading-5">
                                {session.title}
                            </div>
                            <div className="text-[10px] opacity-60 truncate mt-0.5">
                                {new Date(session.lastModified).toLocaleDateString()} • {new Date(session.lastModified).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </div>
                        </div>
                      )}

                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                            onClick={(e) => startEditing(e, session)}
                            className="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-all"
                            title="Renommer"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                        </button>
                        <button 
                            onClick={(e) => deleteSession(e, session.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            title="Supprimer"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                      </div>
                  </div>
              ))}
          </div>
      </div>

      {/* OVERLAY for mobile */}
      {showHistory && (
        <div 
            className="absolute inset-0 bg-black/20 z-20 backdrop-blur-sm"
            onClick={() => setShowHistory(false)}
        ></div>
      )}

      {/* MAIN CHAT CONTENT */}
      <div className="flex-1 flex flex-col relative w-full min-w-0 bg-white">
        
        {/* Toggle Button (Always visible) */}
        <div className="absolute top-4 left-4 z-10">
            <button 
                onClick={() => setShowHistory(!showHistory)}
                className="p-2 bg-white/80 backdrop-blur shadow-sm border border-slate-200 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-white transition-all"
                title="Afficher l'historique"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">
            {messages.map((msg, idx) => (
            <div
                key={idx}
                className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} animate-in fade-in slide-in-from-bottom-4 duration-500`}
            >
                <div className="flex-shrink-0 mt-1">
                {msg.role === 'user' ? <UserIcon /> : <BotIcon />}
                </div>
                
                <div
                className={`max-w-[85%] rounded-3xl px-6 py-5 shadow-sm ${
                    msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-lg'
                    : 'bg-white text-slate-800 rounded-tl-lg border border-slate-200'
                }`}
                >
                    <SimpleMarkdown text={msg.text} isUser={msg.role === 'user'} />
                    
                    <div className={`text-[10px] mt-2 opacity-70 ${msg.role === 'user' ? 'text-indigo-100 text-right' : 'text-slate-400'}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                </div>
            </div>
            ))}
            
            {isLoading && (
            <div className="flex gap-4 animate-pulse">
                <div className="flex-shrink-0 mt-1"><BotIcon /></div>
                <div className="bg-white border border-slate-200 rounded-3xl rounded-tl-lg px-6 py-5 shadow-sm flex items-center space-x-1.5 h-16">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce delay-75"></div>
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce delay-150"></div>
                </div>
            </div>
            )}
            <div ref={messagesEndRef} />
        </div>

        {/* Suggestions & Input Area */}
        <div className="p-4 bg-white border-t border-slate-100 relative z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
            
            {/* Attachment Preview */}
            {attachment && (
                <div className="mb-2 flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-medium w-fit border border-indigo-100">
                    <span className="truncate max-w-[200px]">{attachment.file.name}</span>
                    <button onClick={clearAttachment} className="hover:text-indigo-900">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
            )}

            {/* Suggestions Chips & Quiz Button */}
            {messages.length < 3 && !isLoading && !attachment && (
                <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide items-center">
                    <button 
                        onClick={handleQuizStart}
                        className="whitespace-nowrap px-3 py-1.5 bg-rose-100 text-rose-700 text-xs font-bold rounded-full border border-rose-200 hover:bg-rose-200 hover:border-rose-300 transition-colors flex items-center gap-1 shadow-sm"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path></svg>
                        QUIZ à réponse construite !
                    </button>
                    
                    {/* 04/12/2025 19:07:56 Bouton superflu
                    <button 
                        onClick={handleWhoAmI}
                        className="whitespace-nowrap px-3 py-1.5 bg-teal-100 text-teal-700 text-xs font-bold rounded-full border border-teal-200 hover:bg-teal-200 hover:border-teal-300 transition-colors flex items-center gap-1 shadow-sm"
                    >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Qui suis-je ?
                    </button>
                    */}

                    <div className="w-px h-6 bg-slate-200 mx-1"></div>
                    {suggestions.map((s, i) => (
                        <button 
                            key={i}
                            onClick={() => sendMessage(s)}
                            className="whitespace-nowrap px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-medium rounded-full border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-colors"
                        >
                            {s}
                        </button>
                    ))}
                </div>
            )}

            <div className="relative flex items-end gap-2 bg-slate-50 p-2 rounded-3xl border border-slate-200 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100 transition-all shadow-inner">
            
            {/* File Input Button */}
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect} 
                accept=".pdf,image/*" 
                className="hidden" 
            />
            <button 
                onClick={() => fileInputRef.current?.click()}
                className="p-2 mb-1 text-slate-400 hover:text-indigo-600 transition-colors rounded-full hover:bg-indigo-50"
                title="Joindre un document (PDF ou Image)"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
            </button>

            <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={attachment ? "Posez une question sur ce document..." : "Posez votre question juridique..."}
                className="flex-1 bg-transparent px-2 py-3 focus:outline-none text-slate-700 placeholder-slate-400 resize-none max-h-[150px] overflow-y-auto leading-normal"
                rows={1}
            />
            
            <button
                onClick={handleSend}
                disabled={isLoading || (!input.trim() && !attachment)}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white p-3 rounded-2xl transition-all shadow-md hover:shadow-lg flex-shrink-0 mb-0.5"
            >
                <svg className="w-5 h-5 transform rotate-90 translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
            </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default TextChat;
