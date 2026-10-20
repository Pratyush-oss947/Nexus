import * as dotenv from 'dotenv';

dotenv.config();

export interface ElevenLabsStatus {
  hasApiKey: boolean;
  hasVoiceId: boolean;
  voiceId: string;
  model: string;
  keySource: 'env' | 'settings' | 'none';
  maskedKey?: string;
  error?: string;
}

export interface AudioChunk {
  text: string;
  audioBase64: string;
  mimeType: string;
}

export interface SpeechSynthesisResult {
  success: boolean;
  audioChunks?: AudioChunk[];
  error?: string;
  status?: string;
}

export class ElevenLabsService {
  private apiKey: string;
  private voiceId: string;
  private model: string;
  private activeController: AbortController | null = null;

  constructor(apiKey?: string, voiceId?: string, model?: string) {
    this.apiKey = (typeof apiKey === 'string' ? apiKey : (process.env.ELEVENLABS_API_KEY || '')).trim();
    this.voiceId = (typeof voiceId === 'string' ? voiceId : (process.env.ELEVENLABS_VOICE_ID || '')).trim();
    this.model = (typeof model === 'string' && model.trim() ? model : (process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2')).trim();
  }

  public setCredentials(apiKey?: string, voiceId?: string, model?: string): void {
    if (typeof apiKey === 'string') this.apiKey = apiKey.trim();
    if (typeof voiceId === 'string') this.voiceId = voiceId.trim();
    if (typeof model === 'string' && model.trim()) this.model = model.trim();
  }

  public getStatus(keySource: 'env' | 'settings' | 'none' = 'none'): ElevenLabsStatus {
    const hasKey = this.apiKey.length > 0;
    const hasVoice = this.voiceId.length > 0;
    let actualSource = keySource;
    if (process.env.ELEVENLABS_API_KEY && this.apiKey === process.env.ELEVENLABS_API_KEY.trim()) {
      actualSource = 'env';
    } else if (hasKey) {
      actualSource = 'settings';
    }

    return {
      hasApiKey: hasKey,
      hasVoiceId: hasVoice,
      voiceId: this.voiceId,
      model: this.model || 'eleven_multilingual_v2',
      keySource: actualSource,
      maskedKey: hasKey ? this.maskKey(this.apiKey) : undefined,
    };
  }

  public maskKey(key: string): string {
    if (!key) return '';
    if (key.length <= 10) return '***';
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  }

  /**
   * Sanitizes assistant markdown text into natural human speech.
   * Strips code blocks, raw URLs, and markdown punctuation while preserving
   * natural English and Hindi/Hinglish phrasing.
   */
  public cleanTextForSpeech(text: string): string {
    if (!text || typeof text !== 'string') return '';

    let cleaned = text;

    // 1. Remove fenced code blocks completely (reading raw code aloud is noisy)
    cleaned = cleaned.replace(/```[\s\S]*?```/g, ' ');

    // 2. Remove technical execution metadata, status tags, and requirement labels
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

    // 7. Remove HTML tags if any
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

  /**
   * Splits long text into sensible chunks at sentence boundaries
   * (supporting English punctuation and Hindi purna viram ।).
   */
  public splitTextIntoChunks(text: string, maxChunkLength = 2500): string[] {
    const cleaned = this.cleanTextForSpeech(text);
    if (!cleaned) return [];
    if (cleaned.length <= maxChunkLength) return [cleaned];

    // Split on sentence boundaries: . ! ? । or newlines
    const sentences = cleaned.split(/(?<=[.!?।])\s+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) continue;

      if (!currentChunk) {
        if (trimmedSentence.length > maxChunkLength) {
          // If a single sentence is exceptionally long, split by comma or spaces
          const subChunks = this.splitByWords(trimmedSentence, maxChunkLength);
          chunks.push(...subChunks);
        } else {
          currentChunk = trimmedSentence;
        }
      } else if (currentChunk.length + trimmedSentence.length + 1 <= maxChunkLength) {
        currentChunk += ' ' + trimmedSentence;
      } else {
        chunks.push(currentChunk);
        if (trimmedSentence.length > maxChunkLength) {
          const subChunks = this.splitByWords(trimmedSentence, maxChunkLength);
          chunks.push(...subChunks);
          currentChunk = '';
        } else {
          currentChunk = trimmedSentence;
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private splitByWords(sentence: string, maxChunkLength: number): string[] {
    const words = sentence.split(/\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + word.length + 1 <= maxChunkLength) {
        current += ' ' + word;
      } else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  /**
   * Tests connection to ElevenLabs API and validates the voice ID and permissions.
   */
  public async testConnection(
    customKey?: string,
    customVoiceId?: string
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    const key = (customKey || this.apiKey).trim();
    const voice = (customVoiceId || this.voiceId).trim();

    if (!key) {
      return {
        success: false,
        error: 'ElevenLabs API key is missing. Set ELEVENLABS_API_KEY in .env or configure it in Settings.',
      };
    }
    if (!voice) {
      return {
        success: false,
        error: 'ElevenLabs Voice ID is missing. Set ELEVENLABS_VOICE_ID in .env or configure it in Settings.',
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: 'NEXUS voice connection test.',
          model_id: this.model || 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        return {
          success: true,
          message: `ElevenLabs voice connected successfully! Voice ID: ${voice}`,
        };
      }

      let errData: any = null;
      try {
        errData = await res.json();
      } catch {
        errData = null;
      }

      return this.parseApiError(res.status, errData, voice);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, error: 'Connection test timed out after 12 seconds.' };
      }
      return { success: false, error: `Connection failed: ${err.message || String(err)}` };
    }
  }

  /**
   * Synthesizes text into audio chunks. If text is long, splits into ordered chunks.
   */
  public async synthesizeSpeech(
    text: string,
    options?: { voiceId?: string; modelId?: string }
  ): Promise<SpeechSynthesisResult> {
    const key = this.apiKey.trim();
    const voice = (options?.voiceId || this.voiceId).trim();
    const model = (options?.modelId || this.model || 'eleven_multilingual_v2').trim();

    if (!key) {
      return {
        success: false,
        error: 'ElevenLabs API key is not configured. Add ELEVENLABS_API_KEY to your .env file or Settings.',
      };
    }

    if (!voice) {
      return {
        success: false,
        error: 'ElevenLabs Voice ID is not configured. Add ELEVENLABS_VOICE_ID to your .env file or Settings.',
      };
    }

    const chunks = this.splitTextIntoChunks(text);
    if (chunks.length === 0) {
      return {
        success: false,
        error: 'No speakable content found in response.',
      };
    }

    this.activeController = new AbortController();
    const audioChunks: AudioChunk[] = [];

    try {
      for (const chunkText of chunks) {
        if (this.activeController?.signal.aborted) {
          return { success: false, error: 'Speech synthesis cancelled by user.' };
        }

        const chunkResult = await this.synthesizeSingleChunk(
          chunkText,
          key,
          voice,
          model,
          this.activeController.signal
        );

        if (!chunkResult.success) {
          // If the first chunk fails, return immediately
          if (audioChunks.length === 0) {
            return {
              success: false,
              error: chunkResult.error,
              status: chunkResult.status,
            };
          }
          // If subsequent chunk fails, stop queue but return what we synthesized
          break;
        }

        if (chunkResult.audioBase64) {
          audioChunks.push({
            text: chunkText,
            audioBase64: chunkResult.audioBase64,
            mimeType: 'audio/mpeg',
          });
        }
      }

      return {
        success: audioChunks.length > 0,
        audioChunks,
      };
    } finally {
      this.activeController = null;
    }
  }

  private async synthesizeSingleChunk(
    chunkText: string,
    key: string,
    voice: string,
    model: string,
    signal: AbortSignal
  ): Promise<{ success: boolean; audioBase64?: string; error?: string; status?: string }> {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: chunkText,
          model_id: model,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
        signal,
      });

      if (!res.ok) {
        let errJson: any = null;
        try {
          errJson = await res.json();
        } catch {
          errJson = null;
        }
        const parsed = this.parseApiError(res.status, errJson, voice);
        return { success: false, error: parsed.error, status: String(res.status) };
      }

      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      return {
        success: true,
        audioBase64: base64,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, error: 'Speech synthesis cancelled.' };
      }
      return { success: false, error: `Speech synthesis failed: ${err.message || String(err)}` };
    }
  }

  public cancel(): void {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }

  private parseApiError(
    status: number,
    errData: any,
    voice: string
  ): { success: false; error: string } {
    const detail = errData?.detail;
    const msg = detail?.message || errData?.message || '';
    const errStatus = detail?.status || '';

    if (status === 401) {
      if (errStatus === 'missing_permissions' || msg.includes('permission')) {
        return {
          success: false,
          error: `ElevenLabs API key is missing required permissions: "${msg}". Please visit ElevenLabs Dashboard -> API Keys and grant the "Text to Speech" permission (or generate a key with default permissions).`,
        };
      }
      return {
        success: false,
        error: 'Invalid ElevenLabs API key. Please check ELEVENLABS_API_KEY in .env or Settings.',
      };
    }

    if (status === 404) {
      return {
        success: false,
        error: `ElevenLabs voice ID "${voice}" was not found. Please verify ELEVENLABS_VOICE_ID in .env or Settings.`,
      };
    }

    if (status === 429) {
      return {
        success: false,
        error: 'ElevenLabs rate limit or quota exceeded. Please check your ElevenLabs account credits.',
      };
    }

    return {
      success: false,
      error: msg || `ElevenLabs API returned HTTP error ${status}.`,
    };
  }
}
