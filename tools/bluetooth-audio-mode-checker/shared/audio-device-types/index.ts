export type SampleRateRange = {
  minimum: number;
  maximum: number;
};

export type RawAudioDevice = {
  id: number;
  name: string;
  uid: string;
  manufacturer: string;
  transport: string;
  sampleRateInput: number | null;
  sampleRateOutput: number | null;
  availableSampleRateRangesInput?: SampleRateRange[];
  nominalSampleRateInput?: number | null;
  actualSampleRateInput?: number | null;
  availableSampleRateRangesOutput?: SampleRateRange[];
  nominalSampleRateOutput?: number | null;
  actualSampleRateOutput?: number | null;
  maxSupportedOutputRate?: number | null;
  inputChannels: number;
  outputChannels: number;
  isRunning: boolean;
  isDefaultInput: boolean;
  isDefaultOutput: boolean;
  isDefaultSystemOutput: boolean;
  bluetoothAddress?: string;
  supportedBluetoothServices?: string[];
};

export type AudioProbeSnapshot = {
  timestamp: string;
  devices: RawAudioDevice[];
};

export type AudioModeCode = "A2DP" | "HFP_HSP" | "UNKNOWN";

export type BluetoothLinkType = "tacl" | "tsco";

export type BluetoothLinkSnapshot = {
  address: string;
  profile: BluetoothLinkType;
  timestamp: string;
};

export type AudioModeAssessment = {
  name: string;
  mode: AudioModeCode;
  label: string;
  confidence: "高" | "中" | "低";
  isActive: boolean;
  isInputActive: boolean;
  inputTransport: string | null;
  bluetoothAddress: string | null;
  audioLinkType: BluetoothLinkType | null;
  audioLinkTypeObservedAt: string | null;
  sampleRateOutput: number | null;
  availableSampleRateRangesOutput: SampleRateRange[];
  nominalSampleRateOutput: number | null;
  actualSampleRateOutput: number | null;
  maxSupportedOutputRate: number | null;
  outputChannels: number;
  sampleRateInput: number | null;
  availableSampleRateRangesInput: SampleRateRange[];
  nominalSampleRateInput: number | null;
  actualSampleRateInput: number | null;
  inputChannels: number;
  isDefaultInput: boolean;
  isDefaultOutput: boolean;
  isDefaultSystemOutput: boolean;
  evidence: string[];
  explanation: string;
  microphoneOccupancy?: MicrophoneOccupancy;
};

export type MicrophoneUser = {
  pid: number;
  name: string;
  bundleId: string;
  devices: string[];
};

export type MicrophoneOccupancy = {
  isInUse: boolean;
  users: MicrophoneUser[];
  multipointSupport: "yes" | "no" | "unknown";
  multipointExplanation: string;
  remoteReleaseSupported: boolean;
  remoteReleaseExplanation: string;
};

export type AudioRouteOption = {
  name: string;
  direction: "input" | "output";
  transport: string;
  channels: number;
  sampleRate: number | null;
  isDefault: boolean;
};

export type AudioModeState = {
  devices: AudioModeAssessment[];
  routes: {
    input: AudioRouteOption[];
    output: AudioRouteOption[];
  };
};

export type ActiveOutputSnapshot = {
  name: string | null;
  nominalSampleRate: number | null;
  actualSampleRate: number | null;
  outputChannels?: number;
  isRunning: boolean;
  defaultInput?: ActiveInputSnapshot;
  timestamp: string;
};

export type ActiveInputSnapshot = {
  name: string | null;
  isRunning: boolean;
  nominalSampleRate?: number | null;
  actualSampleRate?: number | null;
};
