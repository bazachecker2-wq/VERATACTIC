
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
  isAnchoredToView?: boolean; // New: If true, this AI-marked target is anchored to its screen position
  distance?: number; // Simulated distance in meters
  ownerId?: string; // ID of the operator who created this target
}