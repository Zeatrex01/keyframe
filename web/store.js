// The page's shared state: the elements it drives, what it knows, and a few constants.

import { DEFAULT_LANG } from './i18n.js';

export const POLL_MS = 1000;
export const VIDEO = /\.(mp4|webm|mov)$/i;
export const PHYSICS_UPDATE = 2; // spine.Physics.update

export const $ = id => document.getElementById(id);
export const el = {};
for (const id of ['app', 'projectName', 'projectSwitch', 'projectThumb', 'barSep', 'agentPill', 'agentDot', 'agentName', 'agentLabel', 'right', 'refPane', 'refPaneSlot', 'stage', 'player',
  'stageNote', 'stageNoteTitle', 'stageNoteBody', 'stageFlipWrap', 'flipSource', 'flipResult', 'stageFile', 'refPaneName', 'clip', 'play', 'playIcon', 'time', 'loop', 'speed',
  'ruler', 'laneLabels', 'lanes', 'laneRange', 'playhead', 'markTools', 'markToggle', 'markStart', 'markEnd', 'markRange', 'markClear', 'markLearn', 'markHint', 'libraryEmpty', 'moves',
  'refCard', 'refThumb', 'refEmpty', 'refName', 'refSync', 'refCompare', 'refAdd', 'refList', 'refStatus', 'refFile', 'refLinkForm', 'refLink', 'refLinkGo', 'refLinkHint', 'refFrom', 'refTo',
  'deliveryEmpty', 'deliveryTop', 'deliveryFile', 'deliveryCheck', 'deliveryNote', 'deliveryActs', 'deliveryFlip', 'deliveryVersions', 'deliveryPlayer',
  'versions', 'versionsEmpty', 'versionsNote', 'deliveryStatus', 'inspectorTabs', 'tabbar', 'keysPanel', 'timeline', 'keysEmpty', 'clipList', 'clipsEmpty', 'clipCount', 'refCount',
  'msgs', 'chatEmpty', 'live', 'liveName', 'livePhase', 'liveSecs', 'liveText', 'stopAgent', 'steps', 'compose', 'suggest', 'text', 'attach', 'send', 'chatHint', 'outsideNote', 'outsideText', 'outsideOpen',
  'navProjects', 'navSettings', 'hub', 'settings', 'openForm', 'openPath', 'createForm', 'createParent', 'createName', 'hubStatus', 'hubEmpty',
  'first', 'firstClient', 'firstCode', 'firstDirector', 'firstDirectorGo', 'firstCopy', 'firstDot', 'firstStatusText', 'firstConnect', 'firstOpen', 'firstExamples', 'firstFolder',
  'hubNew', 'hubOpen', 'openBrowse', 'createBrowse', 'exampleList', 'projectFilter',
  'projectList', 'addonList', 'spineAddon', 'spineState', 'spineAccept', 'spineToggle', 'spineLicense', 'spineStatus', 'checkDot', 'checkText', 'checkButton', 'settingsLang', 'settingsTheme', 'aboutTitle', 'aboutFolder', 'aboutData', 'updatePill', 'updatePillText', 'updateBox', 'updateState', 'updateNotes', 'updateNotesText', 'updateCheckNow', 'updateInstall', 'updateAuto', 'updateStatus', 'settingsNav', 'settingsDesktop', 'firstDesktop', 'settingsClient', 'clientWhere', 'clientCode', 'clientJson', 'clientMore',
  'agentSlots', 'slotList', 'slotAdd', 'slotStatus', 'externalTitle', 'splash', 'splashPlayer', 'splashSkip', 'splashStatus',
  'modeSwitch', 'modeAnimate', 'modeDraw', 'draw', 'drawTools', 'drawAsk', 'drawPick', 'drawCount', 'drawParts', 'drawStage', 'drawSvg', 'drawEmpty', 'drawBones', 'drawZoom',
  'drawLive', 'drawLiveLabel', 'drawReplay', 'drawSpeed', 'drawName', 'drawSummary', 'drawUndo', 'drawSave', 'drawStatus', 'drawConflict', 'drawConflictText', 'drawConflictLoad', 'drawConflictCopy', 'drawPartTitle', 'drawPartKind', 'drawProps']) el[id] = $(id);

export const S = {
  lang: DEFAULT_LANG, dict: {},
  state: null, online: true,
  serverVersion: '',     // the studio version this page loaded from (a new one after an update reloads the page)
  update: null,         // GET /api/update: the packaged app's update status
  seen: new Set(), lastId: 0, sendError: '',
  shown: null,          // the skeleton record on the stage
  picked: null,         // the file the owner flipped the stage to (a delivery's base or a base's delivery), or null
  shownKey: '',         // file + modified of what the player holds
  serverShow: '',       // the last show the server asked for
  anim: null, loop: true, speed: 1,
  player: null, token: 0, ready: false, stageError: null,
  refs: [], ref: null, media: null, wrap: null, layer: null, area: null, sync: true, compare: false, lastTime: 0,
  focus: null, focusStamp: null, focusEpoch: 0, marking: false, drag: null,
  check: null, history: null, confirming: null, deliveryMessage: null,
  linkBusy: false,
  view: 'work', projectDir: undefined, projects: null, settings: null, firstDismissed: false,
  tab: 'clips', phoneTab: 'chat',   // the inspector's panel, and the phone's (see panels.js)
};
