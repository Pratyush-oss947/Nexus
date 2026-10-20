import React, { useState } from 'react';
import { 
  ListTodo, 
  Plus, 
  Trash2, 
  Check, 
  CheckCircle2, 
  Circle, 
  Clock, 
  AlertTriangle,
  X,
  Filter
} from 'lucide-react';
import { TaskItem } from '../types';

interface TasksViewProps {
  tasks: TaskItem[];
  onAddTask: (title: string, description?: string, category?: string) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onClearCompletedTasks: () => void;
  onClearAllTasks: () => void;
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onClearCompletedTasks,
  onClearAllTasks,
}) => {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('General');

  // Confirmation modal state for destructive actions
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'clear-completed' | 'clear-all';
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: 'clear-completed',
    title: '',
    message: '',
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onAddTask(newTitle.trim(), newDesc.trim() || undefined, newCategory.trim() || 'General');
    setNewTitle('');
    setNewDesc('');
    setIsAdding(false);
  };

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'pending') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  const pendingCount = tasks.filter((t) => !t.completed).length;
  const completedCount = tasks.filter((t) => t.completed).length;

  const handleOpenClearCompleted = () => {
    setConfirmModal({
      isOpen: true,
      type: 'clear-completed',
      title: 'Clear Completed Tasks?',
      message: `Are you sure you want to permanently remove all ${completedCount} completed task(s)? This action cannot be undone.`,
    });
  };

  const handleOpenClearAll = () => {
    setConfirmModal({
      isOpen: true,
      type: 'clear-all',
      title: 'Clear All Tasks?',
      message: `Are you sure you want to permanently erase all ${tasks.length} task(s)? This will clear your entire local task list.`,
    });
  };

  const handleConfirmAction = () => {
    if (confirmModal.type === 'clear-completed') {
      onClearCompletedTasks();
    } else {
      onClearAllTasks();
    }
    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <div className="h-full flex flex-col w-full overflow-hidden bg-background">
      {/* Header */}
      <header className="px-8 py-5 border-b border-border-subtle bg-background-secondary/30 flex items-center justify-between shrink-0 select-none">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-text-primary">
              Task Manager
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-background-tertiary text-text-secondary border border-border-subtle">
              {pendingCount} active • {completedCount} done
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            Local persistent tasks synchronized with NEXUS AI assistant
          </p>
        </div>

        <div className="flex items-center gap-2">
          {completedCount > 0 && (
            <button
              onClick={handleOpenClearCompleted}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-amber-400 hover:bg-amber-500/10 rounded-lg border border-border-subtle transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Done</span>
            </button>
          )}

          {tasks.length > 0 && (
            <button
              onClick={handleOpenClearAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-red-400 hover:bg-red-500/10 rounded-lg border border-border-subtle transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          )}

          <button
            onClick={() => setIsAdding(!isAdding)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Task</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full space-y-6">
        {/* Inline Task Creation Form */}
        {isAdding && (
          <form
            onSubmit={handleCreateSubmit}
            className="p-5 rounded-2xl bg-background-secondary border border-blue-500/40 shadow-lg space-y-4 animate-in fade-in duration-150"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">
                Create New Local Task
              </span>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Task title (e.g., Analyze quarterly performance metrics)"
                  autoFocus
                  className="w-full bg-background-tertiary border border-border rounded-xl px-3.5 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Optional description or acceptance criteria..."
                    className="w-full bg-background-tertiary border border-border rounded-xl px-3.5 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full bg-background-tertiary border border-border rounded-xl px-3.5 py-2 text-xs text-text-primary focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="General">General</option>
                    <option value="Work">Work</option>
                    <option value="Coding">Coding</option>
                    <option value="Research">Research</option>
                    <option value="Personal">Personal</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newTitle.trim()}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                Save Task
              </button>
            </div>
          </form>
        )}

        {/* Filter Tabs */}
        <div className="flex items-center justify-between pb-2 border-b border-border-subtle text-xs select-none">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-white/10 text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              All ({tasks.length})
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === 'pending'
                  ? 'bg-white/10 text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Active ({pendingCount})
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                filter === 'completed'
                  ? 'bg-white/10 text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Completed ({completedCount})
            </button>
          </div>

          <div className="text-[11px] text-text-dim flex items-center gap-1.5">
            <Filter className="w-3 h-3" />
            <span>Showing {filteredTasks.length} items</span>
          </div>
        </div>

        {/* Task List */}
        {filteredTasks.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-background-tertiary border border-border-subtle flex items-center justify-center text-text-muted mb-3">
              <ListTodo className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-medium text-text-primary mb-1">
              {filter === 'all'
                ? 'No tasks created yet'
                : filter === 'pending'
                ? 'No pending tasks'
                : 'No completed tasks yet'}
            </h3>
            <p className="text-xs text-text-muted max-w-sm mb-4">
              {filter === 'all'
                ? 'Create tasks manually above or ask NEXUS AI in chat to automatically add to-do items.'
                : filter === 'pending'
                ? 'All pending tasks have been marked complete!'
                : 'Tasks you mark completed will appear in this archive.'}
            </p>
            {filter === 'all' && (
              <button
                onClick={() => setIsAdding(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-background-tertiary hover:bg-background-elevated text-text-primary border border-border-subtle transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-blue-400" />
                <span>Create First Task</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredTasks.map((task) => (
              <div
                key={task.id}
                className={`group p-4 rounded-xl border transition-all flex items-start gap-3.5 ${
                  task.completed
                    ? 'bg-background-secondary/40 border-border-subtle/60 opacity-75'
                    : 'bg-background-secondary border-border-subtle hover:border-border'
                }`}
              >
                {/* Completion Toggle Button */}
                <button
                  type="button"
                  onClick={() => onToggleTask(task.id)}
                  className={`mt-0.5 w-5 h-5 rounded-lg flex items-center justify-center transition-all focus:outline-none shrink-0 ${
                    task.completed
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-background-tertiary hover:bg-white/10 text-text-muted hover:text-text-primary border border-border-subtle'
                  }`}
                  aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
                >
                  {task.completed ? (
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <Circle className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100" />
                  )}
                </button>

                {/* Task Details */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs font-medium leading-snug select-text ${
                        task.completed
                          ? 'line-through text-text-muted'
                          : 'text-text-primary'
                      }`}
                    >
                      {task.title}
                    </span>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-background-tertiary text-text-dim border border-border-subtle">
                        {task.category || 'General'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteTask(task.id)}
                        className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-red-400 transition-opacity p-1"
                        title="Delete task"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {task.description && (
                    <p
                      className={`text-[11px] leading-relaxed select-text ${
                        task.completed ? 'text-text-dim' : 'text-text-secondary'
                      }`}
                    >
                      {task.description}
                    </p>
                  )}

                  <div className="flex items-center gap-3 pt-1 text-[10px] text-text-dim">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Created {task.createdAt}
                    </span>
                    {task.completed && task.completedAt && (
                      <span className="flex items-center gap-1 text-emerald-400/80">
                        <CheckCircle2 className="w-3 h-3" />
                        Completed {task.completedAt}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal for Destructive Bulk Actions */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-background-secondary border border-border rounded-2xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-text-primary">
                  {confirmModal.title}
                </h3>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {confirmModal.message}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-white/[0.05] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors shadow-sm"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
