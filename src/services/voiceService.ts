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

    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.removeAttribute('src');
        this.currentAudioElement.load();
      } catch {
        // ignore
      }
      this.currentAudioElement = null;
    }

    // Cancel in-flight synthesis on the backend
    apiBridge.cancelSpeechSynthesis().catch(() => {});

    // Cancel browser Web Speech fallback if active
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
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/[^\s)]+/g, 'link')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^[\s]*[#*>\-+]+[\s]+/gm, ' ')
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
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

  /**
   * Synthesizes and speaks an assistant response using ElevenLabs voice.
   * Ensures zero overlap: any existing playback is stopped first.
   */
  public async speak(text: string, messageId: string): Promise<boolean> {
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
        console.warn('[NEXUS Voice] ElevenLabs synthesis notice:', this.lastErrorMessage);

        // Fallback to local desktop Web Speech synthesis so audio is immediately audible
        // while clearly displaying the ElevenLabs permission warning in UI
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

      console.log(`[NEXUS Voice] Received ${result.audioChunks.length} ElevenLabs audio chunk(s). Starting playback...`);

      // Play audio chunks sequentially
      await this.playAudioChunks(result.audioChunks, generationId, messageId);
      return true;
    } catch (err: any) {
      if (generationId === this.playbackGenerationId) {
        this.isSynthesizingAudio = false;
        this.lastErrorMessage = err?.message || String(err);
        this.notify();

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

  private async playAudioChunks(
    chunks: Array<{ audioBase64: string; mimeType: string }>,
    generationId: number,
    messageId: string
  ): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      if (generationId !== this.playbackGenerationId || this.currentActiveMessageId !== messageId) {
        break;
      }

      const chunk = chunks[i];
      const audioUrl = `data:${chunk.mimeType || 'audio/mpeg'};base64,${chunk.audioBase64}`;

      await new Promise<void>((resolve) => {
        if (generationId !== this.playbackGenerationId) {
          resolve();
          return;
        }

        const audio = new Audio();
        this.currentAudioElement = audio;

        audio.onended = () => {
          if (this.currentAudioElement === audio) {
            this.currentAudioElement = null;
          }
          // Release memory
          audio.removeAttribute('src');
          audio.load();
          resolve();
        };

        audio.onerror = (e) => {
          console.warn('[NEXUS Voice] Audio chunk error:', e);
          if (this.currentAudioElement === audio) {
            this.currentAudioElement = null;
          }
          audio.removeAttribute('src');
          audio.load();
          resolve();
        };

        audio.src = audioUrl;
        audio.play().catch((playErr) => {
          console.warn('[NEXUS Voice] Autoplay or playback prevented:', playErr);
          if (this.currentAudioElement === audio) {
            this.currentAudioElement = null;
          }
          resolve();
        });
      });
    }

    // If this playback generation is still the active one, mark finished
    if (generationId === this.playbackGenerationId) {
      this.currentAudioElement = null;
      this.isSpeakingAudio = false;
      this.isSynthesizingAudio = false;
      this.currentActiveMessageId = null;
      this.notify();
    }
  }
}

export const voiceService = new VoiceService();
