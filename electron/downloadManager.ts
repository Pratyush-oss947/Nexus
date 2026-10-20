import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface DownloadResult {
  success: boolean;
  filename: string;
  filePath: string;
  sizeBytes: number;
  error?: string;
  needsApproval?: boolean;
}

export class DownloadManager {
  private baseDownloadDir: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.baseDownloadDir = customPath;
    } else {
      const userHome = process.env.USERPROFILE || process.env.HOME || '';
      this.baseDownloadDir = path.join(userHome, 'Downloads', 'NEXUS Downloads');
    }

    if (!fs.existsSync(this.baseDownloadDir)) {
      try {
        fs.mkdirSync(this.baseDownloadDir, { recursive: true });
      } catch (err) {
        console.error('Failed to create NEXUS Downloads directory:', err);
      }
    }
  }

  public getDownloadDir(): string {
    return this.baseDownloadDir;
  }

  // Check if file extension is potentially risky / executable
  public isRiskyFileType(filename: string): boolean {
    const dangerousExtensions = [
      '.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.wsf',
      '.reg', '.scr', '.pif', '.com', '.jar', '.apk', '.bin'
    ];
    const ext = path.extname(filename).toLowerCase();
    return dangerousExtensions.includes(ext);
  }

  // Sanitize filename and prevent path traversal
  public sanitizeFilename(rawFilename: string): string {
    // Strip path traversal sequences like ../ or ..\
    let base = path.basename(rawFilename).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    if (!base || base === '.' || base === '..') {
      base = `download_${Date.now()}`;
    }
    return base;
  }

  // Generate unique file path to prevent accidental overwriting
  public getUniqueFilePath(desiredFilename: string): string {
    const cleanName = this.sanitizeFilename(desiredFilename);
    const parsed = path.parse(cleanName);
    let target = path.join(this.baseDownloadDir, cleanName);
    let counter = 1;

    while (fs.existsSync(target)) {
      const newName = `${parsed.name} (${counter})${parsed.ext}`;
      target = path.join(this.baseDownloadDir, newName);
      counter++;
    }

    return target;
  }

  // Download a file from URL with safety checks
  public async downloadFile(
    fileUrl: string,
    requestedFilename?: string,
    bypassApprovalCheck = false
  ): Promise<DownloadResult> {
    try {
      const parsedUrl = new URL(fileUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return {
          success: false,
          filename: '',
          filePath: '',
          sizeBytes: 0,
          error: `Blocked protocol ${parsedUrl.protocol}. Only HTTP and HTTPS downloads are permitted.`,
        };
      }

      // Determine clean filename
      let filename = requestedFilename || path.basename(parsedUrl.pathname) || `download_${Date.now()}`;
      if (!path.extname(filename) && !filename.includes('.')) {
        filename += '.bin';
      }
      filename = this.sanitizeFilename(filename);

      // Risky extension check (unless explicitly approved by user)
      if (!bypassApprovalCheck && this.isRiskyFileType(filename)) {
        return {
          success: false,
          filename,
          filePath: '',
          sizeBytes: 0,
          needsApproval: true,
          error: `Executable/script file (${filename}) requires explicit user approval before downloading.`,
        };
      }

      const targetPath = this.getUniqueFilePath(filename);
      const actualFilename = path.basename(targetPath);

      // Perform streaming download
      return await new Promise<DownloadResult>((resolve) => {
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const request = client.get(fileUrl, { timeout: 15000 }, (res) => {
          // Handle redirects (HTTP 301, 302, 307, 308)
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            resolve(this.downloadFile(res.headers.location, filename));
            return;
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            resolve({
              success: false,
              filename: actualFilename,
              filePath: '',
              sizeBytes: 0,
              error: `HTTP error: server responded with status code ${res.statusCode}`,
            });
            return;
          }

          const fileStream = fs.createWriteStream(targetPath);
          let downloadedBytes = 0;

          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            // Verify non-zero size
            if (fs.existsSync(targetPath) && downloadedBytes > 0) {
              resolve({
                success: true,
                filename: actualFilename,
                filePath: targetPath,
                sizeBytes: downloadedBytes,
              });
            } else {
              try { fs.unlinkSync(targetPath); } catch {}
              resolve({
                success: false,
                filename: actualFilename,
                filePath: '',
                sizeBytes: 0,
                error: 'Download completed with 0 bytes received.',
              });
            }
          });

          fileStream.on('error', (err) => {
            try { fs.unlinkSync(targetPath); } catch {}
            resolve({
              success: false,
              filename: actualFilename,
              filePath: '',
              sizeBytes: 0,
              error: `Disk write error: ${err.message}`,
            });
          });
        });

        request.on('error', (err) => {
          resolve({
            success: false,
            filename: actualFilename,
            filePath: '',
            sizeBytes: 0,
            error: `Network error: ${err.message}`,
          });
        });

        request.on('timeout', () => {
          request.destroy();
          resolve({
            success: false,
            filename: actualFilename,
            filePath: '',
            sizeBytes: 0,
            error: 'Download connection timed out.',
          });
        });
      });
    } catch (err: any) {
      return {
        success: false,
        filename: requestedFilename || '',
        filePath: '',
        sizeBytes: 0,
        error: `Invalid download request: ${err?.message || String(err)}`,
      };
    }
  }

  // List existing files in NEXUS Downloads directory
  public listDownloadedFiles(): Array<{ filename: string; path: string; sizeBytes: number; createdAt: string }> {
    try {
      if (!fs.existsSync(this.baseDownloadDir)) return [];
      const entries = fs.readdirSync(this.baseDownloadDir);
      return entries.map((name) => {
        const full = path.join(this.baseDownloadDir, name);
        try {
          const stat = fs.statSync(full);
          return {
            filename: name,
            path: full,
            sizeBytes: stat.size,
            createdAt: stat.birthtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          };
        } catch {
          return { filename: name, path: full, sizeBytes: 0, createdAt: '' };
        }
      });
    } catch {
      return [];
    }
  }

  // Safe text file reading inside user downloads or allowed directories
  public readSafeTextFile(filePath: string): { success: boolean; filename: string; content?: string; error?: string } {
    try {
      const cleanPath = path.resolve(filePath);
      if (!fs.existsSync(cleanPath)) {
        return { success: false, filename: path.basename(filePath), error: `File not found: ${filePath}` };
      }
      const stat = fs.statSync(cleanPath);
      if (!stat.isFile()) {
        return { success: false, filename: path.basename(filePath), error: `Path is not a regular file: ${filePath}` };
      }
      if (stat.size > 1024 * 1024) {
        return { success: false, filename: path.basename(filePath), error: `File is too large to read (max 1MB).` };
      }

      // Check text-compatible extensions
      const allowedExts = ['.txt', '.md', '.json', '.csv', '.html', '.log', '.xml', '.yaml', '.yml', '.js', '.ts'];
      const ext = path.extname(cleanPath).toLowerCase();
      if (!allowedExts.includes(ext) && ext !== '') {
        return { success: false, filename: path.basename(filePath), error: `Reading file type "${ext}" is not permitted for security.` };
      }

      const content = fs.readFileSync(cleanPath, 'utf-8');
      return {
        success: true,
        filename: path.basename(cleanPath),
        content: content.slice(0, 10000),
      };
    } catch (err: any) {
      return {
        success: false,
        filename: path.basename(filePath),
        error: `Could not read file: ${err?.message || String(err)}`,
      };
    }
  }
}
