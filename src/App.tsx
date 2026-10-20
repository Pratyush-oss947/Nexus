import React, { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { NewTaskView } from './components/NewTaskView';
import { ChatView } from './components/ChatView';
import { ActionCenterView } from './components/ActionCenterView';
import { TasksView } from './components/TasksView';
import { FilesView } from './components/FilesView';
import { SettingsView } from './components/SettingsView';
import { 
  NavigationTab, 
  TaskItem, 
  ChatMessage, 
  AppSettings, 
  GeminiStatus,
  Conversation,
  AutomationState,
  DownloadItem
} from './types';
import { DEFAULT_SYSTEM_INSTRUCTION } from './utils/personality';
import { apiBridge } from './services/apiBridge';
import { voiceService } from './services/voiceService';

const INITIAL_SETTINGS: AppSettings = {
  model: 'gemini-flash-lite-latest',
  temperature: 0.7,
  systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
  enableThinking: true,
  permissionWebBrowsing: true,
  permissionFormFilling: true,
  permissionFileDownloads: true,
  permissionClipboard: false,
  launchOnStartup: false,
  minimizeToTray: true,
  hardwareAcceleration: true,
  soundNotifications: false,
};

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavigationTab>('new-task');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('nexus_settings');
      if (saved) return { ...INITIAL_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // fallback
    }
    return INITIAL_SETTINGS;
  });

  // Phase 3 Automation & Download States
  const [automationState, setAutomationState] = useState<AutomationState>({
    status: 'idle',
    goal: '',
    events: [],
  });
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  // Load initial state (tasks, conversations, gemini status, downloads)
  useEffect(() => {
    // 1. Fetch Gemini Status
    apiBridge.getStatus().then((status) => {
      setGeminiStatus(status);
      if (status.defaultModel) {
        setSettings((prev) => ({ ...prev, model: status.defaultModel }));
      }
    });

    // 2. Load Tasks
    apiBridge.loadTasks().then((loadedTasks) => {
      if (Array.isArray(loadedTasks) && loadedTasks.length > 0) {
        setTasks(loadedTasks);
      }
    });

    // 3. Load Saved Conversations
    apiBridge.loadConversations().then((conversations) => {
      if (Array.isArray(conversations) && conversations.length > 0) {
        const active = conversations[0];
        if (active && Array.isArray(active.messages)) {
          setMessages(active.messages);
        }
      }
    });

    // 4. Load Downloads
    apiBridge.listDownloads().then(setDownloads);

    // 5. Subscribe to live automation events
    const unsubEvent = apiBridge.onAutomationEvent((event) => {
      setAutomationState((prev) => ({
        ...prev,
        events: [...prev.events, event],
        currentUrl: event.url || prev.currentUrl,
        latestScreenshot: event.screenshotUrl || prev.latestScreenshot,
        status: event.type === 'SUCCESS' ? 'completed' : event.type === 'ERROR' ? 'error' : prev.status,
        finalResult: event.type === 'SUCCESS' ? event.message : prev.finalResult,
      }));
    });

    // 6. Subscribe to human-in-the-loop approval requests
    const unsubApproval = apiBridge.onRequestApproval((approval) => {
      setAutomationState((prev) => ({
        ...prev,
        status: 'waiting_approval',
        pendingApproval: approval,
      }));
    });

    return () => {
      unsubEvent();
      unsubApproval();
    };
  }, []);

  // Save tasks whenever they change
  const persistTasks = (newTasks: TaskItem[]) => {
    setTasks(newTasks);
    apiBridge.saveTasks(newTasks);
  };

  // Save conversation messages whenever they change
  const persistMessages = (newMessages: ChatMessage[]) => {
    setMessages(newMessages);
    const conversation: Conversation = {
      id: 'session-main',
      title: newMessages[0]?.text.slice(0, 30) || 'Main Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: newMessages,
    };
    apiBridge.saveConversations([conversation]);
  };

  // Global keyboard shortcuts (Alt+N, Alt+C, Alt+A, Alt+T, Alt+F, Alt+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          setCurrentTab('new-task');
        } else if (e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          setCurrentTab('chat');
        } else if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          setCurrentTab('actions');
        } else if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          setCurrentTab('tasks');
        } else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          setCurrentTab('files');
        } else if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          setCurrentTab('settings');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Send message to Gemini Brain
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isGenerating) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedMessages = [...messages, userMsg];
    persistMessages(updatedMessages);
    setIsGenerating(true);

    try {
      const formattedHistory = updatedMessages
        .filter((m) => !m.isError)
        .map((m) => ({
          role: m.role === 'model' ? ('model' as const) : ('user' as const),
          text: m.text,
        }));

      const res = await apiBridge.sendChatMessage({
        messages: formattedHistory,
        model: settings.model,
        temperature: settings.temperature,
        systemInstruction: settings.systemInstruction,
      });

      if (res.error) {
        const errorMsg: ChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: 'model',
          text: res.error,
          isError: true,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        persistMessages([...updatedMessages, errorMsg]);
      } else {
        let toolNote: string | undefined;
        if (res.steps && res.steps.length > 0) {
          const distinctTools = Array.from(new Set(res.steps.map((s) => s.tool)));
          toolNote = `Used tools: ${distinctTools.join(', ')}`;
        }

        if (res.createdTasks && res.createdTasks.length > 0) {
          const freshTasks = await apiBridge.loadTasks();
          if (freshTasks.length > 0) {
            setTasks(freshTasks);
          }
          toolNote = toolNote ? `${toolNote} • Created task: "${res.createdTasks[0].title}"` : `Created task: "${res.createdTasks[0].title}"`;
        }

        const modelMsg: ChatMessage = {
          id: `msg-${Date.now()}-m`,
          role: 'model',
          text: res.text || 'Done.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          toolActionExecuted: toolNote,
          sources: res.sources && res.sources.length > 0 ? res.sources : undefined,
        };

        persistMessages([...updatedMessages, modelMsg]);

        // Automatically speak final assistant response if voice is enabled or requested
        const promptRequestedSpeech = /\b(speak|talk|read aloud|say aloud|voice)\b/i.test(text);
        if (voiceService.isEnabled() || promptRequestedSpeech) {
          voiceService.speak(modelMsg.text, modelMsg.id, promptRequestedSpeech);
        }
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        role: 'model',
        text: `Error connecting to NEXUS AI: ${err?.message || String(err)}`,
        isError: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      persistMessages([...updatedMessages, errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStopGeneration = () => {
    apiBridge.cancelChatMessage();
    voiceService.stop();
    setIsGenerating(false);
  };

  const handleNewChat = () => {
    voiceService.stop();
    persistMessages([]);
    setCurrentTab('new-task');
  };

  const handleClearChat = () => {
    voiceService.stop();
    persistMessages([]);
  };

  // Launch AI task from NewTaskView home screen
  const handleStartAiTask = (prompt: string) => {
    const isBrowse = /\b(open http|search duckduckgo|download file|navigate to|search web)\b/i.test(prompt);
    if (isBrowse) {
      handleStartAutomation(prompt);
    } else {
      setCurrentTab('chat');
      handleSendMessage(prompt);
    }
  };

  // Phase 3: Action Center Automation Handlers
  const handleStartAutomation = async (goal: string) => {
    setCurrentTab('actions');
    setAutomationState({
      status: 'running',
      goal,
      events: [],
      currentUrl: undefined,
      currentTitle: undefined,
      latestScreenshot: undefined,
      pendingApproval: undefined,
      finalResult: undefined,
    });

    try {
      const res = await apiBridge.startAutomation(goal);
      setAutomationState((prev) => ({
        ...prev,
        status: res.success ? 'completed' : 'error',
        finalResult: res.summary,
      }));
      apiBridge.listDownloads().then(setDownloads);
    } catch (err: any) {
      setAutomationState((prev) => ({
        ...prev,
        status: 'error',
        finalResult: `Automation error: ${err.message}`,
      }));
    }
  };

  const handleStopAutomation = () => {
    apiBridge.stopAutomation();
    setAutomationState((prev) => ({
      ...prev,
      status: 'stopped',
      finalResult: 'Automation stopped by user.',
    }));
  };

  const handleRespondApproval = (approvalId: string, approved: boolean) => {
    apiBridge.respondApproval(approvalId, approved);
    setAutomationState((prev) => ({
      ...prev,
      status: 'running',
      pendingApproval: undefined,
    }));
  };

  const handleOpenDownloadsFolder = () => {
    apiBridge.openDownloadsFolder();
  };

  const handleRefreshDownloads = () => {
    apiBridge.listDownloads().then(setDownloads);
  };

  // Task Manager Handlers
  const handleAddTask = (title: string, description?: string, category?: string) => {
    const newTask: TaskItem = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title,
      description,
      category: category || 'General',
      completed: false,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    persistTasks([newTask, ...tasks]);
  };

  const handleToggleTask = (id: string) => {
    const updated = tasks.map((t) => {
      if (t.id === id) {
        const nextCompleted = !t.completed;
        return {
          ...t,
          completed: nextCompleted,
          completedAt: nextCompleted
            ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : undefined,
        };
      }
      return t;
    });
    persistTasks(updated);
  };

  const handleDeleteTask = (id: string) => {
    persistTasks(tasks.filter((t) => t.id !== id));
  };

  const handleClearCompletedTasks = () => {
    persistTasks(tasks.filter((t) => !t.completed));
  };

  const handleClearAllTasks = () => {
    persistTasks([]);
  };

  // Settings Handlers
  const handleUpdateSettings = (updated: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updated };
      try {
        localStorage.setItem('nexus_settings', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleSaveApiKey = async (key: string): Promise<boolean> => {
    const res = await apiBridge.setKey(key);
    if (res.success) {
      const status = await apiBridge.getStatus();
      setGeminiStatus(status);
      return true;
    }
    return false;
  };

  const handleTestConnection = async (key?: string) => {
    const res = await apiBridge.testConnection(key);
    if (res.success) {
      const status = await apiBridge.getStatus();
      setGeminiStatus(status);
    }
    return res;
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-text-primary">
      {/* Frameless Custom TitleBar */}
      <TitleBar />

      {/* Main Workspace Frame */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Navigation Sidebar */}
        <Sidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          taskCount={tasks.filter((t) => !t.completed).length}
          chatMessageCount={messages.length}
          isAutomationRunning={automationState.status === 'running'}
          geminiStatus={geminiStatus}
        />

        {/* Dynamic View Area */}
        <main className="flex-1 overflow-hidden bg-background relative flex flex-col">
          {automationState.pendingApproval && (
            <div className="absolute top-3 left-6 right-6 z-50 p-4 rounded-xl bg-amber-950/90 border border-amber-500/50 shadow-2xl backdrop-blur-md flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-200">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  Action Authorization Required
                </div>
                <div className="text-sm font-medium text-text-primary">
                  {automationState.pendingApproval.action}
                </div>
                <div className="text-xs text-text-secondary">
                  {automationState.pendingApproval.details}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRespondApproval(automationState.pendingApproval!.id, false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-background-tertiary hover:bg-background-secondary border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={() => handleRespondApproval(automationState.pendingApproval!.id, true)}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-sm transition-colors"
                >
                  Authorize & Proceed
                </button>
              </div>
            </div>
          )}

          {currentTab === 'new-task' && (
            <NewTaskView
              onStartAiTask={handleStartAiTask}
              geminiStatus={geminiStatus}
              onNavigateToSettings={() => setCurrentTab('settings')}
            />
          )}

          {currentTab === 'chat' && (
            <ChatView
              messages={messages}
              isGenerating={isGenerating}
              geminiStatus={geminiStatus}
              onSendMessage={handleSendMessage}
              onStopGeneration={handleStopGeneration}
              onNewChat={handleNewChat}
              onClearChat={handleClearChat}
              onNavigateToSettings={() => setCurrentTab('settings')}
              onNavigateToTasks={() => setCurrentTab('tasks')}
            />
          )}

          {currentTab === 'actions' && (
            <ActionCenterView
              state={automationState}
              onStartAutomation={handleStartAutomation}
              onStopAutomation={handleStopAutomation}
              onRespondApproval={handleRespondApproval}
              downloads={downloads}
              onOpenDownloadsFolder={handleOpenDownloadsFolder}
              onRefreshDownloads={handleRefreshDownloads}
            />
          )}

          {currentTab === 'tasks' && (
            <TasksView
              tasks={tasks}
              onAddTask={handleAddTask}
              onToggleTask={handleToggleTask}
              onDeleteTask={handleDeleteTask}
              onClearCompletedTasks={handleClearCompletedTasks}
              onClearAllTasks={handleClearAllTasks}
            />
          )}

          {currentTab === 'files' && <FilesView />}

          {currentTab === 'settings' && (
            <SettingsView
              settings={settings}
              geminiStatus={geminiStatus}
              onUpdateSettings={handleUpdateSettings}
              onSaveApiKey={handleSaveApiKey}
              onTestConnection={handleTestConnection}
            />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
