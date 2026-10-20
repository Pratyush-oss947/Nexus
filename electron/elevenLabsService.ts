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
    const rawKey = typeof apiKey === 'string' ? apiKey : (process.env.ELEVENLABS_API_KEY || '');
    this.apiKey = this.sanitizeKey(rawKey);
    this.voiceId = (typeof voiceId === 'string' ? voiceId : (process.env.ELEVENLABS_VOICE_ID || '')).trim();
    this.model = (typeof model === 'string' && model.trim() ? model : (process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2')).trim();
  }

  /**
   * Sanitizes key to remove extraneous quotes, whitespace, carriage returns, and control characters.
   */
  public sanitizeKey(key?: string): string {
    if (!key || typeof key !== 'string') return '';
    return key
      .replace(/^["']|["']$/g, '')
      .replace(/[\r\n\t\uFEFF]/g, '')
      .trim();
  }

  /**
   * Checks whether a string is an empty string, UI placeholder, or masked string
   * (e.g. "••••••••", "***", "sk_7b...28e4").
   */
  public isPlaceholderKey(key?: string): boolean {
    if (!key || typeof key !== 'string') return true;
    const clean = this.sanitizeKey(key);
    if (!clean) return true;
    if (/^[•*.\s]+$/.test(clean)) return true;
    if (clean.includes('••••') || clean.includes('***') || clean.includes('...')) return true;
    if (/^(placeholder|your[-_]api[-_]key|none|null|undefined)$/i.test(clean)) return true;
    return false;
  }

  public setCredentials(apiKey?: string, voiceId?: string, model?: string): void {
    if (typeof apiKey === 'string') {
      const cleanKey = this.sanitizeKey(apiKey);
      // NEVER overwrite an existing valid key with an empty string or UI masked placeholder!
      if (cleanKey && !this.isPlaceholderKey(cleanKey)) {
        this.apiKey = cleanKey;
      }
    }
    if (typeof voiceId === 'string' && voiceId.trim()) {
      this.voiceId = voiceId.trim();
    }
    if (typeof model === 'string' && model.trim()) {
      this.model = model.trim();
    }
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
    const rawKey = customKey || this.apiKey;
    const key = this.sanitizeKey(rawKey);
    const voice = (customVoiceId || this.voiceId).trim();

    if (!key || this.isPlaceholderKey(key)) {
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
    const key = this.sanitizeKey(this.apiKey);
    const voice = (options?.voiceId || this.voiceId).trim();
    const model = (options?.modelId || this.model || 'eleven_multilingual_v2').trim();

    if (!key || this.isPlaceholderKey(key)) {
      console.error(`[TTS_ERROR] ${JSON.stringify({ category: 'MISSING_CREDENTIALS', message: 'ElevenLabs API key is not configured.' })}`);
      return {
        success: false,
        error: 'ElevenLabs API key is not configured. Add ELEVENLABS_API_KEY to your .env file or Settings.',
      };
    }

    if (!voice) {
      console.error(`[TTS_ERROR] ${JSON.stringify({ category: 'MISSING_CREDENTIALS', message: 'ElevenLabs Voice ID is not configured.' })}`);
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

    // Cancel any prior active controller before beginning new generation
    if (this.activeController) {
      try {
        this.activeController.abort();
      } catch {}
    }

    const currentController = new AbortController();
    this.activeController = currentController;
    const audioChunks: AudioChunk[] = [];

    try {
      for (const chunkText of chunks) {
        if (currentController.signal.aborted) {
          return { success: false, error: 'Speech synthesis cancelled by user.' };
        }

        const chunkResult = await this.synthesizeSingleChunk(
          chunkText,
          key,
          voice,
          model,
          currentController.signal
        );

        if (!chunkResult.success) {
          // If first chunk fails, return immediately
          if (audioChunks.length === 0) {
            return {
              success: false,
              error: chunkResult.error,
              status: chunkResult.status,
            };
          }
          // If subsequent chunk fails, stop queue but return what we already synthesized
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
      if (this.activeController === currentController) {
        this.activeController = null;
      }
    }
  }

  private async synthesizeSingleChunk(
    chunkText: string,
    key: string,
    voice: string,
    model: string,
    signal: AbortSignal,
    retryCount = 0
  ): Promise<{ success: boolean; audioBase64?: string; error?: string; status?: string }> {
    const startTime = Date.now();
    const snippet = chunkText.slice(0, 60).replace(/\s+/g, ' ');
    console.log(`[TTS_REQUEST_STARTED] ${JSON.stringify({ voiceId: voice, model, textChars: chunkText.length, snippet })}`);

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

      const durationMs = Date.now() - startTime;
      console.log(`[TTS_API_RESPONSE] ${JSON.stringify({ status: res.status, ok: res.ok, durationMs })}`);

      // Transient retry for 429 rate limit or 503/504 server busy (exactly 1 retry with brief backoff)
      if ((res.status === 429 || res.status === 503 || res.status === 504) && retryCount === 0 && !signal.aborted) {
        console.warn(`[TTS_RETRY] ElevenLabs returned HTTP ${res.status}. Retrying chunk in 750ms...`);
        await new Promise((resolve) => setTimeout(resolve, 750));
        if (signal.aborted) {
          return { success: false, error: 'Speech synthesis cancelled by user.' };
        }
        return await this.synthesizeSingleChunk(chunkText, key, voice, model, signal, retryCount + 1);
      }

      if (!res.ok) {
        let errJson: any = null;
        try {
          errJson = await res.json();
        } catch {
          errJson = null;
        }
        const parsed = this.parseApiError(res.status, errJson, voice);
        console.error(`[TTS_ERROR] ${JSON.stringify({ category: parsed.category, status: res.status, message: parsed.error })}`);
        return { success: false, error: parsed.error, status: String(res.status) };
      }

      const arrayBuffer = await res.arrayBuffer();
      console.log(`[TTS_AUDIO_RECEIVED] ${JSON.stringify({ byteCount: arrayBuffer.byteLength, format: 'audio/mpeg' })}`);
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      return {
        success: true,
        audioBase64: base64,
      };
    } catch (err: any) {
      if (signal.aborted || err.name === 'AbortError' || err.message?.includes('aborted') || err.code === 20) {
        console.log(`[TTS_CANCELLED] Speech synthesis request cancelled.`);
        return { success: false, error: 'Speech synthesis cancelled by user.' };
      }
      console.error(`[TTS_ERROR] ${JSON.stringify({ category: 'NETWORK_ERROR', message: err.message || String(err) })}`);
      return { success: false, error: `Speech synthesis network failure: ${err.message || String(err)}` };
    }
  }

  public cancel(): void {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }

  /**
   * Intelligently classifies API error status codes and JSON payloads, distinguishing
   * genuine authentication failures from permission restrictions, quota limits,
   * rate limits, and server issues without leaking secrets.
   */
  public parseApiError(
    status: number,
    errData: any,
    voice: string
  ): { success: false; error: string; category: string } {
    let msg = '';
    let errStatus = '';
    let errCode = '';

    if (typeof errData === 'string') {
      msg = errData;
    } else if (errData && typeof errData === 'object') {
      const detail = errData.detail;
      if (typeof detail === 'string') {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join('; ');
      } else if (detail && typeof detail === 'object') {
        msg = detail.message || detail.msg || '';
        errStatus = detail.status || '';
        errCode = detail.code || '';
      }
      if (!msg) {
        msg = errData.message || errData.error || '';
      }
      if (!errStatus && errData.status) {
        errStatus = String(errData.status);
      }
    }

    const lowerMsg = (msg || '').toLowerCase();
    const lowerStatus = (errStatus || '').toLowerCase();
    const lowerCode = (errCode || '').toLowerCase();

    // 1. Quota / Credits / Billing exhaustion (may return 401, 402, 403, or 429)
    const isQuotaExceeded =
      status === 402 ||
      lowerStatus === 'quota_exceeded' ||
      lowerStatus === 'character_limit_exceeded' ||
      lowerStatus === 'needs_credit_check' ||
      lowerCode === 'quota_exceeded' ||
      lowerMsg.includes('quota') ||
      lowerMsg.includes('character limit') ||
      lowerMsg.includes('credits') ||
      lowerMsg.includes('payment_required') ||
      lowerMsg.includes('unusual activity') ||
      lowerMsg.includes('detected unusual');

    if (isQuotaExceeded) {
      return {
        success: false,
        category: 'QUOTA_EXCEEDED',
        error: `ElevenLabs character quota exceeded or usage limit reached: ${msg || 'You have exceeded your available character allowance for this billing cycle'}. Please check your ElevenLabs subscription or credit balance.`,
      };
    }

    // 2. Missing permissions (401 or 403 with missing_permissions)
    const isMissingPermissions =
      lowerStatus === 'missing_permissions' ||
      lowerCode === 'missing_permissions' ||
      lowerMsg.includes('permission') ||
      lowerMsg.includes('text_to_speech');

    if (isMissingPermissions && (status === 401 || status === 403)) {
      return {
        success: false,
        category: 'MISSING_PERMISSIONS',
        error: `ElevenLabs API key is missing required permissions: "${msg || 'text_to_speech permission required'}". Please visit ElevenLabs Dashboard -> API Keys and grant the "Text to Speech" permission (or generate a key with default permissions).`,
      };
    }

    // 3. Genuine Authentication Failure (HTTP 401 only when not quota/permission)
    if (status === 401) {
      return {
        success: false,
        category: 'INVALID_CREDENTIALS',
        error: 'Invalid ElevenLabs API key. Please check ELEVENLABS_API_KEY in .env or Settings.',
      };
    }

    // 4. Voice Not Found (HTTP 404)
    if (status === 404 || lowerStatus === 'voice_not_found' || lowerMsg.includes('voice_not_found') || (lowerMsg.includes('voice') && lowerMsg.includes('not found'))) {
      return {
        success: false,
        category: 'VOICE_NOT_FOUND',
        error: `ElevenLabs voice ID "${voice}" was not found. Please verify ELEVENLABS_VOICE_ID in .env or Settings.`,
      };
    }

    // 5. Rate limit or concurrency limit (HTTP 429)
    if (status === 429) {
      if (lowerMsg.includes('concurrent') || lowerStatus.includes('concurrent')) {
        return {
          success: false,
          category: 'CONCURRENCY_LIMIT',
          error: 'ElevenLabs concurrency limit reached. Please wait a moment for current speech to finish before requesting more.',
        };
      }
      return {
        success: false,
        category: 'RATE_LIMIT',
        error: 'ElevenLabs rate limit exceeded. Please wait a moment before sending another speech request.',
      };
    }

    // 6. Access Forbidden (HTTP 403)
    if (status === 403) {
      return {
        success: false,
        category: 'FORBIDDEN',
        error: `ElevenLabs access forbidden (HTTP 403): ${msg || 'Your account does not have access to this resource or tier.'}`,
      };
    }

    // 7. Bad Request / Validation Error (HTTP 400 or 422)
    if (status === 400 || status === 422) {
      return {
        success: false,
        category: 'INVALID_REQUEST',
        error: `ElevenLabs request error (HTTP ${status}): ${msg || 'Invalid parameters supplied for text-to-speech.'}`,
      };
    }

    // 8. Server Error (HTTP 500, 502, 503, 504)
    if (status >= 500) {
      return {
        success: false,
        category: 'SERVER_ERROR',
        error: `ElevenLabs voice server is temporarily unavailable (HTTP ${status}). Local desktop voice fallback will be used.`,
      };
    }

    // 9. Generic API Error
    return {
      success: false,
      category: 'API_ERROR',
      error: msg ? `ElevenLabs API error: ${msg}` : `ElevenLabs API returned HTTP error ${status}.`,
    };
  }
}
