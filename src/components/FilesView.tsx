import React from 'react';
import { 
  FolderGit2, 
  Download, 
  ShieldCheck, 
  FileSpreadsheet, 
  HardDrive
} from 'lucide-react';

export const FilesView: React.FC = () => {
  return (
    <div className="h-full flex flex-col w-full overflow-hidden">
      {/* Header */}
      <header className="px-8 py-5 border-b border-border-subtle bg-background-secondary/30 flex items-center justify-between shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-text-primary">
              Files & Artifacts
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-background-tertiary text-text-muted border border-border-subtle">
              0 files
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            Storage workspace for downloads, structured extracts, and agent deliverables
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-background-tertiary border border-border-subtle text-xs text-text-muted">
            <HardDrive className="w-3.5 h-3.5 text-blue-400" />
            <span>Path: Downloads/NEXUS-AI</span>
          </div>
        </div>
      </header>

      {/* Main Content: Clean Empty State with Architecture Preview */}
      <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center max-w-2xl mx-auto text-center">
        <div className="w-16 h-16 rounded-2xl bg-background-tertiary border border-border-subtle flex items-center justify-center text-text-dim mb-4">
          <FolderGit2 className="w-8 h-8 text-text-muted" />
        </div>

        <h2 className="text-lg font-medium text-text-primary mb-2">
          No files generated yet
        </h2>
        <p className="text-xs text-text-muted max-w-md leading-relaxed mb-8">
          In future phases, authorized file downloads, web captures, and agent artifacts will appear here. No external files or mock data are fabricated in this UI foundation.
        </p>

        {/* Informational Capability Preview Grid */}
        <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-3 text-left">
          <div className="p-4 rounded-xl bg-background-secondary/60 border border-border-subtle space-y-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Download className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-medium text-text-primary">
              Direct File Retrieval
            </h3>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Targeted downloads of whitepapers, manuals, and datasets from authorized sources.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-background-secondary/60 border border-border-subtle space-y-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <FileSpreadsheet className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-medium text-text-primary">
              Structured Extracts
            </h3>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Export comparison tables and scraped form schemas to clean CSV and JSON formats.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-background-secondary/60 border border-border-subtle space-y-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-medium text-text-primary">
              Security Sandboxing
            </h3>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Strict isolation preventing arbitrary writes outside designated application directories.
            </p>
          </div>
        </div>

        <div className="mt-8 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-background-tertiary border border-border-subtle text-[11px] text-text-dim">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80" />
          <span>Local Filesystem Access is strictly restricted in Phase 1</span>
        </div>
      </div>
    </div>
  );
};
