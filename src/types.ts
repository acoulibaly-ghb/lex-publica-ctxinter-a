export enum ChatMode {
  TEXT = 'TEXT',
  VOICE = 'VOICE'
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface AudioVisualizerProps {
  isListening: boolean;
  isSpeaking: boolean;
  volume: number;
}