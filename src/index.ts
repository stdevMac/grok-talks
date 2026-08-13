export { TalksBus } from "./bus/talks.js";
export { systemClock, systemPid } from "./bus/clock.js";
export { defaultDataDir } from "./bus/paths.js";
export { runCli } from "./cli.js";
export { callTalksTool } from "./mcp/tools.js";
export { handleHook } from "./hooks/handle.js";
export {
  SQUAD_ROLES,
  ROLE_BRIEFS,
  startSquad,
  spawnWorker,
  retireWorker,
  parseRoles,
  squadSessionId,
  isSquadRole,
  requestApproval,
  approveTask,
  isApproved,
  loadSquadState,
  activeWorkers,
  launchLine,
  gcDeadWorkers,
  markWorkerAttached,
  parseHumanApprove,
  isKnownLead,
} from "./bus/squad.js";
export { loadConstitution, loadRoleCard, formatRoleBriefing, cardFromSession } from "./bus/roleCards.js";
export type { Squad, SquadMember, SquadRole } from "./bus/squad.js";
export type { BusDeps, RosterEntry, Mail, BoardScope } from "./bus/types.js";
