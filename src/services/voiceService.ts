import { apiBridge } from './apiBridge';

export interface VoiceState {
  isEnabled: boolean;
  isSpeaking: boolean;
  isSynthesizing: boolean;
  activeMessageId: string | null;
  error: string | null;
}

export class VoiceService {
  private isVoiceEnabled: boolean = true;
  private isSpeakingAudio: boolean = false;
  private isSynthesizingAudio: boolean = false;
  private currentActiveMessageId: string | null = null;
  private lastErrorMessage: string | null = null;

  private currentAudioElement: HTMLAudioElement | null = null;
  private currentSourceNode: AudioBufferSourceNode | null = null;
  private audioContext: AudioContext | null = null;
  private playbackGenerationId: number = 0;
  private listeners: Set<(state: VoiceState) => void> = new Set();

  constructor() {
    try {
      const saved = localStorage.getItem('nexus_voice_enabled');
      if (saved !== null) {
        this.isVoiceEnabled = saved === 'true';
      }
    } catch {
      this.isVoiceEnabled = true;
    }

    this.setupAudioContextUnlock();
  }

  private setupAudioContextUnlock(): void {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      try {
        const ctx = this.getOrCreateAudioContext();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      } catch {}
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };

    window.addEventListener('click', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true, passive: true });
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  }

  private getOrCreateAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      try {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass) {
          this.audioContext = new AudioCtxClass();
        }
      } catch (err) {
        console.warn('[NEXUS Voice] Failed to create AudioContext:', err);
      }
    }
    return this.audioContext;
  }

  public getState(): VoiceState {
    return {
      isEnabled: this.isVoiceEnabled,
      isSpeaking: this.isSpeakingAudio,
      isSynthesizing: this.isSynthesizingAudio,
      activeMessageId: this.currentActiveMessageId,
      error: this.lastErrorMessage,
    };
  }

  public subscribe(listener: (state: VoiceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('Error notifying voice listener:', err);
      }
    });
  }

  public isEnabled(): boolean {
    return this.isVoiceEnabled;
  }

  public setEnabled(enabled: boolean): void {
    this.isVoiceEnabled = enabled;
    try {
      localStorage.setItem('nexus_voice_enabled', String(enabled));
    } catch {
      // ignore
    }
    if (!enabled && (this.isSpeakingAudio || this.isSynthesizingAudio)) {
      this.stop();
    }
    this.notify();
  }

  public toggle(): boolean {
    this.setEnabled(!this.isVoiceEnabled);
    return this.isVoiceEnabled;
  }

  /**
   * Immediately terminates all active audio playback and pending speech requests.
   */
  public stop(): void {
    // Invalidate any ongoing playback sequence
    this.playbackGenerationId++;

    // 1. Stop Web Audio source node
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch {}
      this.currentSourceNode = null;
    }

    // 2. Stop HTMLAudioElement
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.removeAttribute('src');
        this.currentAudioElement.load();
      } catch {}
      this.currentAudioElement = null;
    }

    // 3. Cancel in-flight synthesis on the backend
    apiBridge.cancelSpeechSynthesis().catch(() => {});

    // 4. Cancel browser Web Speech fallback if active
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    this.isSpeakingAudio = false;
    this.isSynthesizingAudio = false;
    this.currentActiveMessageId = null;
    this.notify();
  }

  /**
   * Sanitizes markdown text for speech synthesis fallback.
   */
  private cleanTextForSpeech(text: string): string {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    // 1. Remove fenced code blocks completely
    cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');

    // 2. Remove technical execution metadata and status tags
    cleaned = cleaned.replace(/Consulted Sources:\s*\[[\s\S]*?\]/gi, ' ');
    cleaned = cleaned.replace(/Executed Steps:\s*[^\r\n]+/gi, ' ');
    cleaned = cleaned.replace(/Task (completed successfully|execution summary):/gi, ' ');
    cleaned = cleaned.replace(/Blocker:\s*[^\r\n]+/gi, ' ');
    cleaned = cleaned.replace(/\[(COMPLETED|VERIFIED|FAILED|BLOCKED|INCOMPLETE)\]/gi, ' ');
    cleaned = cleaned.replace(/^\s*\d+\.\s*\*\*.*?\*\*/gm, ' ');

    // 3. Remove inline code backticks, keeping the word
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // 4. Remove image markdown ![]()
    cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');

    // 5. Convert markdown links [Label](url) -> Label
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // 6. Convert standalone URLs to just their domain name (e.g. https://www.google.com -> google.com)
    cleaned = cleaned.replace(/https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+)(?:\/[^\s)\]]*)?/gi, '$1');

    // 7. Remove HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');

    // 8. Replace arrows -> or => with natural speech pause
    cleaned = cleaned.replace(/->|=>/g, ', then ');

    // 9. Remove emojis to avoid robotic reading of descriptions
    cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ' ');

    // 10. Remove markdown headers, list markers, decorators (*, **, _, __, ~, |, #)
    cleaned = cleaned.replace(/^[\s]*[#*>\-+]+[\s]+/gm, ' ');
    cleaned = cleaned.replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1');
    cleaned = cleaned.replace(/[`*#~|_\[\]{}]/g, ' ');

    // 11. Normalize whitespace and newlines
    cleaned = cleaned.replace(/[\r\n\t]+/g, ' ');
    cleaned = cleaned.replace(/\s{2,}/g, ' ');
    cleaned = cleaned.trim();

    if (!cleaned) {
      return 'Task execution finished.';
    }

    return cleaned;
  }

  private speakWithWebSpeechFallback(text: string, generationId: number, messageId: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        this.currentActiveMessageId = null;
        this.notify();
        resolve(false);
        return;
      }

      const clean = this.cleanTextForSpeech(text);
      if (!clean) {
        this.currentActiveMessageId = null;
        this.notify();
        resolve(false);
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        if (generationId === this.playbackGenerationId) {
          this.isSpeakingAudio = true;
          this.currentActiveMessageId = messageId;
          this.notify();
        }
      };

      utterance.onend = () => {
        if (generationId === this.playbackGenerationId) {
          this.isSpeakingAudio = false;
          this.currentActiveMessageId = null;
          this.notify();
        }
        resolve(true);
      };

      utterance.onerror = (e) => {
        console.warn('[NEXUS Voice] Speech fallback error:', e);
        if (generationId === this.playbackGenerationId) {
          this.isSpeakingAudio = false;
          this.currentActiveMessageId = null;
          this.notify();
        }
        resolve(false);
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const cleaned = base64.replace(/[\s\r\n]+/g, '');
    const binaryString = window.atob(cleaned);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Plays an audio chunk via Web Audio API AudioContext for direct hardware output,
   * falling back to HTMLAudioElement if Web Audio decoding fails.
   */
  private async playSingleAudioChunk(
    chunk: { audioBase64: string; mimeType: string },
    generationId: number,
    messageId: string
  ): Promise<boolean> {
    const startTime = Date.now();
    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = this.base64ToArrayBuffer(chunk.audioBase64);
    } catch (err: any) {
      console.error(`[TTS_ERROR] ${JSON.stringify({ category: 'BASE64_DECODE_ERROR', message: err?.message || String(err) })}`);
      return false;
    }

    // METHOD A: Web Audio API (Hardware-direct, low latency)
    const ctx = this.getOrCreateAudioContext();
    if (ctx) {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // Clone arrayBuffer because decodeAudioData detaches the buffer in some browsers
        const bufferCopy = arrayBuffer.slice(0);
        const audioBuffer = await ctx.decodeAudioData(bufferCopy);

        if (generationId !== this.playbackGenerationId || this.currentActiveMessageId !== messageId) {
          return false;
        }

        console.log(`[TTS_PLAYBACK_STARTED] ${JSON.stringify({
          messageId,
          method: 'web-audio',
          byteCount: arrayBuffer.byteLength,
          durationSec: Math.round(audioBuffer.duration * 10) / 10,
        })}`);

        await new Promise<void>((resolve) => {
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          this.currentSourceNode = source;

          source.onended = () => {
            if (this.currentSourceNode === source) {
              this.currentSourceNode = null;
            }
            resolve();
          };

          source.start(0);
        });

        const elapsedMs = Date.now() - startTime;
        console.log(`[TTS_PLAYBACK_ENDED] ${JSON.stringify({ messageId, method: 'web-audio', elapsedMs })}`);
        return true;
      } catch (decodeErr: any) {
        console.warn('[NEXUS Voice] Web Audio decode failed, falling back to HTMLAudioElement:', decodeErr);
      }
    }

    // METHOD B: HTMLAudioElement fallback
    let blobUrl: string | null = null;
    try {
      const blob = new Blob([arrayBuffer], { type: chunk.mimeType || 'audio/mpeg' });
      blobUrl = URL.createObjectURL(blob);
    } catch {
      blobUrl = `data:${chunk.mimeType || 'audio/mpeg'};base64,${chunk.audioBase64}`;
    }

    const currentUrl = blobUrl;
    console.log(`[TTS_PLAYBACK_STARTED] ${JSON.stringify({
      messageId,
      method: 'audio-element',
      byteCount: arrayBuffer.byteLength,
    })}`);

    const playedOk = await new Promise<boolean>((resolve) => {
      if (generationId !== this.playbackGenerationId) {
        if (currentUrl.startsWith('blob:')) URL.revokeObjectURL(currentUrl);
        resolve(false);
        return;
      }

      const audio = new Audio();
      this.currentAudioElement = audio;

      const cleanup = () => {
        if (this.currentAudioElement === audio) {
          this.currentAudioElement = null;
        }
        if (currentUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(currentUrl);
          } catch {}
        }
        audio.removeAttribute('src');
        audio.load();
      };

      audio.onended = () => {
        cleanup();
        resolve(true);
      };

      audio.onerror = (e) => {
        console.error(`[TTS_ERROR] ${JSON.stringify({ category: 'AUDIO_ELEMENT_ERROR', error: String(e) })}`);
        cleanup();
        resolve(false);
      };

      audio.src = currentUrl;
      audio.play().catch((playErr) => {
        console.error(`[TTS_ERROR] ${JSON.stringify({ category: 'AUTOPLAY_PREVENTED', message: playErr?.message || String(playErr) })}`);
        cleanup();
        resolve(false);
      });
    });

    const elapsedMs = Date.now() - startTime;
    if (playedOk) {
      console.log(`[TTS_PLAYBACK_ENDED] ${JSON.stringify({ messageId, method: 'audio-element', elapsedMs })}`);
    }
    return playedOk;
  }

  private async playAudioChunks(
    chunks: Array<{ audioBase64: string; mimeType: string }>,
    generationId: number,
    messageId: string
  ): Promise<boolean> {
    let anyPlayed = false;
    for (let i = 0; i < chunks.length; i++) {
      if (generationId !== this.playbackGenerationId || this.currentActiveMessageId !== messageId) {
        break;
      }
      const ok = await this.playSingleAudioChunk(chunks[i], generationId, messageId);
      if (ok) anyPlayed = true;
    }

    if (generationId === this.playbackGenerationId) {
      this.currentAudioElement = null;
      this.currentSourceNode = null;
      this.isSpeakingAudio = false;
      this.isSynthesizingAudio = false;
      this.currentActiveMessageId = null;
      this.notify();
    }
    return anyPlayed;
  }

  /**
   * Synthesizes and speaks an assistant response using ElevenLabs voice.
   * Ensures zero overlap: any existing playback is stopped first.
   */
  public async speak(text: string, messageId: string, forceEnable = false): Promise<boolean> {
    if (forceEnable && !this.isVoiceEnabled) {
      this.setEnabled(true);
    }

    if (!this.isVoiceEnabled) {
      return false;
    }

    if (!text || !text.trim()) {
      return false;
    }

    // 1. Stop any currently active speech to prevent overlapping playback
    this.stop();

    const generationId = ++this.playbackGenerationId;
    this.isSynthesizingAudio = true;
    this.currentActiveMessageId = messageId;
    this.lastErrorMessage = null;
    this.notify();

    console.log(`[NEXUS Voice] Starting speech generation for message ${messageId} (${text.length} chars)`);

    try {
      const result = await apiBridge.synthesizeSpeech(text);

      // Check if user stopped playback while synthesis was in-flight
      if (generationId !== this.playbackGenerationId) {
        return false;
      }

      if (!result.success || !result.audioChunks || result.audioChunks.length === 0) {
        this.isSynthesizingAudio = false;
        this.lastErrorMessage = result.error || 'ElevenLabs speech synthesis failed.';
        this.notify();
        console.error(`[TTS_ERROR] ${JSON.stringify({ category: 'SYNTHESIS_FAILED', message: this.lastErrorMessage })}`);

        // Fallback to local desktop Web Speech synthesis so audio is immediately audible
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          console.log('[NEXUS Voice] Using desktop speech synthesis fallback for audible speech...');
          return await this.speakWithWebSpeechFallback(text, generationId, messageId);
        }

        this.currentActiveMessageId = null;
        this.notify();
        return false;
      }

      this.isSynthesizingAudio = false;
      this.isSpeakingAudio = true;
      this.notify();

      // Play audio chunks using hardware-direct Web Audio with fallback
      const playbackOk = await this.playAudioChunks(result.audioChunks, generationId, messageId);
      if (!playbackOk && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        console.warn('[NEXUS Voice] Audio decoding failed; trying speech synthesis fallback...');
        return await this.speakWithWebSpeechFallback(text, generationId, messageId);
      }
      return playbackOk;
    } catch (err: any) {
      if (generationId === this.playbackGenerationId) {
        this.isSynthesizingAudio = false;
        this.lastErrorMessage = err?.message || String(err);
        this.notify();
        console.error(`[TTS_ERROR] ${JSON.stringify({ category: 'UNCAUGHT_VOICE_ERROR', message: this.lastErrorMessage })}`);

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          return await this.speakWithWebSpeechFallback(text, generationId, messageId);
        }

        this.isSpeakingAudio = false;
        this.currentActiveMessageId = null;
        this.notify();
      }
      return false;
    }
  }
}

export const voiceService = new VoiceService();
