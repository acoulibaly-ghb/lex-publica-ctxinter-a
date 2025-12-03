export enum ChatMode {
  TEXT = 'TEXT',
  VOICE = 'VOICE'
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface ChatSession {
    id: string;
    title: string;
    messages: Message[]; // Pour le mode TEXT
    transcripts?: {role: 'user' | 'model', text: string}[]; // Pour le mode VOICE
    lastModified: number;
    mode: ChatMode;
}

export interface AudioVisualizerProps {
  isListening: boolean;
  isSpeaking: boolean;
  volume: number;
}
