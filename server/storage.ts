import { randomUUID } from "crypto";
import { eq, and, inArray, count } from "drizzle-orm";
import type { Kid, Video, InsertKid, VoiceRecording, VideoProgress, Folder, InsertFolder, VideoPlatform, Feedback, InsertFeedback, GlobalSubscription } from "@shared/schema";
import { getVideoInfo, MAX_VIDEO_VIEWS, VIDEO_PRIORITY_DEFAULT, kidsTable, videosTable, foldersTable, feedbackTable, globalSubscriptionsTable } from "@shared/schema";
import { db } from "./db";

export interface IStorage {
  getKids(userId: string): Promise<Kid[]>;
  getKid(id: string, userId: string): Promise<Kid | undefined>;
  createKid(kid: InsertKid, userId: string): Promise<Kid>;
  updateKid(id: string, userId: string, updates: Partial<InsertKid>): Promise<Kid | null>;
  deleteKid(id: string, userId: string): Promise<boolean>;

  getFolders(userId: string): Promise<Folder[]>;
  getFolder(id: string, userId: string): Promise<Folder | undefined>;
  createFolder(folder: InsertFolder, userId: string): Promise<Folder>;
  updateFolder(id: string, userId: string, updates: Partial<InsertFolder>): Promise<Folder | null>;
  deleteFolder(id: string, userId: string): Promise<boolean>;

  getVideos(userId: string): Promise<Video[]>;
  getVideo(id: string, userId: string): Promise<Video | undefined>;
  createVideo(url: string, kidIds: string[] | undefined, allKids: Kid[], userId: string, folderId?: string | null, priority?: number): Promise<{ video: Video | null; error?: string }>;
  updateVideo(id: string, userId: string, updates: { priority?: number; folderId?: string | null }): Promise<Video | null>;
  deleteVideo(id: string, userId: string): Promise<boolean>;
  markVideoWatched(videoId: string, kidId: string, voiceRecording: VoiceRecording, userId: string): Promise<{ video: Video | null; error?: string }>;
  saveVideoPosition(videoId: string, kidId: string, position: number, userId: string, duration?: number): Promise<boolean>;

  createFeedback(feedback: InsertFeedback, userId: string): Promise<Feedback>;

  getBadgeCountForKid(kidId: string, userId: string): Promise<number>;
  getBadgeCountForParent(userId: string): Promise<number>;
  clearParentBadge(userId: string): Promise<void>;

  getKidById(kidId: string): Promise<(Kid & { userId: string }) | undefined>;
  getVideosByOwner(userId: string): Promise<Video[]>;
  getFoldersByOwner(userId: string): Promise<Folder[]>;
  markVideoWatchedPublic(videoId: string, kidId: string, voiceRecording: VoiceRecording, ownerUserId: string): Promise<{ video: Video | null; error?: string }>;

  getGlobalFolders(masterUserId: string): Promise<Folder[]>;
  getGlobalFoldersWithCounts(masterUserId: string): Promise<(Folder & { videoCount: number })[]>;
  getGlobalVideos(masterUserId: string, folderId: string): Promise<Video[]>;
  getSubscriptions(userId: string): Promise<GlobalSubscription[]>;
  subscribe(userId: string, masterFolderId: string, kidIds: string[], masterUserId: string): Promise<GlobalSubscription>;
  unsubscribe(userId: string, masterFolderId: string): Promise<boolean>;
  syncSubscription(userId: string, masterFolderId: string, masterUserId: string): Promise<void>;
  syncAllSubscriptions(userId: string, masterUserId: string): Promise<void>;
  cleanupGlobalData(userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getKids(userId: string): Promise<Kid[]> {
    const rows = await db.select().from(kidsTable).where(eq(kidsTable.userId, userId));
    return rows.map(r => ({ id: r.id, name: r.name, avatar: r.avatar as Kid["avatar"] }));
  }

  async getKid(id: string, userId: string): Promise<Kid | undefined> {
    const rows = await db.select().from(kidsTable).where(and(eq(kidsTable.id, id), eq(kidsTable.userId, userId)));
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return { id: r.id, name: r.name, avatar: r.avatar as Kid["avatar"] };
  }

  async createKid(insertKid: InsertKid, userId: string): Promise<Kid> {
    const id = `kid_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const kid: Kid = { ...insertKid, id };
    await db.insert(kidsTable).values({ ...kid, userId });

    const allVideos = await this.getVideos(userId);
    for (const video of allVideos) {
      video.assigned[id] = true;
      video.progress[id] = { watched: false };
      await db.update(videosTable)
        .set({ assigned: video.assigned, progress: video.progress })
        .where(eq(videosTable.id, video.id));
    }

    return kid;
  }

  async updateKid(id: string, userId: string, updates: Partial<InsertKid>): Promise<Kid | null> {
    const existing = await this.getKid(id, userId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    await db.update(kidsTable).set({ name: updated.name, avatar: updated.avatar }).where(and(eq(kidsTable.id, id), eq(kidsTable.userId, userId)));
    return updated;
  }

  async deleteKid(id: string, userId: string): Promise<boolean> {
    await db.delete(kidsTable).where(and(eq(kidsTable.id, id), eq(kidsTable.userId, userId)));
    return true;
  }

  async getFolders(userId: string): Promise<Folder[]> {
    const rows = await db.select().from(foldersTable).where(eq(foldersTable.userId, userId));
    return rows.map(r => ({ id: r.id, name: r.name }));
  }

  async getFolder(id: string, userId: string): Promise<Folder | undefined> {
    const rows = await db.select().from(foldersTable).where(and(eq(foldersTable.id, id), eq(foldersTable.userId, userId)));
    if (rows.length === 0) return undefined;
    return { id: rows[0].id, name: rows[0].name };
  }

  async createFolder(insertFolder: InsertFolder, userId: string): Promise<Folder> {
    const id = `folder_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const folder: Folder = { ...insertFolder, id };
    await db.insert(foldersTable).values({ ...folder, userId });
    return folder;
  }

  async updateFolder(id: string, userId: string, updates: Partial<InsertFolder>): Promise<Folder | null> {
    const existing = await this.getFolder(id, userId);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    await db.update(foldersTable).set({ name: updated.name }).where(and(eq(foldersTable.id, id), eq(foldersTable.userId, userId)));
    return updated;
  }

  async deleteFolder(id: string, userId: string): Promise<boolean> {
    await db.update(videosTable)
      .set({ folderId: null })
      .where(and(eq(videosTable.folderId, id), eq(videosTable.userId, userId)));
    await db.delete(foldersTable).where(and(eq(foldersTable.id, id), eq(foldersTable.userId, userId)));
    return true;
  }

  async getVideos(userId: string): Promise<Video[]> {
    const rows = await db.select().from(videosTable).where(eq(videosTable.userId, userId));
    return rows.map(r => ({
      id: r.id,
      url: r.url,
      ytId: r.ytId,
      platform: (r.platform || "youtube") as VideoPlatform,
      folderId: r.folderId,
      priority: r.priority ?? VIDEO_PRIORITY_DEFAULT,
      assigned: r.assigned,
      progress: r.progress,
      totalViews: r.totalViews,
    }));
  }

  async getVideo(id: string, userId: string): Promise<Video | undefined> {
    const rows = await db.select().from(videosTable).where(and(eq(videosTable.id, id), eq(videosTable.userId, userId)));
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return {
      id: r.id,
      url: r.url,
      ytId: r.ytId,
      platform: (r.platform || "youtube") as VideoPlatform,
      folderId: r.folderId,
      priority: r.priority ?? VIDEO_PRIORITY_DEFAULT,
      assigned: r.assigned,
      progress: r.progress,
      totalViews: r.totalViews,
    };
  }

  async createVideo(url: string, kidIds: string[] | undefined, allKids: Kid[], userId: string, folderId?: string | null, priority?: number): Promise<{ video: Video | null; error?: string }> {
    const videoInfo = getVideoInfo(url);
    if (!videoInfo) return { video: null, error: "Invalid video URL. Please paste a valid YouTube or TikTok link." };

    const { platform, videoId } = videoInfo;

    const existing = await db.select().from(videosTable).where(and(eq(videosTable.ytId, videoId), eq(videosTable.userId, userId)));
    if (existing.length > 0) return { video: null, error: "This video has already been added to your library." };

    const id = `vid_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const assigned: Record<string, boolean> = {};
    const progress: Record<string, VideoProgress> = {};

    const targetKids = kidIds && kidIds.length > 0
      ? allKids.filter(k => kidIds.includes(k.id))
      : allKids;

    for (const kid of targetKids) {
      assigned[kid.id] = true;
      progress[kid.id] = { watched: false };
    }

    const videoPriority = priority ?? VIDEO_PRIORITY_DEFAULT;
    const video: Video = { id, url, ytId: videoId, platform, folderId: folderId || null, priority: videoPriority, assigned, progress, totalViews: 0 };
    await db.insert(videosTable).values({ ...video, userId, folderId: folderId || null, priority: videoPriority });
    return { video };
  }

  async updateVideo(id: string, userId: string, updates: { priority?: number; folderId?: string | null }): Promise<Video | null> {
    const video = await this.getVideo(id, userId);
    if (!video) return null;
    
    const updateData: Partial<{ priority: number; folderId: string | null }> = {};
    if (updates.priority !== undefined) updateData.priority = updates.priority;
    if (updates.folderId !== undefined) updateData.folderId = updates.folderId;
    
    if (Object.keys(updateData).length > 0) {
      await db.update(videosTable).set(updateData).where(and(eq(videosTable.id, id), eq(videosTable.userId, userId)));
    }
    
    return this.getVideo(id, userId) as Promise<Video>;
  }

  async deleteVideo(id: string, userId: string): Promise<boolean> {
    await db.delete(videosTable).where(and(eq(videosTable.id, id), eq(videosTable.userId, userId)));
    return true;
  }

  async markVideoWatched(videoId: string, kidId: string, voiceRecording: VoiceRecording, userId: string): Promise<{ video: Video | null; error?: string }> {
    const video = await this.getVideo(videoId, userId);
    if (!video) return { video: null, error: "Video not found" };

    const alreadyWatched = video.progress[kidId]?.watched;

    if (!alreadyWatched && video.totalViews >= MAX_VIDEO_VIEWS) {
      return { video: null, error: "This video has reached the maximum number of views (4)" };
    }

    const existingRecordings = video.progress[kidId]?.voiceRecordings || [];
    const legacySingle = video.progress[kidId]?.voiceRecording;
    if (legacySingle && existingRecordings.length === 0) {
      existingRecordings.push(legacySingle);
    }
    
    existingRecordings.push(voiceRecording);

    video.progress[kidId] = {
      watched: true,
      watchedAt: video.progress[kidId]?.watchedAt || new Date().toISOString(),
      voiceRecordings: existingRecordings,
      parentReviewed: false,
    };
    
    if (!alreadyWatched) {
      video.totalViews = (video.totalViews || 0) + 1;
    }

    await db.update(videosTable)
      .set({ progress: video.progress, totalViews: video.totalViews })
      .where(and(eq(videosTable.id, videoId), eq(videosTable.userId, userId)));

    return { video };
  }

  async getKidById(kidId: string): Promise<(Kid & { userId: string }) | undefined> {
    const rows = await db.select().from(kidsTable).where(eq(kidsTable.id, kidId));
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return { id: r.id, name: r.name, avatar: r.avatar as Kid["avatar"], userId: r.userId };
  }

  async getVideosByOwner(userId: string): Promise<Video[]> {
    return this.getVideos(userId);
  }

  async getFoldersByOwner(userId: string): Promise<Folder[]> {
    return this.getFolders(userId);
  }

  async markVideoWatchedPublic(videoId: string, kidId: string, voiceRecording: VoiceRecording, ownerUserId: string): Promise<{ video: Video | null; error?: string }> {
    return this.markVideoWatched(videoId, kidId, voiceRecording, ownerUserId);
  }

  async saveVideoPosition(videoId: string, kidId: string, position: number, userId: string, duration?: number): Promise<boolean> {
    const [video] = await db.select().from(videosTable).where(
      and(eq(videosTable.id, videoId), eq(videosTable.userId, userId))
    );
    if (!video) return false;
    const progress = { ...(video.progress || {}) };
    if (!progress[kidId]) {
      progress[kidId] = { watched: false };
    }
    const prevPosition = progress[kidId].lastPosition || 0;
    const increment = Math.max(0, position - prevPosition);
    if (increment > 0 && increment < 30) {
      const today = new Date().toISOString().slice(0, 10);
      const daily = progress[kidId].dailyWatchTime || {};
      daily[today] = (daily[today] || 0) + increment;
      progress[kidId].dailyWatchTime = daily;
    }
    progress[kidId] = { ...progress[kidId], lastPosition: position };
    if (duration && duration > 0) {
      progress[kidId].videoDuration = duration;
    }
    await db.update(videosTable).set({ progress }).where(eq(videosTable.id, videoId));
    return true;
  }

  async getBadgeCountForKid(kidId: string, userId: string): Promise<number> {
    const videos = await this.getVideos(userId);
    let count = 0;
    for (const video of videos) {
      if (video.assigned?.[kidId] && !video.progress?.[kidId]?.watched) {
        count++;
      }
    }
    return count;
  }

  async getBadgeCountForParent(userId: string): Promise<number> {
    const videos = await this.getVideos(userId);
    let count = 0;
    for (const video of videos) {
      for (const kidId of Object.keys(video.progress || {})) {
        const prog = video.progress[kidId];
        if (prog?.watched && prog?.parentReviewed === false) {
          count++;
        }
      }
    }
    return count;
  }

  async clearParentBadge(userId: string): Promise<void> {
    const videos = await this.getVideos(userId);
    for (const video of videos) {
      let changed = false;
      for (const kidId of Object.keys(video.progress || {})) {
        if (video.progress[kidId]?.watched && video.progress[kidId]?.parentReviewed === false) {
          video.progress[kidId].parentReviewed = true;
          changed = true;
        }
      }
      if (changed) {
        await db.update(videosTable)
          .set({ progress: video.progress })
          .where(and(eq(videosTable.id, video.id), eq(videosTable.userId, userId)));
      }
    }
  }

  async createFeedback(feedback: InsertFeedback, userId: string): Promise<Feedback> {
    const id = `fb_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const createdAt = new Date();
    await db.insert(feedbackTable).values({
      id,
      userId,
      type: feedback.type,
      content: feedback.content,
      createdAt,
    });
    return {
      id,
      userId,
      type: feedback.type as Feedback["type"],
      content: feedback.content,
      createdAt: createdAt.toISOString(),
    };
  }

  async getGlobalFolders(masterUserId: string): Promise<Folder[]> {
    const rows = await db.select().from(foldersTable).where(eq(foldersTable.userId, masterUserId));
    return rows.filter(r => !r.name.startsWith("__global_")).map(r => ({ id: r.id, name: r.name }));
  }

  async getGlobalFoldersWithCounts(masterUserId: string): Promise<(Folder & { videoCount: number })[]> {
    const folders = await this.getGlobalFolders(masterUserId);
    if (folders.length === 0) return [];
    const folderIds = folders.map(f => f.id);
    const countRows = await db
      .select({ folderId: videosTable.folderId, videoCount: count() })
      .from(videosTable)
      .where(and(
        eq(videosTable.userId, masterUserId),
        inArray(videosTable.folderId, folderIds)
      ))
      .groupBy(videosTable.folderId);
    const countMap = new Map(countRows.map(r => [r.folderId, Number(r.videoCount)]));
    return folders.map(f => ({ ...f, videoCount: countMap.get(f.id) || 0 }));
  }

  async getGlobalVideos(masterUserId: string, folderId: string): Promise<Video[]> {
    const rows = await db.select().from(videosTable).where(
      and(eq(videosTable.userId, masterUserId), eq(videosTable.folderId, folderId))
    );
    return rows.map(r => ({
      id: r.id,
      url: r.url,
      ytId: r.ytId,
      platform: (r.platform || "youtube") as VideoPlatform,
      folderId: r.folderId,
      priority: r.priority ?? VIDEO_PRIORITY_DEFAULT,
      assigned: r.assigned,
      progress: r.progress,
      totalViews: r.totalViews,
    }));
  }

  async getSubscriptions(userId: string): Promise<GlobalSubscription[]> {
    const rows = await db.select().from(globalSubscriptionsTable).where(eq(globalSubscriptionsTable.userId, userId));
    return rows.map(r => ({
      id: r.id,
      userId: r.userId,
      masterFolderId: r.masterFolderId,
      kidIds: r.kidIds as string[],
      createdAt: r.createdAt?.toISOString(),
    }));
  }

  async subscribe(userId: string, masterFolderId: string, kidIds: string[], masterUserId: string): Promise<GlobalSubscription> {
    const existing = await db.select().from(globalSubscriptionsTable).where(
      and(eq(globalSubscriptionsTable.userId, userId), eq(globalSubscriptionsTable.masterFolderId, masterFolderId))
    );
    if (existing.length > 0) {
      await db.update(globalSubscriptionsTable)
        .set({ kidIds })
        .where(eq(globalSubscriptionsTable.id, existing[0].id));
      await this.syncSubscription(userId, masterFolderId, masterUserId);
      return { id: existing[0].id, userId, masterFolderId, kidIds, createdAt: existing[0].createdAt?.toISOString() };
    }

    const id = `gsub_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const createdAt = new Date();
    await db.insert(globalSubscriptionsTable).values({ id, userId, masterFolderId, kidIds, createdAt });

    await this.syncSubscription(userId, masterFolderId, masterUserId);

    return { id, userId, masterFolderId, kidIds, createdAt: createdAt.toISOString() };
  }

  async unsubscribe(userId: string, masterFolderId: string): Promise<boolean> {
    const sub = await db.select().from(globalSubscriptionsTable).where(
      and(eq(globalSubscriptionsTable.userId, userId), eq(globalSubscriptionsTable.masterFolderId, masterFolderId))
    );
    if (sub.length === 0) return false;

    const localFolder = await db.select().from(foldersTable).where(
      and(eq(foldersTable.userId, userId), eq(foldersTable.name, `__global_${masterFolderId}`))
    );
    if (localFolder.length > 0) {
      await db.delete(videosTable).where(
        and(eq(videosTable.userId, userId), eq(videosTable.folderId, localFolder[0].id))
      );
      await db.delete(foldersTable).where(eq(foldersTable.id, localFolder[0].id));
    }

    await db.delete(globalSubscriptionsTable).where(eq(globalSubscriptionsTable.id, sub[0].id));
    return true;
  }

  async syncSubscription(userId: string, masterFolderId: string, masterUserId: string): Promise<void> {
    const sub = await db.select().from(globalSubscriptionsTable).where(
      and(eq(globalSubscriptionsTable.userId, userId), eq(globalSubscriptionsTable.masterFolderId, masterFolderId))
    );
    if (sub.length === 0) return;

    const kidIds = sub[0].kidIds as string[];
    const allKids = await this.getKids(userId);
    const targetKids = kidIds.length > 0 ? allKids.filter(k => kidIds.includes(k.id)) : allKids;

    const masterFolder = await db.select().from(foldersTable).where(
      and(eq(foldersTable.id, masterFolderId), eq(foldersTable.userId, masterUserId))
    );
    if (masterFolder.length === 0) return;

    const localFolderName = `__global_${masterFolderId}`;
    let localFolderRows = await db.select().from(foldersTable).where(
      and(eq(foldersTable.userId, userId), eq(foldersTable.name, localFolderName))
    );

    let localFolderId: string;
    if (localFolderRows.length === 0) {
      localFolderId = `folder_${Date.now()}_${randomUUID().slice(0, 8)}`;
      await db.insert(foldersTable).values({ id: localFolderId, userId, name: localFolderName });
    } else {
      localFolderId = localFolderRows[0].id;
    }

    const masterVideos = await this.getGlobalVideos(masterUserId, masterFolderId);
    const existingLocal = await db.select().from(videosTable).where(
      and(eq(videosTable.userId, userId), eq(videosTable.folderId, localFolderId))
    );
    const existingYtIds = new Set(existingLocal.map(v => v.ytId));

    for (const mv of masterVideos) {
      if (existingYtIds.has(mv.ytId)) continue;

      const id = `vid_${Date.now()}_${randomUUID().slice(0, 8)}_g`;
      const assigned: Record<string, boolean> = {};
      const progress: Record<string, VideoProgress> = {};
      for (const kid of targetKids) {
        assigned[kid.id] = true;
        progress[kid.id] = { watched: false };
      }

      await db.insert(videosTable).values({
        id,
        userId,
        url: mv.url,
        ytId: mv.ytId,
        platform: mv.platform,
        folderId: localFolderId,
        priority: mv.priority,
        assigned,
        progress,
        totalViews: 0,
      });
    }
  }

  async syncAllSubscriptions(userId: string, masterUserId: string): Promise<void> {
    const subs = await db.select().from(globalSubscriptionsTable).where(eq(globalSubscriptionsTable.userId, userId));
    for (const sub of subs) {
      await this.syncSubscription(userId, sub.masterFolderId, masterUserId);
    }
  }

  async cleanupGlobalData(userId: string): Promise<void> {
    const allFolders = await db.select().from(foldersTable).where(eq(foldersTable.userId, userId));
    const globalFolders = allFolders.filter(f => f.name.startsWith("__global_"));

    for (const gf of globalFolders) {
      await db.delete(videosTable).where(
        and(eq(videosTable.userId, userId), eq(videosTable.folderId, gf.id))
      );
      await db.delete(foldersTable).where(eq(foldersTable.id, gf.id));
    }

    await db.delete(globalSubscriptionsTable).where(eq(globalSubscriptionsTable.userId, userId));
  }
}

export const storage = new DatabaseStorage();
