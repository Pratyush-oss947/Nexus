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

  private base64ToBlob(base64: string, mimeType: string = 'audio/mpeg'): Blob {
    try {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return new Blob([bytes], { type: mimeType });
    } catch (err) {
      console.warn('[NEXUS Voice] Failed to decode base64 audio to Blob:', err);
      return new Blob([], { type: mimeType });
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
      let objectUrl: string | null = null;
      try {
        const blob = this.base64ToBlob(chunk.audioBase64, chunk.mimeType || 'audio/mpeg');
        if (blob.size === 0) continue;
        objectUrl = URL.createObjectURL(blob);
      } catch {
        objectUrl = `data:${chunk.mimeType || 'audio/mpeg'};base64,${chunk.audioBase64}`;
      }

      const currentUrl = objectUrl;

      await new Promise<void>((resolve) => {
        if (generationId !== this.playbackGenerationId) {
          if (currentUrl.startsWith('blob:')) URL.revokeObjectURL(currentUrl);
          resolve();
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
          resolve();
        };

        audio.onerror = (e) => {
          console.warn('[NEXUS Voice] Audio chunk error:', e);
          cleanup();
          resolve();
        };

        audio.src = currentUrl;
        audio.play().catch((playErr) => {
          console.warn('[NEXUS Voice] Autoplay or playback prevented:', playErr);
          cleanup();
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
