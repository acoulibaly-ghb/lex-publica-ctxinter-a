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
    title: string; // Le début du premier message ou "Nouvelle conversation"
    messages: Message[];
    lastModified: number; // Timestamp pour le tri
}

export interface AudioVisualizerProps {
  isListening: boolean;
  isSpeaking: boolean;
  volume: number;
}
