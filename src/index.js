// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/setup/host-settings.ts
var exports_host_settings = {};
__export(exports_host_settings, {
  createHostSetupSettings: () => createHostSetupSettings
});
import { cfgRetryFallbackChains } from "@oh-my-pi/pi-coding-agent/session/settings";
import { cfgTaskIsolationEnabled } from "@oh-my-pi/pi-coding-agent/task/settings";
function createHostSetupSettings(settings) {
  return {
    modelRoles: () => ({ ...settings.getModelRoles() }),
    fallbackChains: () => ({ ...cfgRetryFallbackChains.get(settings) }),
    taskIsolation: () => cfgTaskIsolationEnabled.get(settings),
    setModelRole: (role, model) => settings.setModelRole(role, model),
    setFallbackChain: (role, chain) => cfgRetryFallbackChains.setEntry(settings, role, chain),
    setTaskIsolation: (enabled) => cfgTaskIsolationEnabled.set(settings, enabled),
    commit: async () => {
      await settings.flush();
      await settings.reloadFromDisk();
    }
  };
}
var init_host_settings = () => {};

// src/index.ts
import * as path8 from "path";

// ../shared-display/src/client.ts
var CHANNEL = "codesook/shared-display/v1";
var SOURCES = ["ponytail", "caveman", "headroom", "rtk", "codegraph", "beads", "pstack"];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDisplaySource(value) {
  return typeof value === "string" && SOURCES.includes(value);
}
function validRow(value) {
  return typeof value === "string" && !value.includes("\r") && !value.includes(`
`);
}
function isValidBlockFrame(value) {
  return Array.isArray(value) && value.length > 0 && value.every(validRow);
}
function isValidFrameSequence(value) {
  if (!isRecord(value) || !Array.isArray(value.frames) || value.frames.length === 0)
    return false;
  if (!value.frames.every(isValidBlockFrame))
    return false;
  if (value.fps === undefined)
    return true;
  return typeof value.fps === "number" && Number.isFinite(value.fps) && value.fps > 0;
}
function copyFrameSequence(value) {
  const frames = value.frames.map((frame) => [...frame]);
  return value.fps === undefined ? { frames } : { frames, fps: value.fps };
}
function validEpoch(value) {
  return typeof value === "string" && value.length > 0;
}
function validRevision(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function parseSharedDisplayMessage(value) {
  if (!isRecord(value) || value.protocol !== 1)
    return;
  if (value.kind === "ready") {
    return isDisplaySource(value.source) ? { protocol: 1, kind: "ready", source: value.source } : undefined;
  }
  if (value.kind === "request") {
    if (!validEpoch(value.epoch))
      return;
    if (value.source !== undefined && !isDisplaySource(value.source))
      return;
    return value.source === undefined ? { protocol: 1, kind: "request", epoch: value.epoch } : { protocol: 1, kind: "request", epoch: value.epoch, source: value.source };
  }
  if (value.kind === "host") {
    if (!validEpoch(value.epoch) || typeof value.active !== "boolean")
      return;
    return { protocol: 1, kind: "host", epoch: value.epoch, active: value.active };
  }
  if (value.kind === "snapshot") {
    if (!validEpoch(value.epoch) || !isDisplaySource(value.source) || !validRevision(value.revision)) {
      return;
    }
    if (value.sequence !== null && !isValidFrameSequence(value.sequence))
      return;
    return {
      protocol: 1,
      kind: "snapshot",
      epoch: value.epoch,
      source: value.source,
      revision: value.revision,
      sequence: value.sequence === null ? null : copyFrameSequence(value.sequence)
    };
  }
  return;
}
function copyPublishedSequence(sequence) {
  if (sequence === null)
    return null;
  if (!isValidFrameSequence(sequence))
    return null;
  return copyFrameSequence(sequence);
}
var NO_EVENTS_PUBLISHER = {
  hostAvailable: false,
  onHostAvailabilityChange() {
    return () => {};
  },
  publish() {},
  dispose() {}
};
var revisionsByBus = new WeakMap;
function connectSharedDisplay(events, source) {
  if (events === undefined)
    return NO_EVENTS_PUBLISHER;
  const sourceRevisions = revisionsByBus.get(events) ?? new Map;
  revisionsByBus.set(events, sourceRevisions);
  let disposed = false;
  let revision = sourceRevisions.get(source) ?? 0;
  let sequence = null;
  let hostEpoch;
  let hostAvailable = false;
  const availabilityHandlers = new Set;
  const setHostAvailable = (active) => {
    if (hostAvailable === active)
      return;
    hostAvailable = active;
    for (const handler of availabilityHandlers)
      handler(active);
  };
  const emitSnapshot = (epoch) => {
    if (disposed || !hostAvailable || revision === 0)
      return;
    events.emit(CHANNEL, {
      protocol: 1,
      kind: "snapshot",
      epoch,
      source,
      revision,
      sequence: copyPublishedSequence(sequence)
    });
  };
  const unsubscribe = events.on(CHANNEL, (data) => {
    if (disposed)
      return;
    const message = parseSharedDisplayMessage(data);
    if (message?.kind === "host") {
      if (!message.active && hostEpoch !== undefined && message.epoch !== hostEpoch)
        return;
      hostEpoch = message.epoch;
      setHostAvailable(message.active);
      return;
    }
    if (message?.kind !== "request" || !hostAvailable || message.epoch !== hostEpoch)
      return;
    if (message.source !== undefined && message.source !== source)
      return;
    emitSnapshot(message.epoch);
  });
  events.emit(CHANNEL, { protocol: 1, kind: "ready", source });
  return {
    get hostAvailable() {
      return hostAvailable;
    },
    onHostAvailabilityChange(handler) {
      if (disposed)
        return () => {};
      availabilityHandlers.add(handler);
      return () => availabilityHandlers.delete(handler);
    },
    publish(next) {
      if (disposed || next !== null && !isValidFrameSequence(next))
        return;
      revision = (sourceRevisions.get(source) ?? 0) + 1;
      sourceRevisions.set(source, revision);
      sequence = next === null ? null : copyFrameSequence(next);
      if (hostEpoch !== undefined)
        emitSnapshot(hostEpoch);
    },
    dispose() {
      if (disposed)
        return;
      sequence = null;
      revision = (sourceRevisions.get(source) ?? 0) + 1;
      sourceRevisions.set(source, revision);
      if (hostEpoch !== undefined)
        emitSnapshot(hostEpoch);
      disposed = true;
      unsubscribe();
      availabilityHandlers.clear();
      hostAvailable = false;
      hostEpoch = undefined;
    }
  };
}

// ../shared-display/src/instruction-mode.ts
var INSTRUCTION_MODE_SUSPENSION_CHANNEL = "codesook/instruction-mode-suspension/v1";
var SUSPENDABLE_INSTRUCTION_MODES = ["caveman", "ponytail"];
var instructionModeEntryType = (mode) => `${mode}-mode`;
function suspendInstructionModes(events, source, modes) {
  if (modes.length === 0)
    return;
  events.emit(INSTRUCTION_MODE_SUSPENSION_CHANNEL, { protocol: 1, source, modes: [...modes] });
}

// src/activation.ts
import * as fs from "fs/promises";
import * as path2 from "path";

// ../shared-display/src/config-store.ts
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
var CODESOOK_OMP_CONFIG_PATH = path.join(os.homedir(), ".config", "codesook-omp", "config.json");
var CODESOOK_OMP_CONFIG_CHANGED = "codesook/omp-plugin-config/v1";
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function defaultCodesookOmpConfig() {
  return { version: 1, display: {}, behavior: {} };
}
function isCodesookOmpConfig(value) {
  return isRecord2(value) && value.version === 1 && isRecord2(value.display) && isRecord2(value.behavior);
}
function invalidConfigResult(exists) {
  return { exists, valid: !exists, value: defaultCodesookOmpConfig() };
}
function isMissingFileError(error) {
  return isRecord2(error) && error.code === "ENOENT";
}
function readCodesookOmpConfig(configPath = CODESOOK_OMP_CONFIG_PATH) {
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    return invalidConfigResult(!isMissingFileError(error));
  }
  try {
    const parsed = JSON.parse(raw);
    return isCodesookOmpConfig(parsed) ? { exists: true, valid: true, value: parsed } : invalidConfigResult(true);
  } catch {
    return invalidConfigResult(true);
  }
}

// src/roles.ts
var PANEL_SEATS = ["a", "b", "c", "d", "e"];
var WORK_ROLES = [
  {
    kind: "work",
    id: "pstack-explore",
    fallback: "@smol",
    access: "read-only",
    lane: "Read-only pstack lane that maps code and reports what it found.",
    what: "Read-only scouting: finds files, symbols and call paths and reports what it saw.",
    when: "Playbook steps that map unfamiliar code before design or edits.",
    recommended: "A fast, cheap model with a large context window."
  },
  {
    kind: "work",
    id: "pstack-build",
    fallback: "@task",
    access: "write",
    lane: "Write-capable pstack lane that implements one scoped change and runs its own checks.",
    what: "Implements a scoped change end to end: edits, runs, and fixes its own failures.",
    when: "Feature, fix and refactor steps that write code.",
    recommended: "A strong coding model with reliable tool use; a mid-tier model is usually enough."
  },
  {
    kind: "work",
    id: "pstack-mechanical",
    fallback: "@tiny",
    access: "write",
    lane: "Write-capable pstack lane for fully specified mechanical edits.",
    what: "Applies fully specified mechanical edits: renames, codemods, formatting and bulk updates.",
    when: "Steps where the change is already decided and only needs doing.",
    recommended: "The cheapest model that follows instructions exactly."
  },
  {
    kind: "work",
    id: "pstack-design",
    fallback: "@designer",
    access: "read-only",
    lane: "Read-only pstack lane that proposes or critiques a design.",
    what: "Proposes and critiques design: architecture, module boundaries, types and interfaces.",
    when: "Architect and design steps, before code is written.",
    recommended: "A model with strong design and visual judgment."
  },
  {
    kind: "work",
    id: "pstack-judge",
    fallback: "@slow",
    access: "read-only",
    lane: "Read-only pstack lane that merges panel verdicts into one decision.",
    what: "Merges the panel's verdicts into one decision and breaks ties.",
    when: "The end of a panel review (interrogate, arena, swarm, architect) and final reviews.",
    recommended: "Your strongest reasoning model."
  },
  {
    kind: "work",
    id: "pstack-security",
    fallback: "@slow",
    access: "read-only",
    lane: "Read-only pstack lane that reviews a change for security flaws.",
    what: "Reviews a change for security flaws.",
    when: "Review steps that touch authentication, input handling, secrets or dependencies.",
    recommended: "A strong reasoning model; a different vendor from your judge adds coverage."
  }
];
var seatRoleId = (seat) => `pstack-panel-${seat}`;
var PANEL_ROLES = PANEL_SEATS.map((seat) => ({
  kind: "panel",
  id: seatRoleId(seat),
  seat,
  fallback: null,
  what: `Panel seat ${seat.toUpperCase()}: an independent reviewer whose verdict is compared with the other seats.`,
  when: "Panel workflows (interrogate, arena, swarm, architect, how critics) dispatch every configured seat in parallel.",
  recommended: "A distinct model per seat, ideally from different vendors. Leave a seat unset to drop it: an unset seat is skipped, not an error."
}));
var MODEL_ROLES = [...WORK_ROLES, ...PANEL_ROLES];
var READ_ONLY_TOOLS = ["read", "grep", "glob", "lsp", "ast_grep"];
var WRITE_TOOLS = [...READ_ONLY_TOOLS, "ast_edit", "edit", "write", "bash"];
function roleAlias(role) {
  return `@${role.id}`;
}
function workLane(role) {
  return {
    name: role.id,
    kind: "work",
    role,
    access: role.access,
    description: role.lane,
    model: [roleAlias(role), role.fallback],
    tools: role.access === "write" ? WRITE_TOOLS : READ_ONLY_TOOLS
  };
}
function seatLanes(role) {
  const seat = role.seat.toUpperCase();
  return [
    {
      name: `${role.id}-critic`,
      kind: "critic",
      role,
      access: "read-only",
      description: `Read-only pstack panel seat ${seat} critic that returns a structured verdict.`,
      model: [roleAlias(role)],
      tools: READ_ONLY_TOOLS
    },
    {
      name: `${role.id}-builder`,
      kind: "builder",
      role,
      access: "write",
      description: `Write-capable pstack panel seat ${seat} builder; dispatch it only with task isolation.`,
      model: [roleAlias(role)],
      tools: WRITE_TOOLS
    }
  ];
}
var LANE_AGENTS = [...WORK_ROLES.map(workLane), ...PANEL_ROLES.flatMap(seatLanes)];
function findLaneAgent(name) {
  const wanted = name.trim().toLowerCase();
  return LANE_AGENTS.find((agent) => agent.name === wanted);
}

// src/panel-rules.ts
var THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/i;
var stripThinking = (spec) => spec.replace(THINKING_SUFFIX, "");
function modelKey(spec) {
  const id = stripThinking(spec);
  return (id.includes("/") ? id.slice(id.indexOf("/") + 1) : id).toLowerCase();
}
var SINGLE_VENDOR_WARNING = "diversity reduced: single vendor";
function checkPanel(seats, vendorOf) {
  const configured = seats.filter((seat) => seat.model !== undefined);
  const bySeatKey = new Map;
  for (const { seat, model } of configured) {
    const key = modelKey(model);
    bySeatKey.set(key, [...bySeatKey.get(key) ?? [], seat]);
  }
  const errors = [];
  for (const [key, group] of bySeatKey) {
    if (group.length < 2)
      continue;
    const model = configured.find((seat) => modelKey(seat.model) === key).model;
    errors.push(`Panel seats ${group.map((seat) => seat.toUpperCase()).join(", ")} share ${model}. Give each seat a different model.`);
  }
  const vendors = new Set(configured.map((seat) => vendorOf(seat.model)));
  const warnings = configured.length > 0 && vendors.size === 1 ? [`Panel is single-vendor (${[...vendors][0]}): ${SINGLE_VENDOR_WARNING}.`] : [];
  return { errors, warnings };
}
function seatModels(assignment) {
  return PANEL_SEATS.map((seat) => ({ seat, model: assignment[seatRoleId(seat)] }));
}

// src/panel.ts
function resolveSeats(models) {
  return PANEL_ROLES.map((role) => {
    const model = models.resolve(roleAlias(role));
    return { seat: role.seat, role, model: model ? `${model.provider}/${model.id}` : undefined, vendor: model ? models.family(model) : undefined };
  });
}
function activeSeats(models, maxPanelSize) {
  return resolveSeats(models).filter((seat) => seat.model !== undefined).slice(0, maxPanelSize);
}
function diversityNote(vendors) {
  return vendors.length > 0 && new Set(vendors).size === 1 ? SINGLE_VENDOR_WARNING : undefined;
}
function seatOfAgent(agent) {
  const lane = agent === undefined ? undefined : findLaneAgent(agent);
  return lane?.role.kind === "panel" ? lane.role : undefined;
}
function guardSeatSpawn(event, ctx, maxPanelSize) {
  const role = seatOfAgent(event.agent);
  if (!role)
    return;
  const configured = PANEL_ROLES.filter((candidate) => ctx.models.resolve(roleAlias(candidate)));
  if (!configured.includes(role)) {
    return {
      block: true,
      reason: `Panel seat ${role.seat.toUpperCase()} has no model: the model role ${role.id} is unset. Skip this seat and continue with the seats that have models. Do not retry it or substitute another agent.`
    };
  }
  if (configured.indexOf(role) < maxPanelSize)
    return;
  return {
    block: true,
    reason: `Panel seat ${role.seat.toUpperCase()} is beyond the maximum panel size of ${maxPanelSize}. Skip this seat and continue with the seats on the roster. Do not retry it or substitute another agent.`
  };
}

// src/activation.ts
var POTETO_SKILL = "poteto-mode";
var DEFAULT_POTETO_DIRECTORY = path2.join(import.meta.dirname, "..", "skills", POTETO_SKILL);
var ROSTER_MESSAGE_TYPE = "dev.codesook.pstack.roster";
var REMINDER_MESSAGE_TYPE = "dev.codesook.pstack.reminder";
var PANEL_SKILLS = ["interrogate", "arena", "swarm", "architect", "how"];
var SKILL_COMMAND = new RegExp(`^\\s*/skill:${POTETO_SKILL}(?=\\s|$)`);
var PANEL_SKILL_COMMAND = new RegExp(`^\\s*/skill:(?:${PANEL_SKILLS.join("|")})(?=\\s|$)`);
var SKILL_PROMPT_TYPE = "skill-prompt";
function taskOfSkillInput(text) {
  const match = SKILL_COMMAND.exec(text);
  return match ? text.slice(match[0].length).trim() : undefined;
}
function taskOfSkillPrompt(message) {
  if (!isRecord2(message) || message.role !== "custom" || message.customType !== SKILL_PROMPT_TYPE || message.attribution !== "user")
    return;
  if (!isRecord2(message.details) || message.details.name !== POTETO_SKILL)
    return;
  return typeof message.details.args === "string" ? message.details.args.trim() : "";
}
function isPanelSkillInput(text) {
  return PANEL_SKILL_COMMAND.test(text);
}
function isPanelSkillPrompt(message) {
  if (!isRecord2(message) || message.role !== "custom" || message.customType !== SKILL_PROMPT_TYPE || message.attribution !== "user")
    return false;
  return isRecord2(message.details) && PANEL_SKILLS.includes(message.details.name);
}
async function buildPotetoPrompt(skillDirectory, task) {
  const source = await fs.readFile(path2.join(skillDirectory, "SKILL.md"), "utf8");
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
  return [
    `[IMPORTANT: User invoked the "${POTETO_SKILL}" skill; follow its instructions. Full skill below.]`,
    body,
    "---",
    `[Skill directory: ${skillDirectory}]
Resolve relative paths in this skill against this absolute directory.`,
    ...task ? [`User: ${task}`] : []
  ].join(`

`);
}
function rosterText(seats) {
  const configured = seats.map((seat) => `${seat.seat.toUpperCase()} (${seat.role.id}: ${seat.model}, vendor ${seat.vendor})`);
  const note = diversityNote(seats.flatMap((seat) => seat.vendor ?? []));
  const absent = PANEL_ROLES.filter((role) => !seats.some((seat) => seat.seat === role.seat)).map((role) => role.seat.toUpperCase());
  return [
    configured.length > 0 ? `pstack panel seats configured: ${configured.join(", ")}.` : "pstack has no panel seats configured.",
    note ? `Every configured seat is one vendor: each panel verdict states "${note}".` : undefined,
    absent.length > 0 ? `Absent seats: ${absent.join(", ")}. An absent seat is not a failure: skip it and do not spawn its agents.` : undefined
  ].filter(Boolean).join(" ");
}

// src/thinking.ts
var THINKING_LEVELS = ["low", "medium", "high", "xhigh"];
var DEFAULT_THINKING = "medium";
var LADDER = [...THINKING_LEVELS, "max"];
function stepThinking(level, by) {
  return LADDER[Math.min(LADDER.length - 1, Math.max(0, LADDER.indexOf(level) + by))];
}
function clampThinking(level, efforts) {
  const rank = (effort) => {
    const index = LADDER.indexOf(effort);
    return index === -1 ? effort === "minimal" ? -1 : LADDER.length : index;
  };
  const want = rank(level);
  let best;
  for (const effort of efforts) {
    const distance = Math.abs(rank(effort) - want);
    if (best === undefined || distance < Math.abs(rank(best) - want) || distance === Math.abs(rank(best) - want) && rank(effort) < rank(best))
      best = effort;
  }
  return best;
}

// src/behavior.ts
import * as os2 from "os";
import * as path3 from "path";
var GUARD_STRICTNESS_LEVELS = ["block-and-warn", "warn-only", "off"];
var blocksEnabled = (strictness) => strictness === "block-and-warn";
var warningsEnabled = (strictness) => strictness !== "off";
var MIN_PANEL_SIZE = 1;
var MAX_PANEL_SIZE = 5;
var DEFAULT_PSTACK_BEHAVIOR = {
  suspendCaveman: true,
  suspendPonytail: true,
  maxPanelSize: MAX_PANEL_SIZE,
  guardStrictness: "block-and-warn",
  defaultThinking: DEFAULT_THINKING
};
var SUSPEND_SETTING = { caveman: "suspendCaveman", ponytail: "suspendPonytail" };
var suspendsMode = (behavior, mode) => behavior[SUSPEND_SETTING[mode]];
function isStrictness(value) {
  return GUARD_STRICTNESS_LEVELS.includes(value);
}
function isThinking(value) {
  return THINKING_LEVELS.includes(value);
}
function isPanelSize(value) {
  return Number.isInteger(value) && value >= MIN_PANEL_SIZE && value <= MAX_PANEL_SIZE;
}
function normalizePstackBehavior(raw) {
  const source = isRecord2(raw) ? raw : {};
  const defaults = DEFAULT_PSTACK_BEHAVIOR;
  return {
    suspendCaveman: typeof source.suspendCaveman === "boolean" ? source.suspendCaveman : defaults.suspendCaveman,
    suspendPonytail: typeof source.suspendPonytail === "boolean" ? source.suspendPonytail : defaults.suspendPonytail,
    maxPanelSize: isPanelSize(source.maxPanelSize) ? source.maxPanelSize : defaults.maxPanelSize,
    guardStrictness: isStrictness(source.guardStrictness) ? source.guardStrictness : defaults.guardStrictness,
    defaultThinking: isThinking(source.defaultThinking) ? source.defaultThinking : defaults.defaultThinking
  };
}
function pstackBehaviorFromRoot(root) {
  if (!isRecord2(root) || root.version !== 1 || !isRecord2(root.display) || !isRecord2(root.behavior))
    return;
  return normalizePstackBehavior(root.behavior.pstack);
}
function createBehaviorStore(events, options = {}) {
  const configPath = options.configPath ?? path3.join(options.homeDirectory ?? os2.homedir(), ".config", "codesook-omp", "config.json");
  let behavior = { ...DEFAULT_PSTACK_BEHAVIOR };
  const reload = () => {
    const root = readCodesookOmpConfig(configPath);
    if (root.exists && !root.valid) {
      options.onWarning?.(`Unable to parse the Root Plugin Configuration at ${configPath}; pstack uses its default behavior settings.`);
      behavior = { ...DEFAULT_PSTACK_BEHAVIOR };
      return;
    }
    behavior = pstackBehaviorFromRoot(root.value) ?? { ...DEFAULT_PSTACK_BEHAVIOR };
  };
  reload();
  const unsubscribe = events.on(CODESOOK_OMP_CONFIG_CHANGED, (data) => {
    if (!isRecord2(data))
      return;
    const next = pstackBehaviorFromRoot(data.config);
    if (next)
      behavior = next;
  });
  return { current: () => ({ ...behavior }), reload, dispose: unsubscribe };
}

// src/doctor.ts
import * as fs2 from "fs";
import * as path4 from "path";
var realpath = (target) => {
  try {
    return fs2.realpathSync(target);
  } catch {
    return path4.resolve(target);
  }
};
function listFiles(directory) {
  return fs2.readdirSync(directory, { recursive: true, withFileTypes: true }).flatMap((entry) => entry.isFile() ? [path4.join(entry.parentPath, entry.name)] : []);
}
function workflowCalledSkills(skillsRoot) {
  const names = fs2.readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs2.existsSync(path4.join(skillsRoot, entry.name, "SKILL.md"))).map((entry) => entry.name);
  const text = listFiles(path4.join(skillsRoot, POTETO_SKILL)).filter((file) => file.endsWith(".md")).map((file) => fs2.readFileSync(file, "utf8")).join(`
`);
  return names.filter((name) => name === POTETO_SKILL || new RegExp(`(?:\\*\\*|\`|/skill:|skill://)${name}(?![\\w-])`).test(text));
}
function checkRoles({ models, settings }) {
  const configured = settings.modelRoles();
  const findings = [];
  for (const role of MODEL_ROLES) {
    const spec = configured[role.id];
    if (spec !== undefined && !models.resolve(roleAlias(role))) {
      findings.push({ check: "roles", severity: "error", message: `${role.id} is set to ${spec}, which the OMP registry does not serve. Run /pstack setup.` });
    }
  }
  const seats = resolveSeats(models).filter((seat) => seat.model !== undefined).map((seat) => seat.seat.toUpperCase());
  if (seats.length === 0) {
    findings.push({ check: "roles", severity: "warning", message: "No panel seat has a model, so panel workflows run without a panel. Run /pstack setup." });
  }
  const fallbacks = WORK_ROLES.filter((role) => configured[role.id] === undefined);
  if (findings.length === 0) {
    const set = WORK_ROLES.length - fallbacks.length;
    findings.push({
      check: "roles",
      severity: "ok",
      message: `${set}/${WORK_ROLES.length} work roles set${fallbacks.length > 0 ? ` (${fallbacks.map((role) => `${role.id} falls back to ${role.fallback}`).join(", ")})` : ""}; panel seats with a model: ${seats.join(", ")}.`
    });
  }
  return findings;
}
function checkPanelRules(models) {
  const seats = resolveSeats(models);
  const vendors = new Map(seats.flatMap((seat) => seat.model && seat.vendor ? [[seat.model, seat.vendor]] : []));
  const { errors, warnings } = checkPanel(seats.map(({ seat, model }) => ({ seat, model })), (spec) => vendors.get(spec) ?? spec);
  const findings = [
    ...errors.map((message) => ({ check: "panel", severity: "error", message })),
    ...warnings.map((message) => ({ check: "panel", severity: "warning", message }))
  ];
  const configured = seats.filter((seat) => seat.model !== undefined);
  if (configured.length > 0) {
    findings.push({ check: "panel", severity: "ok", message: `seats: ${configured.map((seat) => `${seat.seat.toUpperCase()} ${seat.model} (vendor ${seat.vendor})`).join(", ")}.` });
  }
  return findings;
}
function checkSkills({ commands, skillsRoot }) {
  const called = workflowCalledSkills(skillsRoot);
  const skillCommands = new Map(commands.filter((command) => command.source === "skill").map((command) => [command.name, command]));
  if (skillCommands.size === 0) {
    return [{ check: "skills", severity: "warning", message: "OMP lists no skill commands (skills.enableSkillCommands off?), so ownership of the workflow-called skills cannot be checked." }];
  }
  const root = realpath(skillsRoot) + path4.sep;
  const findings = [];
  for (const name of called) {
    const owner = skillCommands.get(`skill:${name}`);
    if (!owner)
      findings.push({ check: "skills", severity: "error", message: `Skill ${name} is called by a workflow but OMP does not list it. Check the package is installed and the skill is not disabled.` });
    else if (!owner.path || !realpath(owner.path).startsWith(root)) {
      findings.push({ check: "skills", severity: "error", message: `Skill ${name} resolves to ${owner.path ?? "another source"}, not pstack's copy, so workflows load that one instead.` });
    }
  }
  if (findings.length === 0)
    findings.push({ check: "skills", severity: "ok", message: `All ${called.length} workflow-called skills resolve to pstack's own copy.` });
  return findings;
}
function checkInstructionModes({ behavior, commands }) {
  return SUSPENDABLE_INSTRUCTION_MODES.map((mode) => {
    const suspend = suspendsMode(behavior, mode);
    const loaded = commands.some((command) => command.source === "extension" && command.name === mode);
    const message = !loaded ? `${mode} is not loaded, so there is nothing to suspend.` : suspend ? `${mode} is loaded and switches off while pstack is active.` : `${mode} is loaded and keeps running while pstack is active (suspend setting is off).`;
    return { check: "instruction-modes", severity: "ok", message };
  });
}
function diagnose(input) {
  const display = input.displayHostAvailable ? { check: "display-host", severity: "ok", message: "A Display Host is running." } : { check: "display-host", severity: "warning", message: "No Display Host is running, so the pstack Status Segment is not shown. Enable @codesook/omp-shared-display." };
  const isolation = input.settings.taskIsolation() ? { check: "task-isolation", severity: "ok", message: "task.isolation.enabled is on." } : { check: "task-isolation", severity: "warning", message: "task.isolation.enabled is off. Panel builders and arena or swarm writers need it; /pstack setup offers to turn it on." };
  return [...checkRoles(input), ...checkPanelRules(input.models), ...checkSkills(input), ...checkInstructionModes(input), display, isolation];
}
function doctorLevel(findings) {
  if (findings.some((finding) => finding.severity === "error"))
    return "error";
  return findings.some((finding) => finding.severity === "warning") ? "warning" : "info";
}
function doctorReport(findings) {
  const problems = findings.filter((finding) => finding.severity !== "ok").length;
  return [
    problems === 0 ? "pstack doctor: healthy" : `pstack doctor: ${problems} problem(s)`,
    ...findings.map((finding) => `${finding.severity === "ok" ? "ok     " : finding.severity === "warning" ? "warning" : "error  "} ${finding.check}: ${finding.message}`)
  ].join(`
`);
}

// src/dropouts.ts
var DROPOUT_ENTRY_TYPE = "dev.codesook.pstack.dropout";
var SUBAGENT_EVENT_CHANNEL = "task:subagent:event";
var SUBAGENT_LIFECYCLE_CHANNEL = "task:subagent:lifecycle";
var SAME_MODEL_FALLBACK_ROLE = "fireworks-fast";
function changesModel(event, from, to) {
  return event.role !== SAME_MODEL_FALLBACK_ROLE && modelKey(from) !== modelKey(to);
}
var SETTLED_STATUSES = ["completed", "failed", "aborted"];
function watchDropouts(events, record, settled) {
  const agentById = new Map;
  const offLifecycle = events.on(SUBAGENT_LIFECYCLE_CHANNEL, (data) => {
    if (!isRecord2(data) || typeof data.id !== "string")
      return;
    if (data.status === "started" && typeof data.agent === "string") {
      agentById.set(data.id, data.agent);
      return;
    }
    if (data.status === "started")
      return;
    const agent = agentById.get(data.id);
    agentById.delete(data.id);
    const role = seatOfAgent(agent);
    if (agent && role && typeof data.status === "string" && SETTLED_STATUSES.includes(data.status)) {
      settled?.({ seat: role.seat, agent, id: data.id, status: data.status });
    }
  });
  const offEvent = events.on(SUBAGENT_EVENT_CHANNEL, (data) => {
    if (!isRecord2(data) || typeof data.id !== "string" || !isRecord2(data.event))
      return;
    const event = data.event;
    if (event.type !== "retry_fallback_applied" || typeof event.from !== "string" || typeof event.to !== "string")
      return;
    if (!changesModel(event, event.from, event.to))
      return;
    const agent = agentById.get(data.id);
    const role = seatOfAgent(agent);
    if (!agent || !role)
      return;
    record({
      seat: role.seat,
      agent,
      id: data.id,
      from: event.from,
      to: event.to,
      ...typeof event.reason === "string" ? { reason: event.reason } : {}
    });
  });
  return () => {
    offLifecycle();
    offEvent();
    agentById.clear();
  };
}

// src/activation-state.ts
var ACTIVATION_ENTRY_TYPE = "dev.codesook.pstack.activation";
var RECEIPT_ENTRY_TYPE = "dev.codesook.pstack.receipt";
var INACTIVE_ACTIVATION = { active: false, seats: [], receipts: [], dropouts: [] };
var isSeat = (value) => PANEL_SEATS.includes(value);
var isCount = (value) => Number.isInteger(value) && value >= 0;
function parseActivationEntry(data) {
  if (!isRecord2(data))
    return;
  if (data.kind === "activated" && Array.isArray(data.seats) && data.seats.every(isSeat)) {
    return { kind: "activated", ...typeof data.task === "string" ? { task: data.task } : {}, seats: data.seats };
  }
  if (data.kind === "playbook" && typeof data.playbook === "string" && data.playbook !== "") {
    return { kind: "playbook", playbook: data.playbook };
  }
  if (data.kind === "progress" && isCount(data.done) && isCount(data.total) && data.done <= data.total) {
    return { kind: "progress", done: data.done, total: data.total, ...typeof data.current === "string" ? { current: data.current } : {} };
  }
  return;
}
function parseReceipt(data) {
  if (!isRecord2(data) || !isSeat(data.seat) || typeof data.agent !== "string" || typeof data.id !== "string")
    return;
  if (data.status !== "completed" && data.status !== "failed" && data.status !== "aborted")
    return;
  return { seat: data.seat, agent: data.agent, id: data.id, status: data.status };
}
function parseDropout(data) {
  if (!isRecord2(data) || !isSeat(data.seat))
    return;
  const { agent, id, from, to, reason } = data;
  if (typeof agent !== "string" || typeof id !== "string" || typeof from !== "string" || typeof to !== "string")
    return;
  return { seat: data.seat, agent, id, from, to, ...typeof reason === "string" ? { reason } : {} };
}
function sameProgress(a, b) {
  return a !== undefined && a.done === b.done && a.total === b.total && a.current === b.current;
}
function applyEntry(state, customType, data) {
  if (customType === ACTIVATION_ENTRY_TYPE) {
    const entry = parseActivationEntry(data);
    if (!entry)
      return state;
    if (entry.kind === "activated") {
      return state.active ? state : { ...INACTIVE_ACTIVATION, active: true, ...entry.task === undefined ? {} : { task: entry.task }, seats: entry.seats };
    }
    if (!state.active)
      return state;
    if (entry.kind === "playbook")
      return state.playbook === entry.playbook ? state : { ...state, playbook: entry.playbook };
    const progress = { done: entry.done, total: entry.total, ...entry.current === undefined ? {} : { current: entry.current } };
    return sameProgress(state.progress, progress) ? state : { ...state, progress };
  }
  if (!state.active)
    return state;
  if (customType === RECEIPT_ENTRY_TYPE) {
    const receipt = parseReceipt(data);
    return receipt ? { ...state, receipts: [...state.receipts, receipt] } : state;
  }
  if (customType === DROPOUT_ENTRY_TYPE) {
    const dropout = parseDropout(data);
    return dropout ? { ...state, dropouts: [...state.dropouts, dropout] } : state;
  }
  return state;
}
function rebuildActivationState(entries) {
  let state = INACTIVE_ACTIVATION;
  for (const entry of entries) {
    if (isRecord2(entry) && entry.type === "custom" && typeof entry.customType === "string") {
      state = applyEntry(state, entry.customType, entry.data);
    }
  }
  return state;
}
function reenabledInstructionModes(entries, modes) {
  let activated = false;
  const latest = new Map;
  for (const entry of entries) {
    if (!isRecord2(entry) || entry.type !== "custom" || typeof entry.customType !== "string")
      continue;
    if (!activated) {
      activated = entry.customType === ACTIVATION_ENTRY_TYPE && parseActivationEntry(entry.data)?.kind === "activated";
      continue;
    }
    const mode = modes.find((candidate) => instructionModeEntryType(candidate) === entry.customType);
    if (mode && isRecord2(entry.data))
      latest.set(mode, entry.data.mode);
  }
  return modes.filter((mode) => latest.has(mode) && latest.get(mode) !== "off");
}
function panelAttendance(state) {
  const completed = new Set(state.receipts.filter((receipt) => receipt.status === "completed").map((receipt) => receipt.seat));
  return { attended: state.seats.filter((seat) => completed.has(seat)).length, seats: state.seats.length };
}
function createActivationStore(appendEntry) {
  let state = INACTIVE_ACTIVATION;
  const listeners = new Set;
  const commit = (next, change) => {
    if (next === state)
      return false;
    state = next;
    for (const listener of [...listeners])
      listener(state, change);
    return true;
  };
  const record = (customType, data, change) => {
    const next = applyEntry(state, customType, data);
    if (next === state)
      return false;
    appendEntry(customType, data);
    return commit(next, change);
  };
  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    restore(entries) {
      state = rebuildActivationState(entries);
      for (const listener of [...listeners])
        listener(state, "restored");
    },
    activate: ({ task, seats }) => record(ACTIVATION_ENTRY_TYPE, { kind: "activated", ...task ? { task } : {}, seats: [...seats] }, "activated"),
    setPlaybook: (playbook) => void record(ACTIVATION_ENTRY_TYPE, { kind: "playbook", playbook }, "updated"),
    setProgress: (progress) => void record(ACTIVATION_ENTRY_TYPE, { kind: "progress", ...progress }, "updated"),
    recordReceipt: (receipt) => void record(RECEIPT_ENTRY_TYPE, receipt, "updated"),
    noteDropout: (dropout) => void commit(applyEntry(state, DROPOUT_ENTRY_TYPE, dropout), "updated")
  };
}

// src/display.ts
function segmentText(state) {
  if (!state.active)
    return;
  const parts = ["pstack"];
  if (state.playbook)
    parts.push(state.playbook);
  if (state.progress)
    parts.push(`${state.progress.done}/${state.progress.total}`);
  if (state.receipts.length > 0) {
    const { attended, seats } = panelAttendance(state);
    parts.push(`panel ${attended}/${seats}`);
  }
  if (state.dropouts.length > 0)
    parts.push(`dropouts ${state.dropouts.length}`);
  return parts.join(" \xB7 ");
}
function statusReport(state) {
  if (!state.active)
    return "pstack: inactive";
  const lines = ["pstack: active"];
  if (state.task)
    lines.push(`Task: ${state.task}`);
  lines.push(`Playbook: ${state.playbook ?? "not chosen yet"}`);
  if (state.progress) {
    lines.push(`Steps: ${state.progress.done}/${state.progress.total}${state.progress.current ? `, now: ${state.progress.current}` : ""}`);
  }
  if (state.seats.length > 0) {
    const { attended, seats } = panelAttendance(state);
    lines.push(`Panel: ${attended}/${seats} seats attended (${state.seats.map((seat) => seat.toUpperCase()).join(", ")} configured)`);
  } else {
    lines.push("Panel: no seats configured");
  }
  for (const dropout of state.dropouts) {
    lines.push(`Dropout: seat ${dropout.seat.toUpperCase()} ran on ${dropout.to} instead of ${dropout.from}`);
  }
  return lines.join(`
`);
}
function reminderText(state) {
  const where = [
    state.playbook ? `playbook ${state.playbook}` : "no playbook chosen yet",
    state.progress ? `step ${state.progress.done}/${state.progress.total}${state.progress.current ? `: ${state.progress.current}` : ""}` : undefined
  ].filter(Boolean);
  return `pstack is still active after compaction (${where.join(", ")}). Continue from there; the todo list holds the playbook steps.`;
}

// src/guards/blocking.ts
import { execFile } from "child_process";
import * as fs3 from "fs";
import * as path6 from "path";

// src/guards/shell.ts
import * as path5 from "path";
var WRAPPERS = new Set(["sudo", "doas", "env", "command", "builtin", "exec", "time", "nohup", "nice", "stdbuf", "xargs"]);
var SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
var EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
var REDIRECT = /^\d*(?:>>?|<|&>>?)(.*)$/;
var MAX_SHELL_DEPTH = 3;
function splitCommands(command) {
  const commands = [];
  let words = [];
  let word = "";
  let inWord = false;
  const endWord = () => {
    if (inWord)
      words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0)
      commands.push(words);
    words = [];
  };
  for (let i = 0;i < command.length; i++) {
    const ch = command[i];
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      const end = close === -1 ? command.length : close;
      word += command.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (ch === '"') {
      inWord = true;
      for (i++;i < command.length && command[i] !== '"'; i++) {
        if (command[i] === "\\" && '"\\$`'.includes(command[i + 1] ?? ""))
          i++;
        word += command[i] ?? "";
      }
    } else if (ch === "\\") {
      if (command[i + 1] === `
`)
        i++;
      else {
        word += command[i + 1] ?? "";
        inWord = true;
        i++;
      }
    } else if (ch === "&" && /[<>]$/.test(word)) {
      word += ch;
    } else if (";|&()`\n".includes(ch)) {
      endCommand();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endCommand();
  return commands.map(withoutRedirections);
}
function withoutRedirections(words) {
  const kept = [];
  for (let i = 0;i < words.length; i++) {
    const match = REDIRECT.exec(words[i]);
    if (!match)
      kept.push(words[i]);
    else if (match[1] === "")
      i++;
  }
  return kept;
}
function parseClusters(args, argLetters, scriptLetters) {
  let inPlace = false;
  let hasScript = false;
  const operands = [];
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const name = arg.slice(2).split("=")[0];
      if (name === "in-place")
        inPlace = true;
      else if (name === "expression" || name === "file") {
        hasScript = true;
        if (!arg.includes("="))
          i++;
      } else if (name === "line-length" && !arg.includes("="))
        i++;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      operands.push(arg);
      continue;
    }
    for (let j = 1;j < arg.length; j++) {
      const letter = arg[j];
      if (letter === "i") {
        inPlace = true;
        break;
      }
      if (scriptLetters.includes(letter))
        hasScript = true;
      if (argLetters.includes(letter)) {
        if (j === arg.length - 1)
          i++;
        break;
      }
    }
  }
  return { inPlace, operands, hasScript };
}
function parseSed(args) {
  const { inPlace, operands, hasScript } = parseClusters(args, "efl", "ef");
  return { inPlace, operands: hasScript ? operands : operands.slice(1) };
}
function parsePerl(args) {
  const { inPlace, operands, hasScript } = parseClusters(args, "eEFIMmCdDx", "eE");
  return { inPlace, operands: hasScript ? operands : operands.slice(1) };
}
var baseName = (word) => path5.basename(word);
function inspect(words, walk, depth) {
  const found = (tool, parsed) => {
    if (!parsed.inPlace || walk.cwd === undefined)
      return;
    const cwd = walk.cwd;
    const named = parsed.operands.filter((operand) => !operand.includes("{}"));
    const files = named.filter((operand) => !/^[~$]/.test(operand)).map((operand) => path5.resolve(cwd, operand));
    walk.edits.push({ tool, files, unresolved: named.length === 0 || named.length !== parsed.operands.length });
  };
  const run = (start2) => {
    const name = baseName(words[start2] ?? "");
    const args = words.slice(start2 + 1);
    if (name === "sed" || name === "gsed")
      found("sed", parseSed(args));
    else if (name === "perl")
      found("perl", parsePerl(args));
  };
  let start = 0;
  while (/^[A-Za-z_]\w*=/.test(words[start] ?? ""))
    start++;
  const first = baseName(words[start] ?? "");
  if (first === "cd") {
    const target = words[start + 1];
    if (target !== undefined && !/^[~$-]/.test(target))
      walk.cwd = walk.cwd === undefined ? undefined : path5.resolve(walk.cwd, target);
    else
      walk.cwd = undefined;
    return;
  }
  if (SHELLS.has(first) && depth < MAX_SHELL_DEPTH) {
    const flag = words.findIndex((word, index) => index > start && /^-[a-z]*c$/.test(word));
    const script = flag === -1 ? undefined : words[flag + 1];
    if (script !== undefined)
      for (const inner of splitCommands(script))
        inspect(inner, walk, depth + 1);
    return;
  }
  if (first === "find") {
    words.forEach((word, index) => {
      if (EXEC_FLAGS.has(word)) {
        const end = words.findIndex((other, at) => at > index && (other === ";" || other === "+"));
        const inner = words.slice(index + 1, end === -1 ? words.length : end);
        inspectWithOwnWords(inner, walk, depth);
      }
    });
    return;
  }
  if (WRAPPERS.has(first)) {
    for (let i = start + 1;i < words.length; i++) {
      const word = baseName(words[i]);
      if (word === "sed" || word === "gsed" || word === "perl") {
        run(i);
        return;
      }
    }
    return;
  }
  run(start);
}
function inspectWithOwnWords(words, walk, depth) {
  if (words.length > 0)
    inspect(words, { cwd: walk.cwd, edits: walk.edits }, depth + 1);
}
function findInPlaceEdits(command, cwd) {
  const walk = { cwd, edits: [] };
  for (const words of splitCommands(command))
    inspect(words, walk, 0);
  return walk.edits;
}

// src/guards/blocking.ts
var MUTATING_TOOLS = new Set(["edit", "ast_edit", "bash", "eval", "debug", "memory_edit", "manage_skill"]);
var SCRATCH_PREFIX = "local://";
function git(directory, args) {
  return new Promise((resolve4) => {
    execFile("git", ["-C", directory, ...args], { timeout: 5000 }, (error, stdout) => resolve4(error ? undefined : stdout));
  });
}
function nearestExistingDirectory(target) {
  let directory = path6.dirname(target);
  while (!fs3.existsSync(directory) && path6.dirname(directory) !== directory)
    directory = path6.dirname(directory);
  return directory;
}
var gitRepositoryProbe = {
  async containsFile(pattern) {
    const listed = await git(nearestExistingDirectory(pattern), ["ls-files", "--cached", "--others", "--exclude-standard", "--", pattern]);
    return listed !== undefined && listed.trim() !== "";
  },
  async isInside(directory) {
    return (await git(directory, ["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";
  }
};
function stringField(input, key) {
  return isRecord2(input) && typeof input[key] === "string" ? input[key] : undefined;
}
function mutatesState(call) {
  if (MUTATING_TOOLS.has(call.toolName))
    return true;
  if (call.toolName === "write")
    return !(stringField(call.input, "path") ?? "").startsWith(SCRATCH_PREFIX);
  if (call.toolName === "lsp") {
    const action = stringField(call.input, "action");
    return action === "rename" || action === "rename_file" || isRecord2(call.input) && call.input.apply === true;
  }
  return false;
}
function readOnlyLaneFinding(call) {
  if (findLaneAgent(call.agentName)?.access !== "read-only" || !mutatesState(call))
    return;
  return {
    guard: "read-only-lane",
    reason: `${call.agentName} is a read-only pstack lane, so \`${call.toolName}\` is blocked. Do not change files or state: put the change you propose in your report. \`write\` is allowed only for local:// scratch files.`
  };
}
function laneSpawnFinding(call) {
  if (findLaneAgent(call.agentName) === undefined)
    return;
  return {
    guard: "lane-spawn",
    reason: `${call.agentName} is a pstack lane and may not spawn agents. Do the assigned work yourself with your own tools and report back to the parent.`
  };
}
async function inPlaceEditFinding(call, probe) {
  if (call.toolName !== "bash")
    return;
  if (!call.activated && findLaneAgent(call.agentName) === undefined)
    return;
  const command = stringField(call.input, "command");
  if (command === undefined)
    return;
  const cwd = path6.resolve(call.cwd, stringField(call.input, "cwd") ?? ".");
  for (const edit of findInPlaceEdits(command, cwd)) {
    const inRepository = edit.unresolved ? await probe.isInside(cwd) : await anyFile(edit.files, probe);
    if (inRepository) {
      return {
        guard: "in-place-edit",
        reason: `\`${edit.tool} -i\` rewrites repository source behind the editor's back. Use the \`edit\` tool for a text change, or \`ast_edit\` for a structural one.`
      };
    }
  }
  return;
}
async function anyFile(files, probe) {
  for (const file of files)
    if (await probe.containsFile(file))
      return true;
  return false;
}
async function blockingFinding(call, probe = gitRepositoryProbe) {
  if (call.toolName === "task") {
    const spawn = laneSpawnFinding(call);
    if (spawn)
      return spawn;
  }
  return readOnlyLaneFinding(call) ?? await inPlaceEditFinding(call, probe);
}
function spawnFinding(agentName) {
  return laneSpawnFinding({ agentName });
}
function toolCallResult(finding, strictness) {
  if (!finding)
    return;
  if (blocksEnabled(strictness))
    return { block: true, reason: finding.reason };
  if (warningsEnabled(strictness))
    return { additionalContext: `pstack guard (warning, not blocked): ${finding.reason}` };
  return;
}

// src/observe.ts
var PLAYBOOK_PATH = /(?:^|\/)poteto-mode\/playbooks\/([a-z0-9][a-z0-9-]*)\.md(?:[:#?].*)?$/;
var CLOSING_PLAYBOOK = "opening-a-pr";
var MAX_CURRENT_LENGTH = 120;
function playbookOpenedBy(event, current) {
  if (event.toolName !== "read" || event.isError || !isRecord2(event.input) || typeof event.input.path !== "string")
    return;
  const playbook = PLAYBOOK_PATH.exec(event.input.path)?.[1];
  if (playbook === CLOSING_PLAYBOOK && current !== undefined)
    return;
  return playbook;
}
function progressFromTodo(event) {
  if (event.toolName !== "todo" || event.isError || !isRecord2(event.details) || !Array.isArray(event.details.phases))
    return;
  let done = 0;
  let total = 0;
  let current;
  for (const phase of event.details.phases) {
    if (!isRecord2(phase) || !Array.isArray(phase.tasks))
      return;
    for (const task of phase.tasks) {
      if (!isRecord2(task) || typeof task.content !== "string")
        return;
      total += 1;
      if (task.status === "completed" || task.status === "abandoned")
        done += 1;
      else if (task.status === "in_progress" && current === undefined)
        current = task.content.slice(0, MAX_CURRENT_LENGTH);
    }
  }
  return total === 0 ? undefined : { done, total, ...current === undefined ? {} : { current } };
}

// src/setup/catalog.ts
var PROVIDER_ORDER = ["anthropic", "openai-codex", "openai"];
function providerRank(provider) {
  const index = PROVIDER_ORDER.indexOf(provider);
  return index === -1 ? PROVIDER_ORDER.length : index;
}
function listChoices(models) {
  const seen = new Set;
  const choices = [];
  for (const model of models.list()) {
    const spec = `${model.provider}/${model.id}`;
    if (seen.has(spec))
      continue;
    seen.add(spec);
    choices.push({ spec, provider: model.provider, id: model.id, name: model.name || model.id, vendor: models.family(model), efforts: model.reasoning ? model.thinking?.efforts ?? [] : [] });
  }
  return choices.sort((a, b) => providerRank(a.provider) - providerRank(b.provider) || a.spec.localeCompare(b.spec, undefined, { numeric: true }));
}

// src/setup/presets.ts
var PRESET_NAMES = ["claude-only", "claude-codex", "lean"];
var PRESET_DESCRIPTIONS = {
  "claude-only": "Claude on every work role and a three-model Claude panel (seats A to C).",
  "claude-codex": "claude-only plus one Codex seat, with Codex as judge. On roles you already have, only adds the seat and moves the judge.",
  lean: "Cheaper models for work roles and the judge; a two-seat panel (A and B)."
};
function specWithThinking(roleId, choice, profile, base) {
  const kind = MODEL_ROLES.find((role) => role.id === roleId)?.kind;
  const step = kind === "panel" && profile === "lean" ? -1 : roleId === "pstack-judge" && profile === "balanced" ? 1 : 0;
  const level = clampThinking(stepThinking(base, step), choice.efforts);
  return level === undefined ? choice.spec : `${choice.spec}:${level}`;
}
var CLAUDE = "anthropic";
var CODEX_PROVIDER = "openai-codex";
var CODEX_VENDOR = "openai";
var TOP = /opus|\bpro\b|max|ultra/i;
var CHEAP = /haiku|mini|nano|flash|lite|small|spark/i;
var isSnapshot = (choice) => /-\d{8}$/.test(choice.id);
function tier(choice) {
  if (TOP.test(choice.id))
    return 0;
  return CHEAP.test(choice.id) ? 2 : 1;
}
function rank(pool) {
  const ranked = pool.filter((choice, index) => pool.findIndex((other) => modelKey(other.spec) === modelKey(choice.spec)) === index).sort((a, b) => tier(a) - tier(b) || Number(isSnapshot(a)) - Number(isSnapshot(b)) || b.id.localeCompare(a.id, undefined, { numeric: true }));
  const first = ranked[0];
  if (!first)
    return;
  return {
    top: first,
    mid: ranked.find((choice) => tier(choice) === 1) ?? first,
    cheap: ranked.find((choice) => tier(choice) === 2) ?? ranked[ranked.length - 1],
    ranked
  };
}
function seatPicks(tiers, order, count) {
  const picked = new Map;
  for (const choice of [...order.map((name) => tiers[name]), ...tiers.ranked]) {
    if (!picked.has(modelKey(choice.spec)))
      picked.set(modelKey(choice.spec), choice);
  }
  return [...picked.values()].slice(0, count);
}
function assign(work, seats, spec) {
  const assignment = Object.fromEntries(work.map(([role, choice]) => [role, spec(role, choice)]));
  PANEL_SEATS.forEach((seat, index) => {
    const choice = seats[index];
    assignment[seatRoleId(seat)] = choice && spec(seatRoleId(seat), choice);
  });
  return assignment;
}
var CLAUDE_SEATS = 3;
var LEAN_SEATS = 2;
function presetAssignment(name, choices, current = {}, base = DEFAULT_THINKING) {
  const claude = rank(choices.filter((choice) => choice.vendor === CLAUDE));
  const codexPool = choices.filter((choice) => choice.provider === CODEX_PROVIDER);
  const codexChoices = codexPool.length > 0 ? codexPool : choices.filter((choice) => choice.vendor === CODEX_VENDOR);
  const codex = rank(codexChoices);
  const spec = (roleId, choice) => specWithThinking(roleId, choice, name === "lean" ? "lean" : "balanced", base);
  switch (name) {
    case "claude-only":
      if (!claude)
        return;
      return assign(claudeWork(claude, claude.top), seatPicks(claude, ["top", "mid", "cheap"], CLAUDE_SEATS), spec);
    case "claude-codex": {
      if (!claude || !codex)
        return;
      if (MODEL_ROLES.some((role) => current[role.id] !== undefined)) {
        const seatIds = PANEL_SEATS.map(seatRoleId);
        const codexKeys = new Set(codexChoices.map((choice) => modelKey(choice.spec)));
        const hasCodexSeat = seatIds.some((id) => current[id] !== undefined && codexKeys.has(modelKey(current[id])));
        const freeSeat = seatIds.find((id) => current[id] === undefined) ?? seatIds[seatIds.length - 1];
        return { ...current, "pstack-judge": spec("pstack-judge", codex.top), ...hasCodexSeat ? {} : { [freeSeat]: spec(freeSeat, codex.top) } };
      }
      return assign(claudeWork(claude, codex.top), [...seatPicks(claude, ["top", "mid", "cheap"], CLAUDE_SEATS), codex.top], spec);
    }
    case "lean": {
      const pool = claude ?? rank(choices);
      if (!pool)
        return;
      return assign([
        ["pstack-explore", pool.cheap],
        ["pstack-build", pool.mid],
        ["pstack-mechanical", pool.cheap],
        ["pstack-design", pool.mid],
        ["pstack-judge", pool.mid],
        ["pstack-security", pool.mid]
      ], seatPicks(pool, ["mid", "cheap", "top"], LEAN_SEATS), spec);
    }
  }
}
function claudeWork(claude, judge) {
  return [
    ["pstack-explore", claude.cheap],
    ["pstack-build", claude.mid],
    ["pstack-mechanical", claude.cheap],
    ["pstack-design", claude.top],
    ["pstack-judge", judge],
    ["pstack-security", claude.top]
  ];
}

// src/setup/probe.ts
import { completeSimple } from "@oh-my-pi/pi-ai";
var PROBE_TIMEOUT_MS = 30000;
function createModelProbe(ctx, timeoutMs = PROBE_TIMEOUT_MS) {
  return async (spec) => {
    const model = ctx.models.resolve(spec);
    if (!model)
      return { ok: false, reason: "the OMP registry does not serve it" };
    const reply = await completeSimple(model, { messages: [{ role: "user", content: "Reply with the single word OK.", timestamp: Date.now() }] }, { apiKey: ctx.modelRegistry.resolver(model), signal: AbortSignal.timeout(timeoutMs), maxTokens: 64 });
    return reply.stopReason === "error" || reply.stopReason === "aborted" ? { ok: false, reason: reply.errorMessage ?? `the call ended with ${reply.stopReason}` } : { ok: true };
  };
}
async function probeAll(specs, probe) {
  const results = await Promise.all([...new Set(specs)].map(async (spec) => {
    try {
      const result = await probe(spec);
      return result.ok ? undefined : { spec, reason: result.reason };
    } catch (error) {
      return { spec, reason: error instanceof Error ? error.message : String(error) };
    }
  }));
  return results.filter((failure) => failure !== undefined);
}

// src/setup/settings.ts
var PSTACK_ROLE_IDS = new Set(MODEL_ROLES.map((role) => role.id));
var SEAT_IDS = new Set(PANEL_ROLES.map((role) => role.id));
function snapshot(settings) {
  return {
    roles: { ...settings.modelRoles() },
    chains: Object.fromEntries(Object.entries(settings.fallbackChains()).map(([role, chain]) => [role, [...chain]])),
    isolation: settings.taskIsolation()
  };
}
var canonical = (record) => JSON.stringify(Object.entries(record).sort(([a], [b]) => a < b ? -1 : 1));
function sameConfig(a, b) {
  return a.isolation === b.isolation && canonical(a.roles) === canonical(b.roles) && canonical(a.chains) === canonical(b.chains);
}
function targetSnapshot(before, assignment, isolation) {
  const roles = { ...before.roles };
  const chains = { ...before.chains };
  for (const id of PSTACK_ROLE_IDS) {
    const model = assignment[id];
    if (model === undefined)
      delete roles[id];
    else
      roles[id] = model;
    if (SEAT_IDS.has(id)) {
      if (model === undefined)
        delete chains[id];
      else
        chains[id] = [];
    }
  }
  return { roles, chains, isolation };
}
function readAssignment(settings) {
  const roles = settings.modelRoles();
  return Object.fromEntries(MODEL_ROLES.map((role) => [role.id, roles[role.id]]));
}
function applyDiff(settings, from, to) {
  for (const role of new Set([...Object.keys(from.roles), ...Object.keys(to.roles)])) {
    if (from.roles[role] !== to.roles[role])
      settings.setModelRole(role, to.roles[role]);
  }
  for (const role of new Set([...Object.keys(from.chains), ...Object.keys(to.chains)])) {
    if (canonical({ chain: from.chains[role] }) !== canonical({ chain: to.chains[role] }))
      settings.setFallbackChain(role, to.chains[role]);
  }
  if (from.isolation !== to.isolation)
    settings.setTaskIsolation(to.isolation);
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
async function saveAssignment(settings, assignment, isolation) {
  const before = snapshot(settings);
  const target = targetSnapshot(before, assignment, isolation);
  if (sameConfig(before, target))
    return { ok: true, changed: false };
  let reason;
  try {
    applyDiff(settings, before, target);
    await settings.commit();
    if (sameConfig(snapshot(settings), target))
      return { ok: true, changed: true };
    reason = "the stored config differs from what setup wrote";
  } catch (error) {
    reason = message(error);
  }
  try {
    applyDiff(settings, snapshot(settings), before);
    await settings.commit();
    return { ok: false, restored: sameConfig(snapshot(settings), before), reason };
  } catch (error) {
    return { ok: false, restored: false, reason: `${reason}; restoring the previous config failed: ${message(error)}` };
  }
}

// src/setup/flow.ts
var SAVE = "Save";
var CANCEL = "Cancel";
var KEEP_CURRENT = "Current roles";
var UNSET = "Unset";
function roleLabel(role, model) {
  const unset = role.kind === "work" ? `unset, falls back to ${role.fallback}` : "unset, seat absent";
  return `${role.id}: ${model ?? unset}`;
}
function roleTitle(role) {
  return `${role.id}
What: ${role.what}
When: ${role.when}
Recommended: ${role.recommended}`;
}
async function chooseStart(ctx, deps, choices) {
  const current = readAssignment(deps.settings);
  const presets = PRESET_NAMES.flatMap((name) => {
    const assignment = presetAssignment(name, choices, current, deps.defaultThinking);
    return assignment ? [{ name, assignment }] : [];
  });
  const picked = await ctx.ui.select("pstack setup: start from a preset", [
    ...presets.map(({ name }) => ({ label: name, description: PRESET_DESCRIPTIONS[name] })),
    { label: KEEP_CURRENT, description: "Edit the pstack roles already in your config." },
    CANCEL
  ]);
  if (picked === KEEP_CURRENT)
    return { assignment: current, profile: "balanced" };
  const preset = presets.find(({ name }) => name === picked);
  return preset && { assignment: preset.assignment, profile: preset.name === "lean" ? "lean" : "balanced" };
}
async function chooseModel(ctx, deps, role, choices, profile, currentSpec) {
  const picked = await ctx.ui.select(roleTitle(role), [
    ...choices.map((choice2) => ({ label: choice2.spec, description: choice2.name })),
    UNSET
  ]);
  if (picked === undefined)
    return;
  const choice = choices.find((candidate) => candidate.spec === picked);
  if (!choice)
    return { model: undefined };
  if (choice.efforts.length === 0)
    return { model: choice.spec };
  const suggested = currentSpec !== undefined && stripThinking(currentSpec) === choice.spec ? currentSpec : specWithThinking(role.id, choice, profile, deps.defaultThinking);
  const level = await ctx.ui.select(`${role.id} thinking level for ${choice.spec}`, [...choice.efforts], {
    initialIndex: Math.max(0, choice.efforts.indexOf(suggested.slice(choice.spec.length + 1)))
  });
  return level === undefined ? undefined : { model: `${choice.spec}:${level}` };
}
async function save(ctx, deps, notify, choices, assignment) {
  const vendorOf = (spec) => choices.find((choice) => choice.spec === stripThinking(spec))?.vendor ?? spec.split("/")[0];
  const panel = checkPanel(seatModels(assignment), vendorOf);
  if (panel.errors.length > 0) {
    for (const error of panel.errors)
      notify("error", error);
    notify("error", "Nothing was written. Change a seat and save again.");
    return false;
  }
  for (const warning of panel.warnings)
    notify("warning", warning);
  const before = snapshot(deps.settings);
  if (!sameConfig(before, targetSnapshot(before, assignment, before.isolation))) {
    const specs = Object.values(assignment).filter((spec) => spec !== undefined).map(stripThinking);
    notify("info", `Probing ${new Set(specs).size} model(s) with one turn each.`);
    const failures = await probeAll(specs, deps.probe);
    if (failures.length > 0) {
      for (const { spec, reason } of failures)
        notify("error", `${spec} did not answer: ${reason}`);
      notify("error", "Nothing was written. Pick other models and save again.");
      return false;
    }
  }
  let isolation = deps.settings.taskIsolation();
  if (!isolation) {
    isolation = await ctx.ui.confirm("Enable OMP task isolation?", "Panel builders and arena or swarm writers need task.isolation.enabled, which is off in your config. Enabling it changes how every task agent runs. Leave it off to keep your current setting.");
  }
  const result = await saveAssignment(deps.settings, assignment, isolation);
  if (result.ok) {
    notify("info", result.changed ? "pstack model roles saved and read back." : "pstack model roles already match; nothing changed.");
  } else {
    notify("error", `Saving failed: ${result.reason}. ${result.restored ? "Your previous config was restored." : "Restoring your previous config failed: check the model roles in your OMP config."}`);
  }
  return true;
}
async function runSetup(ctx, deps, notify) {
  if (!ctx.hasUI)
    return notify("warning", "/pstack setup is interactive and needs a UI session.");
  const choices = listChoices(ctx.models);
  if (choices.length === 0)
    return notify("error", "The OMP registry serves no models. Log in to a provider, then run /pstack setup again.");
  const start = await chooseStart(ctx, deps, choices);
  if (!start)
    return notify("info", "pstack setup cancelled. Nothing was written.");
  const { assignment, profile } = start;
  for (;; ) {
    const picked = await ctx.ui.select("pstack setup: pick a role to change, or save", [
      ...MODEL_ROLES.map((role2) => roleLabel(role2, assignment[role2.id])),
      SAVE,
      CANCEL
    ]);
    if (picked === undefined || picked === CANCEL)
      return notify("info", "pstack setup cancelled. Nothing was written.");
    if (picked === SAVE) {
      if (await save(ctx, deps, notify, choices, assignment))
        return;
      continue;
    }
    const role = MODEL_ROLES.find((candidate) => picked.startsWith(`${candidate.id}:`));
    const choice = role && await chooseModel(ctx, deps, role, choices, profile, assignment[role.id]);
    if (role && choice)
      assignment[role.id] = choice.model;
  }
}
async function runPreset(ctx, deps, notify, name) {
  if (!ctx.hasUI)
    return notify("warning", "/pstack preset is interactive and needs a UI session.");
  const preset = PRESET_NAMES.find((candidate) => candidate === name);
  if (!preset)
    return notify("warning", `Unknown preset "${name}". Presets: ${PRESET_NAMES.join(", ")}.`);
  const choices = listChoices(ctx.models);
  const assignment = presetAssignment(preset, choices, readAssignment(deps.settings), deps.defaultThinking);
  if (!assignment)
    return notify("error", `The OMP registry does not serve the models the ${preset} preset needs. Log in to the missing provider, or run /pstack setup.`);
  await save(ctx, deps, notify, choices, assignment);
}

// src/setup/index.ts
async function loadSetupSettings(pi, options = {}) {
  return options.settings?.() ?? (await Promise.resolve().then(() => (init_host_settings(), exports_host_settings))).createHostSetupSettings(pi.pi.settings);
}
async function runSetupCommand(pi, ctx, notify, defaultThinking, options = {}) {
  await runSetup(ctx, { settings: await loadSetupSettings(pi, options), probe: options.probe?.(ctx) ?? createModelProbe(ctx), defaultThinking }, notify);
}
async function runPresetCommand(pi, ctx, notify, name, defaultThinking, options = {}) {
  await runPreset(ctx, { settings: await loadSetupSettings(pi, options), probe: options.probe?.(ctx) ?? createModelProbe(ctx), defaultThinking }, notify, name);
}

// src/warn-guards.ts
import * as fs4 from "fs/promises";
import * as path7 from "path";

// src/warnings.ts
var CODE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|cs|c|h|cc|cpp|hpp|sh|bash|zsh|lua|sql)$/i;
var COMMENT_LEADER = /^\s*(?:\/\/+\s*|#\s+|--\s+)(.+?)\s*$/;
var NARRATING = /^(?:now|first|then|next|finally|here(?:'s| we)|we|let's|loop(?:ing)? (?:over|through)|iterat(?:e|es|ing)|increment(?:s|ing)?|decrement(?:s|ing)?|initiali[sz]e(?:s)?|creat(?:e|es|ing)|set(?:s|ting)?|get(?:s|ting)?|call(?:s|ing)?|check(?:s|ing)? (?:if|whether)|return(?:s|ing)?|import(?:s)?|defin(?:e|es|ing)|declar(?:e|es|ing)|assign(?:s|ing)?|add(?:s|ing)?|updat(?:e|es|ing)|print(?:s|ing)?|log(?:s|ging)?)\b/i;
var MAX_QUOTED = 80;
var MAX_REPORTED = 3;
var SECTION_HEADERS = [/^\[(.+?)#[0-9A-Fa-f]{4}\]$/, /^\*\*\* (?:Update|Add) File: (.+)$/, /^\+\+\+ (?:b\/)?(.+)$/];
function addedLinesOfPatch(patch, path7) {
  const added = [];
  let current = path7;
  for (const line of patch.split(/\r?\n/)) {
    const header = SECTION_HEADERS.map((pattern) => pattern.exec(line)?.[1]).find((match) => match !== undefined);
    if (header !== undefined)
      current = header;
    else if (line.startsWith("+"))
      added.push({ path: current, text: line.slice(1) });
  }
  return added;
}
var linesOf = (text, path7) => text.split(/\r?\n/).map((line) => ({ path: path7, text: line }));
function addedLines(toolName, input) {
  const path7 = typeof input.path === "string" ? input.path : undefined;
  if (toolName === "write")
    return typeof input.content === "string" ? linesOf(input.content, path7) : [];
  if (toolName !== "edit")
    return [];
  if (typeof input.new_string === "string")
    return linesOf(input.new_string, path7);
  if (typeof input.input === "string")
    return addedLinesOfPatch(input.input, path7);
  if (Array.isArray(input.edits)) {
    return input.edits.flatMap((entry) => isRecord2(entry) && typeof entry.diff === "string" ? addedLinesOfPatch(entry.diff, path7) : []);
  }
  return [];
}
function narratingComments(toolName, input) {
  const found = [];
  for (const { path: path7, text } of addedLines(toolName, input)) {
    if (path7 === undefined || !CODE_FILE.test(path7))
      continue;
    const comment = COMMENT_LEADER.exec(text)?.[1];
    if (comment !== undefined && NARRATING.test(comment))
      found.push(comment.slice(0, MAX_QUOTED));
  }
  return found;
}
function narratingCommentsWarning(comments) {
  const quoted = comments.slice(0, MAX_REPORTED).map((comment) => `"${comment}"`).join(", ");
  return `pstack warning: this edit adds comments that narrate the code (${quoted}). Name the thing in code instead and keep a comment only for a why the code cannot show. Remove them in your next edit.`;
}
var STOP_WORD = /^(?:the|and|for|with|over|that|this|from|into|each|any|its|your|you|when|then|than|not|per|one|are|has|have)$/;
var SENTENCE_END = /[.:;](?:\s|$)/;
var KEYWORDS_PER_STEP = 6;
function playbookSteps(markdown) {
  const steps = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(\d+)\. (.+)$/.exec(line);
    if (match)
      steps.push({ number: Number(match[1]), text: match[2] });
  }
  return steps;
}
var stems = (text) => (text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((word) => !STOP_WORD.test(word)).map((word) => word.slice(0, 4));
function stepKeywords(step) {
  const plain = step.text.replace(/[*`_]/g, "");
  const lead = plain.slice(0, SENTENCE_END.exec(plain)?.index ?? plain.length);
  return [...new Set(stems(lead))].slice(0, KEYWORDS_PER_STEP);
}
function missingSteps(items, steps) {
  const itemStems = items.map((item) => new Set(stems(item)));
  return steps.filter((step) => {
    const keywords = stepKeywords(step);
    if (keywords.length === 0)
      return false;
    const needed = Math.ceil(keywords.length / 2);
    return !itemStems.some((words) => keywords.filter((keyword) => words.has(keyword)).length >= needed);
  });
}
function todoInitItems(input) {
  if (input.op !== "init")
    return;
  const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  const phased = Array.isArray(input.list) ? input.list.flatMap((phase) => isRecord2(phase) ? strings(phase.items) : []) : [];
  return [...phased, ...strings(input.items)];
}
var STEP_LABEL_LENGTH = 70;
function missingStepsWarning(playbook, missing) {
  const named = missing.map((step) => `step ${step.number} (${step.text.replace(/[*`]/g, "").slice(0, STEP_LABEL_LENGTH).trim()})`).join("; ");
  return `pstack warning: the todo list does not copy every step of the ${playbook} playbook. Missing: ${named}. Append an item for each, or mark it n/a with the reason.`;
}
var requiresCheckpoint = (markdown) => /throughput checkpoint/i.test(markdown);
var roleOf = (message2) => isRecord2(message2) ? message2.role : undefined;
var blocksOf = (message2) => isRecord2(message2) && Array.isArray(message2.content) ? message2.content.filter((block) => isRecord2(block)) : [];
var assistantText = (message2) => blocksOf(message2).flatMap((block) => block.type === "text" && typeof block.text === "string" ? [block.text] : []).join(`
`);
var CHECKPOINT_MENTION = /throughput checkpoint|blocking first steps/i;
function checkpointWritten(messages) {
  return messages.some((message2) => roleOf(message2) === "assistant" && (CHECKPOINT_MENTION.test(assistantText(message2)) || blocksOf(message2).some((block) => block.type === "toolCall" && CHECKPOINT_MENTION.test(JSON.stringify(block.arguments ?? {})))));
}
var checkpointWarning = "pstack warning: no throughput checkpoint yet. Write it as four todo items (blocking first steps, independent workstreams, shared mutable state, smallest safe decomposition), marking a dimension n/a with its reason, then finish your answer.";
var MUTATING_TOOL = /^(?:edit|write|ast_edit)$/;
var RUNNING_TOOL = /^(?:bash|eval|browser|debug)$/;
var DONE_CLAIM = /(?<!not )(?<!n't )\b(?:done|finished|completed?|implemented|fixed|resolved|all (?:the )?tests (?:pass|are green)|ready (?:to merge|for review)|works now)\b/i;
function currentTurn(messages) {
  const lastPrompt = messages.findLastIndex((message2) => roleOf(message2) === "user" && !(isRecord2(message2) && message2.synthetic === true));
  return messages.slice(lastPrompt + 1);
}
function doneWithoutRuntimeProof(messages) {
  const turn = currentTurn(messages);
  const reply = turn.findLast((message2) => roleOf(message2) === "assistant");
  if (reply === undefined || !DONE_CLAIM.test(assistantText(reply)))
    return false;
  let unproven = false;
  for (const message2 of turn) {
    if (roleOf(message2) !== "toolResult" || !isRecord2(message2) || message2.isError === true || typeof message2.toolName !== "string")
      continue;
    if (MUTATING_TOOL.test(message2.toolName))
      unproven = true;
    else if (RUNNING_TOOL.test(message2.toolName))
      unproven = false;
  }
  return unproven;
}
var doneWithoutProofWarning = "pstack warning: your reply claims the work is done, but nothing ran after your last edit. Run the changed behavior on its real surface (the test, command, or app) and report what you saw, or say that it is unverified.";

// src/warn-guards.ts
var PLAYBOOK_NAME = /^[a-z0-9][a-z0-9-]*$/;
function createWarningGuards(options) {
  const { behavior, activation, skillDirectory } = options;
  let checkpointWarned = false;
  const readPlaybook = async (name) => PLAYBOOK_NAME.test(name) ? fs4.readFile(path7.join(skillDirectory, "playbooks", `${name}.md`), "utf8").catch(() => {
    return;
  }) : undefined;
  return {
    async onToolResult(event, ctx) {
      if (event.isError || !warningsEnabled(behavior.current().guardStrictness))
        return;
      const { active, playbook } = activation.state();
      const lane = findLaneAgent(ctx.agent?.name ?? "") !== undefined;
      if (!active && !lane)
        return;
      const warnings = [];
      const comments = narratingComments(event.toolName, event.input);
      if (comments.length > 0)
        warnings.push(narratingCommentsWarning(comments));
      const items = event.toolName === "todo" ? todoInitItems(event.input) : undefined;
      const text = active && items !== undefined && playbook !== undefined ? await readPlaybook(playbook) : undefined;
      if (items !== undefined && playbook !== undefined && text !== undefined) {
        const missing = missingSteps(items, playbookSteps(text));
        if (missing.length > 0)
          warnings.push(missingStepsWarning(playbook, missing));
      }
      return warnings.length === 0 ? undefined : { additionalContext: warnings.join(`

`) };
    },
    async onSessionStop(event, ctx) {
      const { active, playbook } = activation.state();
      if (!active || event.stop_hook_active || !warningsEnabled(behavior.current().guardStrictness))
        return;
      const warnings = [];
      const playbookText = !checkpointWarned && playbook !== undefined ? await readPlaybook(playbook) : undefined;
      if (playbookText !== undefined && requiresCheckpoint(playbookText)) {
        const history = ctx.sessionManager.getBranch().flatMap((entry) => entry.type === "message" ? [entry.message] : []);
        if (!checkpointWritten([...history, ...event.messages])) {
          checkpointWarned = true;
          warnings.push(checkpointWarning);
        }
      }
      if (doneWithoutRuntimeProof(event.messages))
        warnings.push(doneWithoutProofWarning);
      return warnings.length === 0 ? undefined : { continue: true, additionalContext: warnings.join(`

`) };
    },
    reset() {
      checkpointWarned = false;
    }
  };
}

// src/index.ts
var COMMAND_USAGE = "Usage: /pstack [status|setup|preset <name>|doctor]";
var PSTACK_MENU = [
  { command: "status", label: "Status", description: "Show the Activation state of this Agent Session" },
  { command: "setup", label: "Setup", description: "Pick models for the pstack-* model roles" },
  ...PRESET_NAMES.map((name) => ({ command: `preset ${name}`, label: `Preset: ${name}`, description: `Apply the ${name} preset to the pstack-* model roles` })),
  { command: "doctor", label: "Doctor", description: "Check roles, panel seats, skills, Instruction Modes, display and isolation" }
];
function commandCompletions(prefix) {
  const normalized = prefix.trimStart().toLowerCase();
  const matches = PSTACK_MENU.filter((item) => item.command.startsWith(normalized));
  return matches.length > 0 ? matches.map((item) => ({ value: item.command, label: item.command, description: item.description })) : null;
}
function notify(pi, ctx, level, message2) {
  if (ctx.hasUI)
    ctx.ui.notify(message2, level);
  else
    pi.logger[level === "warning" ? "warn" : level](message2);
}
function pstackExtension(pi, options = {}) {
  const behavior = createBehaviorStore(pi.events, { ...options, onWarning: (message2) => pi.logger.warn(message2) });
  const activation = createActivationStore((customType, data) => pi.appendEntry(customType, data));
  const publisher = connectSharedDisplay(pi.events, "pstack");
  let stopDropouts;
  let disposed = false;
  const skillDirectory = options.skillDirectory ?? DEFAULT_POTETO_DIRECTORY;
  const panelSeats = (ctx) => activeSeats(ctx.models, behavior.current().maxPanelSize);
  const sendRoster = (seats) => pi.sendMessage({ customType: ROSTER_MESSAGE_TYPE, content: rosterText(seats), display: false }, { deliverAs: "nextTurn" });
  const suspendModes = (entries = []) => {
    const reenabled = reenabledInstructionModes(entries, SUSPENDABLE_INSTRUCTION_MODES);
    const modes = SUSPENDABLE_INSTRUCTION_MODES.filter((mode) => suspendsMode(behavior.current(), mode) && !reenabled.includes(mode));
    suspendInstructionModes(pi.events, "pstack", modes);
  };
  activation.subscribe((state, change) => {
    if (disposed)
      return;
    if (state.active && change === "activated")
      suspendModes();
    const text = segmentText(state);
    publisher.publish(text === undefined ? null : { frames: [[text]] });
  });
  const warnings = createWarningGuards({ behavior, activation, skillDirectory });
  const restore = (ctx) => {
    warnings.reset();
    activation.restore(ctx.sessionManager.getBranch());
  };
  const activate = (ctx, task) => {
    const seats = panelSeats(ctx);
    if (!activation.activate({ task, seats: seats.map((seat) => seat.seat) }))
      return false;
    sendRoster(seats);
    return true;
  };
  let panelInputSeen = false;
  const announceSeats = (ctx) => {
    if (activation.state().active)
      return;
    sendRoster(panelSeats(ctx));
  };
  pi.on("session_start", (_event, ctx) => {
    behavior.reload();
    stopDropouts?.();
    stopDropouts = watchDropouts(pi.events, (dropout) => {
      pi.appendEntry(DROPOUT_ENTRY_TYPE, dropout);
      activation.noteDropout(dropout);
    }, (receipt) => activation.recordReceipt(receipt));
    restore(ctx);
    if (activation.state().active)
      suspendModes(ctx.sessionManager.getBranch());
  });
  pi.on("session_switch", (_event, ctx) => restore(ctx));
  pi.on("session_branch", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", () => {
    disposed = true;
    stopDropouts?.();
    stopDropouts = undefined;
    behavior.dispose();
    publisher.dispose();
  });
  pi.on("before_subagent_spawn", (event, ctx) => {
    const finding = spawnFinding(ctx.agent.name);
    if (finding && blocksEnabled(behavior.current().guardStrictness))
      return { block: true, reason: finding.reason };
    return guardSeatSpawn(event, ctx, behavior.current().maxPanelSize);
  });
  pi.on("tool_call", async (event, ctx) => {
    const strictness = behavior.current().guardStrictness;
    if (strictness === "off")
      return;
    const finding = await blockingFinding({
      toolName: event.toolName,
      input: event.input,
      agentName: ctx.agent.name,
      activated: activation.state().active,
      cwd: ctx.cwd
    });
    return toolCallResult(finding, strictness);
  });
  pi.on("input", (event, ctx) => {
    const task = event.source === "extension" ? undefined : taskOfSkillInput(event.text);
    if (task !== undefined)
      activate(ctx, task);
    else if (event.source !== "extension" && isPanelSkillInput(event.text)) {
      panelInputSeen = true;
      announceSeats(ctx);
    }
    return;
  });
  pi.on("message_start", (event, ctx) => {
    const task = taskOfSkillPrompt(event.message);
    if (task !== undefined)
      activate(ctx, task);
    else if (isPanelSkillPrompt(event.message)) {
      if (!panelInputSeen)
        announceSeats(ctx);
      panelInputSeen = false;
    }
  });
  pi.on("tool_result", (event, ctx) => {
    const state = activation.state();
    if (state.active) {
      const playbook = playbookOpenedBy(event, state.playbook);
      if (playbook !== undefined)
        activation.setPlaybook(playbook);
      const progress = progressFromTodo(event);
      if (progress !== undefined)
        activation.setProgress(progress);
    }
    return warnings.onToolResult(event, ctx);
  });
  pi.on("session_stop", (event, ctx) => warnings.onSessionStop(event, ctx));
  pi.on("session_compact", (_event, ctx) => {
    const state = activation.state();
    if (!state.active)
      return;
    pi.sendMessage({ customType: REMINDER_MESSAGE_TYPE, content: reminderText(state), display: false }, { deliverAs: "nextTurn" });
    sendRoster(panelSeats(ctx));
  });
  pi.registerCommand("poteto", {
    description: "Start pstack's poteto-mode on a task",
    handler: async (args, ctx) => {
      const task = args.trim();
      let prompt;
      try {
        prompt = await buildPotetoPrompt(skillDirectory, task);
      } catch (error) {
        notify(pi, ctx, "error", `Unable to read the vendored ${POTETO_SKILL} skill: ${String(error)}`);
        return;
      }
      activate(ctx, task);
      if (ctx.isIdle()) {
        pi.sendUserMessage(prompt);
        return;
      }
      pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      notify(pi, ctx, "info", "poteto-mode queued as follow-up.");
    }
  });
  pi.registerCommand("pstack", {
    description: "pstack: status, setup, preset, doctor",
    getArgumentCompletions: commandCompletions,
    handler: async (args, ctx) => {
      let argument = args.trim();
      if (!argument && ctx.hasUI) {
        const choice = await ctx.ui.select("pstack", PSTACK_MENU.map(({ label, description }) => ({ label, description })));
        const selected = PSTACK_MENU.find((item) => item.label === choice);
        if (!selected)
          return;
        argument = selected.command;
      }
      const [subcommand = "", ...rest] = argument.split(/\s+/);
      const report = (level, message2) => notify(pi, ctx, level, message2);
      if (subcommand === "" || subcommand === "status")
        notify(pi, ctx, "info", statusReport(activation.state()));
      else if (subcommand === "setup")
        await runSetupCommand(pi, ctx, report, behavior.current().defaultThinking, options.setup);
      else if (subcommand === "preset")
        await runPresetCommand(pi, ctx, report, rest[0] ?? "", behavior.current().defaultThinking, options.setup);
      else if (subcommand === "doctor") {
        try {
          const findings = diagnose({
            models: ctx.models,
            settings: await loadSetupSettings(pi, options.setup),
            behavior: behavior.current(),
            commands: pi.getCommands(),
            skillsRoot: path8.dirname(skillDirectory),
            displayHostAvailable: publisher.hostAvailable
          });
          notify(pi, ctx, doctorLevel(findings), doctorReport(findings));
        } catch (error) {
          notify(pi, ctx, "error", `pstack doctor could not run: ${String(error)}`);
        }
      } else
        notify(pi, ctx, "warning", `Unknown /pstack subcommand. ${COMMAND_USAGE}`);
    }
  });
}
export {
  pstackExtension as default
};
