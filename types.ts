
export enum HUDMode {
  NORMAL = 'НОРМА',
  COMBAT = 'БОЙ',
  AVATAR = 'АВАТАР',
  SCAN = 'ПОИСК'
}

export interface TacticalLog {
  id: string;
  timestamp: string;
  message: string;
  level: 'INFO' | 'WARN' | 'ALERT';
}

export interface Target {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  threatLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  type: string;
  timestamp: number;
  isAiMarked?: boolean;
  distance?: number; // Simulated distance in meters
  ownerId?: string; // ID of the operator who created this target
}

export interface PeerMessage {
  type: 'TARGET_UPDATE' | 'LOG_UPDATE' | 'SYNC_STATE' | 'VOICE_PING';
  data: any;
  senderId: string;
}
