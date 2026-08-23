// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

import { WebAudioLipSyncer } from "../dist/index.js";
import { encodePcm16Wav } from "./wav.js";

const recordToggle = document.querySelector("#record-toggle");
const playAgainButton = document.querySelector("#play-again");
const recordAgainButton = document.querySelector("#record-again");
const actions = document.querySelector("#actions");
const audio = document.querySelector("#audio");
const mouth = document.querySelector("#mouth");
const status = document.querySelector("#status");
const timer = document.querySelector("#timer");
const liveVisemeLabel = document.querySelector("#live-viseme");
const modeLabel = document.querySelector("#mode-label");
const visemeLabel = document.querySelector("#viseme");
const confetti = document.querySelector("#confetti");
const micButton = recordToggle;

const CONFETTI_COLORS = ["#4c63b6", "#40c3f7", "#f9703e", "#98aeeb"];

let recording = null;
let playbackUrl = null;
let visemeTimeline = [];
let playbackFrame = 0;
let liveLevel = 0;
let levelFrame = 0;
let timerFrame = 0;
let timerStart = 0;

function setStage(stage) {
  document.body.dataset.stage = stage;
}

function setMode(mode) {
  document.body.dataset.mode = mode;
}

function setMouth(viseme) {
  const safeViseme = Number.isInteger(viseme) && viseme >= 0 && viseme <= 11 ? viseme : 0;
  mouth.src = `./mouths/viseme-${safeViseme}.svg`;
  visemeLabel.textContent = String(safeViseme);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function startTimer() {
  timerStart = performance.now();
  const tick = () => {
    timer.textContent = formatTime((performance.now() - timerStart) / 1000);
    timerFrame = requestAnimationFrame(tick);
  };
  tick();
}

function stopTimer() {
  cancelAnimationFrame(timerFrame);
}

function startLevelMeter() {
  const decay = () => {
    liveLevel *= 0.9;
    micButton.style.setProperty("--level", liveLevel.toFixed(3));
    levelFrame = requestAnimationFrame(decay);
  };
  decay();
}

function stopLevelMeter() {
  cancelAnimationFrame(levelFrame);
  liveLevel = 0;
  micButton.style.setProperty("--level", "0");
}

function burstConfetti() {
  confetti.classList.remove("burst");
  confetti.replaceChildren();
  for (let i = 0; i < 18; i += 1) {
    const piece = document.createElement("span");
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.setProperty("--x", `${((Math.random() * 2 - 1) * 240).toFixed(0)}px`);
    piece.style.setProperty("--peak", `${(-140 - Math.random() * 160).toFixed(0)}px`);
    piece.style.setProperty("--r", `${((Math.random() * 2 - 1) * 620).toFixed(0)}deg`);
    piece.style.setProperty("--delay", `${(Math.random() * 0.14).toFixed(2)}s`);
    confetti.appendChild(piece);
  }
  // restart the animation even if a burst just ran
  void confetti.offsetWidth;
  confetti.classList.add("burst");
}

function waitForTapStop(pcmTap) {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 1000);
    pcmTap.addEventListener(
      "message",
      event => {
        if (event.data?.type !== "stopped") return;
        clearTimeout(timeout);
        resolve();
      },
      { once: false }
    );
  });
}

async function cleanUpRecording() {
  if (!recording) return;
  recording.stream.getTracks().forEach(track => track.stop());
  recording.pcmTap.close();
  recording.lipSyncer.destroy();
  await recording.context.close();
  recording = null;
}

async function startRecording() {
  setMode("arming");
  status.textContent = "Waking the microphone…";
  let pendingStream = null;
  let pendingContext = null;
  let pendingLipSyncer = null;

  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode !== "function") {
      throw new Error("This browser does not support AudioWorklet microphone capture.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
    pendingStream = stream;
    const context = new AudioContext();
    pendingContext = context;
    await context.resume();
    const source = context.createMediaStreamSource(stream);

    status.textContent = "Loading the local model…";
    const lipSyncer = await WebAudioLipSyncer.create(context, { sourceNode: source });
    pendingLipSyncer = lipSyncer;
    const pcmTap = lipSyncer.createPcmTap();

    const state = {
      context,
      lipSyncer,
      pcmChunks: [],
      pcmStartTimestamp: null,
      pcmTap,
      stream,
      visemes: []
    };
    recording = state;

    pcmTap.addEventListener("message", event => {
      if (event.data?.type !== "audio" || !event.data.samples) return;
      if (state.pcmStartTimestamp === null) state.pcmStartTimestamp = event.data.timestamp;
      const chunk = new Float32Array(event.data.samples);
      state.pcmChunks.push(chunk);

      let energy = 0;
      for (let i = 0; i < chunk.length; i += 1) energy += chunk[i] * chunk[i];
      const rms = Math.sqrt(energy / (chunk.length || 1));
      liveLevel = Math.max(liveLevel, Math.min(1, rms * 4));
    });
    pcmTap.start();

    lipSyncer.addEventListener("viseme", event => {
      const frame = event.detail;
      liveVisemeLabel.textContent = String(frame.viseme);
      state.visemes.push({ timestamp: frame.effectiveTimestamp ?? frame.timestamp, viseme: frame.viseme });
    });
    lipSyncer.addEventListener("error", event => {
      status.textContent = `Lip-sync error: ${event.detail.message}`;
    });

    pendingStream = null;
    pendingContext = null;
    pendingLipSyncer = null;
    setMode("recording");
    recordToggle.setAttribute("aria-label", "Stop recording");
    status.textContent = "Listening. Tap to stop.";
    startTimer();
    startLevelMeter();
  } catch (error) {
    if (recording) {
      await cleanUpRecording();
    } else {
      pendingStream?.getTracks().forEach(track => track.stop());
      pendingLipSyncer?.destroy();
      if (pendingContext && pendingContext.state !== "closed") await pendingContext.close();
    }
    setMode("idle");
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function stopRecording() {
  if (!recording) return;
  setMode("processing");
  stopTimer();
  stopLevelMeter();
  status.textContent = "Teaching the face your words…";

  try {
    const state = recording;
    const tapStopped = waitForTapStop(state.pcmTap);
    state.lipSyncer.detachPcmTap();
    await tapStopped;

    if (state.pcmStartTimestamp === null || state.pcmChunks.length === 0) {
      throw new Error("No microphone samples were captured. Tap to try again.");
    }

    const wav = encodePcm16Wav(state.pcmChunks, state.context.sampleRate);
    const duration = (wav.byteLength - 44) / 2 / state.context.sampleRate;
    visemeTimeline = [{ time: 0, viseme: 0 }];
    for (const frame of state.visemes) {
      const time = frame.timestamp - state.pcmStartTimestamp;
      if (time < 0 || time > duration) continue;
      const previous = visemeTimeline.at(-1);
      if (previous.viseme !== frame.viseme) visemeTimeline.push({ time, viseme: frame.viseme });
    }

    const blob = new Blob([wav], { type: "audio/wav" });
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = URL.createObjectURL(blob);
    audio.src = playbackUrl;
    await cleanUpRecording();
    reveal();
  } catch (error) {
    await cleanUpRecording();
    setMode("idle");
    recordToggle.setAttribute("aria-label", "Start recording");
    timer.textContent = "0:00.0";
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function reveal() {
  setMode("revealing");
  modeLabel.textContent = "REVEAL";
  setMouth(0);
  setStage("play");
  burstConfetti();
  // let the face finish its entrance before it starts talking
  setTimeout(() => {
    void playRecording();
  }, 750);
}

function visemeAt(time) {
  let low = 0;
  let high = visemeTimeline.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (visemeTimeline[middle].time <= time) low = middle;
    else high = middle - 1;
  }
  return visemeTimeline[low]?.viseme ?? 0;
}

function animatePlayback() {
  setMouth(visemeAt(audio.currentTime));
  if (!audio.paused && !audio.ended) playbackFrame = requestAnimationFrame(animatePlayback);
}

async function playRecording() {
  if (!playbackUrl) return;
  cancelAnimationFrame(playbackFrame);
  audio.currentTime = 0;
  try {
    await audio.play();
  } catch {
    // autoplay was blocked; surface the buttons so a tap can start it
    setMode("done");
    modeLabel.textContent = "READY";
    actions.classList.add("visible");
  }
}

function returnToBooth() {
  audio.pause();
  cancelAnimationFrame(playbackFrame);
  setMouth(0);
  liveVisemeLabel.textContent = "0";
  timer.textContent = "0:00.0";
  recordToggle.setAttribute("aria-label", "Start recording");
  setMode("idle");
  setStage("record");
  status.textContent = "Tap to record";
}

recordToggle.addEventListener("click", () => {
  const mode = document.body.dataset.mode;
  if (mode === "idle") void startRecording();
  else if (mode === "recording") void stopRecording();
});

playAgainButton.addEventListener("click", () => void playRecording());
recordAgainButton.addEventListener("click", returnToBooth);

audio.addEventListener("play", () => {
  cancelAnimationFrame(playbackFrame);
  setMode("playing");
  modeLabel.textContent = "PLAYBACK";
  animatePlayback();
});
audio.addEventListener("pause", () => cancelAnimationFrame(playbackFrame));
audio.addEventListener("ended", () => {
  cancelAnimationFrame(playbackFrame);
  setMouth(0);
  setMode("done");
  modeLabel.textContent = "AGAIN?";
  actions.classList.add("visible");
});

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(playbackFrame);
  cancelAnimationFrame(levelFrame);
  cancelAnimationFrame(timerFrame);
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  if (recording) {
    recording.stream.getTracks().forEach(track => track.stop());
    recording.pcmTap.close();
    recording.lipSyncer.destroy();
    void recording.context.close();
  }
});
