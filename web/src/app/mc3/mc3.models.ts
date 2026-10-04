export interface Mc3C4Channel {
  channel: number;
  name: string;
  remap: number | null;
  presetCc: number;
}

export interface Mc3Summary {
  files: { mc3Backup: string; c4Backup: string | null };
  c4Channel: Mc3C4Channel;
  bankCount: number;
  presetCount: number;
  namedPresetCount: number;
  c4RecallCount: number;
  c4PresetsUsed: number[];

  // device block, straight from the backup header
  schemaVersion: number;
  dumpType: string;
  deviceModel: number;
  description: string;
  downloadDate: string;
  hash: number;

  // general controller settings, spread in by the backend
  midiChannel?: number;
  numMidiCable?: number;
  midiThru?: boolean;
  crossMidiThru?: boolean;
  dualLock?: boolean;
}

export interface Mc3Channel {
  name: string;
  channel: number;
  sendToPort: number;
  remap: number;
  isMidiChannelOffset: boolean;
  engageEnabled: boolean;
  bypassEnabled: boolean;
}

export interface Mc3Message {
  slot: number;
  type: 'note' | 'cc' | 'program' | 'notecc' | 'raw';
  typeId: number;
  channel: number;
  channelName: string;
  toggleGroup: number;
  action: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
  note: string;
  text: string;
}

export interface Mc3C4Recall {
  preset: number;
  name: string;
  via: 'cc' | 'notecc';
  note: number | null;
  toggleGroup: number;
  action: number;
  slot: number;
}

export interface Mc3ChannelGroup {
  channel: number;
  channelName: string;
  messages: Mc3Message[];
}

export interface Mc3Preset {
  kind: 'preset' | 'exp';
  presetNum: number;
  name: string;
  toggleName: string;
  longName: string;
  toToggle: boolean;
  toBlink: boolean;
  toMsgScroll: boolean;
  toggleGroup: number;
  empty: boolean;
  messages: Mc3Message[];
  channels: Mc3ChannelGroup[];
  c4Presets: Mc3C4Recall[];
}

export interface Mc3Bank {
  bankNumber: number;
  bankName: string;
  bankClearToggle: number;
  presets: Mc3Preset[];
  expPresets: Mc3Preset[];
  bankMessages: Mc3Message[];
}

export interface Mc3BanksResponse {
  c4Channel: Mc3C4Channel;
  banks: Mc3Bank[];
}

export interface Mc3C4PresetsResponse {
  productId: number | null;
  stored: number;
  presets: { location: number; name: string }[];
}

export interface Mc3ChannelsResponse {
  channels: Mc3Channel[];
  c4Channel: Mc3C4Channel;
}
