import { z } from "zod";
import { pgTable, text, varchar, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

// Export auth models
export * from "./models/auth";

// Avatar options for kids - using icon names instead of emojis
export const AVATARS = ["child", "girl", "boy", "baby", "cool", "robot"] as const;

// Avatar display names and colors for UI
export const AVATAR_CONFIG: Record<typeof AVATARS[number], { label: string; color: string }> = {
  child: { label: "Child", color: "from-purple-400 to-pink-400" },
  girl: { label: "Girl", color: "from-pink-400 to-rose-400" },
  boy: { label: "Boy", color: "from-blue-400 to-cyan-400" },
  baby: { label: "Baby", color: "from-yellow-400 to-orange-400" },
  cool: { label: "Cool", color: "from-indigo-400 to-purple-400" },
  robot: { label: "Robot", color: "from-gray-400 to-slate-400" },
};

// Kid schema
export const kidSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Name is required"),
  avatar: z.enum(AVATARS),
});

export const insertKidSchema = kidSchema.omit({ id: true });

export type Kid = z.infer<typeof kidSchema>;
export type InsertKid = z.infer<typeof insertKidSchema>;

// Voice recording for video completion
export const voiceRecordingSchema = z.object({
  recordedAt: z.string(),
  duration: z.number(), // seconds
  audioData: z.string().optional(), // base64 audio data for playback
});

export type VoiceRecording = z.infer<typeof voiceRecordingSchema>;

// Video progress per kid
export const videoProgressSchema = z.object({
  watched: z.boolean(),
  watchedAt: z.string().optional(),
  voiceRecording: voiceRecordingSchema.optional(),
  voiceRecordings: z.array(voiceRecordingSchema).optional(),
  parentReviewed: z.boolean().optional(),
  lastPosition: z.number().optional(),
  videoDuration: z.number().optional(),
  dailyWatchTime: z.record(z.string(), z.number()).optional(),
});

export type VideoProgress = z.infer<typeof videoProgressSchema>;

// Max views per video
export const MAX_VIDEO_VIEWS = 4;

// Supported video platforms
export const VIDEO_PLATFORMS = ["youtube", "tiktok"] as const;
export type VideoPlatform = typeof VIDEO_PLATFORMS[number];

// Folder schema for organizing videos
export const folderSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Folder name is required"),
});

export const insertFolderSchema = folderSchema.omit({ id: true });

export type Folder = z.infer<typeof folderSchema>;
export type InsertFolder = z.infer<typeof insertFolderSchema>;

// Video priority levels (1 = basic/beginner, 9 = advanced)
export const VIDEO_PRIORITY_MIN = 1;
export const VIDEO_PRIORITY_MAX = 9;
export const VIDEO_PRIORITY_DEFAULT = 5;

// Video schema
export const videoSchema = z.object({
  id: z.string(),
  url: z.string().url("Must be a valid URL"),
  ytId: z.string(), // stores video ID for any platform (YouTube or TikTok)
  platform: z.enum(VIDEO_PLATFORMS).default("youtube"), // video platform type
  folderId: z.string().nullable().optional(), // optional folder assignment
  priority: z.number().min(1).max(9).default(VIDEO_PRIORITY_DEFAULT), // 1=basic, 9=advanced
  assigned: z.record(z.string(), z.boolean()), // kidId -> assigned
  progress: z.record(z.string(), videoProgressSchema), // kidId -> progress
  totalViews: z.number().default(0), // total times video has been watched (max 4)
});

export const insertVideoSchema = z.object({
  url: z.string().url("Must be a valid YouTube or TikTok URL"),
  kidIds: z.array(z.string()).optional(), // if empty/undefined, assign to all kids
  folderId: z.string().nullable().optional(), // optional folder assignment
  priority: z.number().min(1).max(9).default(VIDEO_PRIORITY_DEFAULT), // 1=basic, 9=advanced
});

export type Video = z.infer<typeof videoSchema>;
export type InsertVideo = z.infer<typeof insertVideoSchema>;

// Database tables for Drizzle ORM
export const kidsTable = pgTable("kids", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(), // Owner user ID
  name: text("name").notNull(),
  avatar: text("avatar").notNull(),
});

export const foldersTable = pgTable("folders", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(), // Owner user ID
  name: text("name").notNull(),
});

export const videosTable = pgTable("videos", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(), // Owner user ID
  url: text("url").notNull(),
  ytId: text("yt_id").notNull(), // stores video ID for any platform (removed unique constraint - same video can be added by different users)
  platform: text("platform").notNull().default("youtube"), // youtube or tiktok
  folderId: varchar("folder_id", { length: 64 }),
  priority: integer("priority").notNull().default(5), // 1=basic, 9=advanced
  assigned: jsonb("assigned").notNull().$type<Record<string, boolean>>(),
  progress: jsonb("progress").notNull().$type<Record<string, VideoProgress>>(),
  totalViews: integer("total_views").notNull().default(0),
});

// Global playlist subscriptions - parents subscribe to master's playlists for their kids
export const globalSubscriptionsTable = pgTable("global_subscriptions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  masterFolderId: varchar("master_folder_id", { length: 64 }).notNull(),
  kidIds: jsonb("kid_ids").notNull().$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const globalSubscriptionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  masterFolderId: z.string(),
  kidIds: z.array(z.string()),
  createdAt: z.string().optional(),
});

export const insertGlobalSubscriptionSchema = z.object({
  masterFolderId: z.string().min(1, "Playlist ID is required"),
  kidIds: z.array(z.string()).default([]),
});

export type GlobalSubscription = z.infer<typeof globalSubscriptionSchema>;
export type InsertGlobalSubscription = z.infer<typeof insertGlobalSubscriptionSchema>;

// Feedback table for user feedback with various media types
export const feedbackTable = pgTable("feedback", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(), // Who submitted
  type: text("type").notNull(), // 'text', 'voice', 'video', 'screenshot'
  content: text("content"), // Text content or URL/base64 data
  createdAt: timestamp("created_at").defaultNow(),
});

export const feedbackSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.enum(["text", "voice", "video", "screenshot"]),
  content: z.string().optional(),
  createdAt: z.string().optional(),
});

export const insertFeedbackSchema = z.object({
  type: z.enum(["text", "voice", "video", "screenshot"]),
  content: z.string(),
});

export type Feedback = z.infer<typeof feedbackSchema>;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;

// Helper function to extract YouTube ID from various URL formats
export function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(String(url || "").trim());
    const host = u.hostname.replace("www.", "").toLowerCase();

    if (host === "youtu.be") {
      return u.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (host.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;

      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" && parts[1]) return parts[1];
      if (parts[0] === "embed" && parts[1]) return parts[1];
    }

    return null;
  } catch {
    return null;
  }
}

// Helper function to extract TikTok video ID from various URL formats
// Note: Short URLs (vm.tiktok.com) are NOT supported because they require server-side resolution
// Only full TikTok URLs with numeric video IDs work with embedded playback
export function getTikTokId(url: string): string | null {
  try {
    const u = new URL(String(url || "").trim());
    const host = u.hostname.replace("www.", "").toLowerCase();

    // TikTok URLs: tiktok.com/@user/video/1234567890
    // Short URLs (vm.tiktok.com) are not supported - they contain redirect codes, not video IDs
    if (host === "tiktok.com" || host === "m.tiktok.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      // Format: /@username/video/videoId
      const videoIndex = parts.indexOf("video");
      if (videoIndex !== -1 && parts[videoIndex + 1]) {
        const videoId = parts[videoIndex + 1];
        // Verify it looks like a numeric TikTok video ID
        if (/^\d+$/.test(videoId)) {
          return videoId;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Helper to detect video platform and extract ID
export function getVideoInfo(url: string): { platform: VideoPlatform; videoId: string } | null {
  const youtubeId = getYouTubeId(url);
  if (youtubeId) {
    return { platform: "youtube", videoId: youtubeId };
  }

  const tiktokId = getTikTokId(url);
  if (tiktokId) {
    return { platform: "tiktok", videoId: tiktokId };
  }

  return null;
}
