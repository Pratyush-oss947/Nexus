import * as fs from 'fs';
import * as path from 'path';

export interface TaskRecord {
  id: string;
  title: string;
  description?: string;
  category?: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

export class TaskManager {
  private storagePath: string;
  private tasks: TaskRecord[] = [];

  constructor(customStorageDir?: string) {
    const dir = customStorageDir || process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library', 'Application Support') : path.join(process.env.HOME || '', '.config'));
    const nexusDir = path.join(dir, 'nexus-ai');
    if (!fs.existsSync(nexusDir)) {
      try {
        fs.mkdirSync(nexusDir, { recursive: true });
      } catch {}
    }
    this.storagePath = path.join(nexusDir, 'nexus_tasks.json');
    this.loadTasks();
  }

  public loadTasks(): TaskRecord[] {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf-8');
        this.tasks = JSON.parse(raw);
        if (!Array.isArray(this.tasks)) this.tasks = [];
      } else {
        this.tasks = [];
      }
    } catch {
      this.tasks = [];
    }
    return this.tasks;
  }

  public saveTasks(tasks?: TaskRecord[]): boolean {
    try {
      if (tasks) this.tasks = tasks;
      fs.writeFileSync(this.storagePath, JSON.stringify(this.tasks, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('Failed to save tasks:', err);
      return false;
    }
  }

  public createTask(title: string, category: string = 'General', description?: string): TaskRecord {
    const newTask: TaskRecord = {
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title: title.trim(),
      category: category.trim() || 'General',
      description: description?.trim() || undefined,
      completed: false,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.tasks.unshift(newTask);
    this.saveTasks();
    return newTask;
  }

  public listTasks(filter?: 'all' | 'pending' | 'completed'): TaskRecord[] {
    this.loadTasks();
    if (filter === 'completed') {
      return this.tasks.filter((t) => t.completed);
    }
    if (filter === 'pending') {
      return this.tasks.filter((t) => !t.completed);
    }
    return this.tasks;
  }

  public completeTask(identifier: string): { success: boolean; task?: TaskRecord; error?: string } {
    this.loadTasks();
    const idClean = identifier.trim().toLowerCase();
    const found = this.tasks.find(
      (t) => t.id.toLowerCase() === idClean || t.title.toLowerCase().includes(idClean)
    );

    if (!found) {
      return { success: false, error: `No task found matching "${identifier}"` };
    }

    found.completed = true;
    found.completedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.saveTasks();
    return { success: true, task: found };
  }

  public updateTask(
    identifier: string,
    updates: { title?: string; category?: string; description?: string }
  ): { success: boolean; task?: TaskRecord; error?: string } {
    this.loadTasks();
    const idClean = identifier.trim().toLowerCase();
    const found = this.tasks.find(
      (t) => t.id.toLowerCase() === idClean || t.title.toLowerCase().includes(idClean)
    );

    if (!found) {
      return { success: false, error: `No task found matching "${identifier}"` };
    }

    if (updates.title) found.title = updates.title.trim();
    if (updates.category) found.category = updates.category.trim();
    if (updates.description !== undefined) found.description = updates.description.trim();
    this.saveTasks();
    return { success: true, task: found };
  }

  public deleteTask(identifier: string): { success: boolean; deletedTask?: TaskRecord; error?: string } {
    this.loadTasks();
    const idClean = identifier.trim().toLowerCase();
    const index = this.tasks.findIndex(
      (t) => t.id.toLowerCase() === idClean || t.title.toLowerCase() === idClean
    );

    if (index === -1) {
      return { success: false, error: `No task found matching "${identifier}"` };
    }

    const [deleted] = this.tasks.splice(index, 1);
    this.saveTasks();
    return { success: true, deletedTask: deleted };
  }

  public getSummary(): string {
    this.loadTasks();
    const total = this.tasks.length;
    const completed = this.tasks.filter((t) => t.completed).length;
    const pending = total - completed;
    return `Total Tasks: ${total} (${completed} completed, ${pending} pending)`;
  }
}
