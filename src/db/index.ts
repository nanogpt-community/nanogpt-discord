import { Database } from "bun:sqlite";

const DATABASE_PATH = process.env.DATABASE_PATH || "./data/bot.db";

// Ensure data directory exists
import { mkdirSync } from "fs";
import { dirname } from "path";

try {
    mkdirSync(dirname(DATABASE_PATH), { recursive: true });
} catch {
    // Directory already exists
}

export const db = new Database(DATABASE_PATH, { create: true });

// Enable WAL mode for better concurrent access
db.exec("PRAGMA journal_mode = WAL");

// Initialize schema
db.exec(`
  -- Guild/Server settings
  CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    default_model TEXT DEFAULT 'gpt-4o-mini',
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- User-specific settings
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    default_model TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  -- Document context (PDFs, text files, etc.)
  CREATE TABLE IF NOT EXISTS contexts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    source_filename TEXT,
    file_type TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(guild_id, user_id, name)
  );

  -- Per-user conversation memory (global across servers)
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, created_at);
`);

// Add user_id column if it doesn't exist (migration for existing databases)
try {
    db.exec("ALTER TABLE contexts ADD COLUMN user_id TEXT");
} catch {
    // Column already exists
}

// Prepared statements for common operations
export const queries = {
    // Guild operations
    getGuild: db.prepare<{ id: string; default_model: string; created_at: number }, [string]>(
        "SELECT * FROM guilds WHERE id = ?"
    ),
    upsertGuild: db.prepare(
        "INSERT INTO guilds (id, default_model) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET default_model = excluded.default_model"
    ),

    // User operations
    getUser: db.prepare<{ id: string; default_model: string | null; created_at: number }, [string]>(
        "SELECT * FROM users WHERE id = ?"
    ),
    upsertUser: db.prepare(
        "INSERT INTO users (id, default_model) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET default_model = excluded.default_model"
    ),

    // Context operations - Server scope (user_id IS NULL)
    getServerContext: db.prepare<
        { id: number; guild_id: string; user_id: string | null; name: string; content: string; source_filename: string; file_type: string; created_at: number },
        [string, string]
    >("SELECT * FROM contexts WHERE guild_id = ? AND name = ? AND user_id IS NULL"),

    getServerContexts: db.prepare<
        { id: number; guild_id: string; user_id: string | null; name: string; content: string; source_filename: string; file_type: string; created_at: number },
        [string]
    >("SELECT * FROM contexts WHERE guild_id = ? AND user_id IS NULL ORDER BY created_at DESC"),

    insertServerContext: db.prepare(
        "INSERT INTO contexts (guild_id, user_id, name, content, source_filename, file_type) VALUES (?, NULL, ?, ?, ?, ?)"
    ),

    deleteServerContext: db.prepare("DELETE FROM contexts WHERE guild_id = ? AND name = ? AND user_id IS NULL"),

    // Context operations - User scope
    getUserContext: db.prepare<
        { id: number; guild_id: string; user_id: string | null; name: string; content: string; source_filename: string; file_type: string; created_at: number },
        [string, string, string]
    >("SELECT * FROM contexts WHERE guild_id = ? AND user_id = ? AND name = ?"),

    getUserContexts: db.prepare<
        { id: number; guild_id: string; user_id: string | null; name: string; content: string; source_filename: string; file_type: string; created_at: number },
        [string, string]
    >("SELECT * FROM contexts WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC"),

    insertUserContext: db.prepare(
        "INSERT INTO contexts (guild_id, user_id, name, content, source_filename, file_type) VALUES (?, ?, ?, ?, ?, ?)"
    ),

    deleteUserContext: db.prepare("DELETE FROM contexts WHERE guild_id = ? AND user_id = ? AND name = ?"),

    // Combined query - get context by name (checks user first, then server)
    getContextByName: db.prepare<
        { id: number; guild_id: string; user_id: string | null; name: string; content: string; source_filename: string; file_type: string; created_at: number },
        [string, string, string]
    >("SELECT * FROM contexts WHERE guild_id = ? AND name = ? AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC LIMIT 1"),
};

// Helper functions
export function getDefaultModel(guildId: string, userId: string): string {
    const user = queries.getUser.get(userId);
    if (user?.default_model) {
        return user.default_model;
    }

    const guild = queries.getGuild.get(guildId);
    if (guild?.default_model) {
        return guild.default_model;
    }

    return process.env.DEFAULT_MODEL || "gpt-4o-mini";
}

export function setGuildModel(guildId: string, model: string): void {
    queries.upsertGuild.run(guildId, model);
}

export function setUserModel(userId: string, model: string): void {
    queries.upsertUser.run(userId, model);
}

// Context functions with scope support
export function addContext(
    guildId: string,
    name: string,
    content: string,
    sourceFilename: string,
    fileType: string,
    userId?: string
): void {
    if (userId) {
        queries.insertUserContext.run(guildId, userId, name, content, sourceFilename, fileType);
    } else {
        queries.insertServerContext.run(guildId, name, content, sourceFilename, fileType);
    }
}

export function getContext(guildId: string, name: string, userId?: string) {
    // If userId provided, check user context first
    if (userId) {
        const userContext = queries.getUserContext.get(guildId, userId, name);
        if (userContext) return userContext;
    }
    // Fall back to server context
    return queries.getServerContext.get(guildId, name);
}

export function getAllContexts(guildId: string, userId?: string) {
    if (userId) {
        return queries.getUserContexts.all(guildId, userId);
    }
    return queries.getServerContexts.all(guildId);
}

export function removeContext(guildId: string, name: string, userId?: string): boolean {
    if (userId) {
        const result = queries.deleteUserContext.run(guildId, userId, name);
        return result.changes > 0;
    }
    const result = queries.deleteServerContext.run(guildId, name);
    return result.changes > 0;
}

// Memory queries (global per-user)
const memoryQueries = {
    insertMemory: db.prepare(
        "INSERT INTO memories (user_id, role, content, model) VALUES (?, ?, ?, ?)"
    ),
    getMemoryHistory: db.prepare<
        { id: number; user_id: string; role: string; content: string; model: string | null; created_at: number },
        [string, number]
    >("SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"),
    clearMemory: db.prepare("DELETE FROM memories WHERE user_id = ?"),
    getMemoryStats: db.prepare<
        { count: number; first_at: number | null; last_at: number | null },
        [string]
    >("SELECT COUNT(*) as count, MIN(created_at) as first_at, MAX(created_at) as last_at FROM memories WHERE user_id = ?"),
};

// Memory functions (global per-user, not per-guild)
export function addMemoryMessage(userId: string, role: "user" | "assistant", content: string, model?: string): void {
    memoryQueries.insertMemory.run(userId, role, content, model || null);
}

export function getMemoryHistory(userId: string, limit: number = 20): { role: string; content: string }[] {
    const rows = memoryQueries.getMemoryHistory.all(userId, limit);
    // Reverse to get chronological order (oldest first)
    return rows.reverse().map(row => ({ role: row.role, content: row.content }));
}

export function clearMemory(userId: string): number {
    const result = memoryQueries.clearMemory.run(userId);
    return result.changes;
}

export function getMemoryStats(userId: string): { count: number; firstAt: Date | null; lastAt: Date | null } {
    const row = memoryQueries.getMemoryStats.get(userId);
    return {
        count: row?.count || 0,
        firstAt: row?.first_at ? new Date(row.first_at * 1000) : null,
        lastAt: row?.last_at ? new Date(row.last_at * 1000) : null,
    };
}

console.log("[DB] Database initialized at", DATABASE_PATH);
