export type SessionId = string;
export type IsoTime = string;
export type MailKind = "chat" | "collision";
export type SessionState = "working" | "idle";
export type BoardScope = "project" | "all";

export const PLUGIN_VERSION = "1" as const;
export const HEARTBEAT_MS = 2 * 60 * 1000;
export const CLAIM_TTL_MS = 10 * 60 * 1000;
export const CHAT_RATE = 10;
export const CHAT_WINDOW_MS = 60 * 1000;
export const DRAIN_CAP = 8;
export const STATUS_MAX = 200;
export const LOOP_NAG_MS = 10 * 60 * 1000;

export interface RosterEntry {
  session_id: SessionId;
  name: string;
  cwd: string;
  project: string;
  pid: number;
  working_on: string;
  state: SessionState;
  heartbeat_at: IsoTime;
  plugin_version: typeof PLUGIN_VERSION;
}

export interface ClaimPath {
  path: string;
  last_at: IsoTime;
}

export interface ClaimsFile {
  session_id: SessionId;
  project: string;
  paths: ClaimPath[];
}

export interface Mail {
  id: string;
  ts: IsoTime;
  from: SessionId;
  from_name: string;
  kind: MailKind;
  project: string;
  body: string;
  paths: string[];
}

export interface MuteFile {
  all: boolean;
  peers: SessionId[];
}

export interface DenyKey {
  peer: SessionId;
  path: string;
  claim_last_at: IsoTime;
}

export type TalkedFile = Record<SessionId, IsoTime>;

export interface Clock {
  now(): Date;
}

export interface PidCheck {
  isAlive(pid: number): boolean;
}

export interface BusDeps {
  dataDir: string;
  clock: Clock;
  pid: PidCheck;
  grokHome?: string;
}

export interface SessionCron {
  id?: string;
  schedule?: string;
  prompt?: string;
}
