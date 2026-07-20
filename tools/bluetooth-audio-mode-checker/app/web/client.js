import { createA2dpRecoveryController } from "/a2dp-recovery-client.js";
import { startBluetoothAudioModePage } from "/bluetooth-audio-mode-client.js";
import { createSpeakerOccupancyController } from "/speaker-occupancy-client.js";

startBluetoothAudioModePage(createA2dpRecoveryController, createSpeakerOccupancyController);
