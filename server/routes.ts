import type { Express, Request, Response } from "express";
import { type Server } from "http";
import path from "path";
import { storage } from "./storage";
import { insertKidSchema, insertVideoSchema, insertFolderSchema, insertFeedbackSchema, insertGlobalSubscriptionSchema, getVideoInfo, type Kid, videosTable } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { authStorage } from "./replit_integrations/auth/storage";

async function resolveTikTokShortUrl(shortUrl: string): Promise<string | null> {
  try {
    const response = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'follow',
    });
    const finalUrl = response.url;
    
    const videoInfo = getVideoInfo(finalUrl);
    if (videoInfo && videoInfo.platform === 'tiktok') {
      return finalUrl;
    }
    return null;
  } catch (error) {
    console.error('Failed to resolve TikTok short URL:', error);
    return null;
  }
}

function isTikTokShortUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '').toLowerCase();
    return host === 'vm.tiktok.com' || (host === 'tiktok.com' && u.pathname.startsWith('/t/'));
  } catch {
    return false;
  }
}

function getUserId(req: Request): string {
  const sub = (req.user as any)?.claims?.sub;
  return sub ? String(sub) : '';
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get("/api/trial-status", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const user = await authStorage.getUser(userId);
      if (!user || !user.createdAt) {
        return res.json({ daysLeft: 30, show: false, frozen: false });
      }
      const now = new Date();
      const trialStart = new Date(user.createdAt);
      const msPerDay = 1000 * 60 * 60 * 24;
      const daysSinceStart = Math.floor((now.getTime() - trialStart.getTime()) / msPerDay);
      const totalTrialDays = 30;
      const daysLeft = Math.max(0, totalTrialDays - daysSinceStart);
      const show = daysSinceStart <= totalTrialDays;
      const frozen = daysSinceStart >= 15 && daysSinceStart <= totalTrialDays;
      res.json({ daysLeft, show, frozen });
    } catch (error) {
      console.error("Failed to get trial status:", error);
      res.json({ daysLeft: 0, show: false, frozen: false });
    }
  });

  app.get("/api/debug-session", isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user as any;
    const userId = getUserId(req);
    res.json({
      userId,
      hasClaims: !!user?.claims,
      sub: user?.claims?.sub,
      subType: typeof user?.claims?.sub,
      hasAccessToken: !!user?.access_token,
      expiresAt: user?.expires_at,
      now: Math.floor(Date.now() / 1000),
      isAuthenticated: req.isAuthenticated(),
      sessionId: req.sessionID?.substring(0, 8),
    });
  });

  app.post("/api/resolve-tiktok-url", isAuthenticated, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: "URL is required" });
      }
      
      if (!isTikTokShortUrl(url)) {
        return res.status(400).json({ error: "Not a TikTok short URL" });
      }
      
      const resolvedUrl = await resolveTikTokShortUrl(url);
      if (!resolvedUrl) {
        return res.status(400).json({ error: "Could not resolve TikTok URL" });
      }
      
      res.json({ resolvedUrl });
    } catch (error) {
      console.error("Failed to resolve TikTok URL:", error);
      res.status(500).json({ error: "Failed to resolve TikTok URL" });
    }
  });

  app.get("/api/tiktok-thumbnail/:videoId", isAuthenticated, async (req, res) => {
    try {
      const { videoId } = req.params;
      if (!videoId) {
        return res.status(400).json({ error: "Video ID is required" });
      }
      
      const videoUrl = `https://www.tiktok.com/video/${videoId}`;
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
      
      const response = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)'
        }
      });
      
      if (!response.ok) {
        const fallbackUrl = `https://www.tiktok.com/@_/video/${videoId}`;
        const fallbackOembed = `https://www.tiktok.com/oembed?url=${encodeURIComponent(fallbackUrl)}`;
        const fallbackRes = await fetch(fallbackOembed);
        
        if (!fallbackRes.ok) {
          return res.status(404).json({ error: "Could not fetch thumbnail" });
        }
        
        const fallbackData = await fallbackRes.json() as { thumbnail_url?: string };
        if (fallbackData.thumbnail_url) {
          return res.json({ thumbnailUrl: fallbackData.thumbnail_url });
        }
        return res.status(404).json({ error: "Thumbnail not found" });
      }
      
      const data = await response.json() as { thumbnail_url?: string };
      if (data.thumbnail_url) {
        res.json({ thumbnailUrl: data.thumbnail_url });
      } else {
        res.status(404).json({ error: "Thumbnail not found" });
      }
    } catch (error) {
      console.error("Failed to fetch TikTok thumbnail:", error);
      res.status(500).json({ error: "Failed to fetch thumbnail" });
    }
  });

  app.get("/api/kids", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      console.log("[GET /api/kids] userId:", JSON.stringify(userId));
      const kids = await storage.getKids(userId);
      console.log("[GET /api/kids] found", kids.length, "kids");
      res.json(kids);
    } catch (error) {
      console.error("Failed to fetch kids:", error);
      res.status(500).json({ error: "Failed to fetch kids" });
    }
  });

  app.post("/api/kids", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      console.log("[POST /api/kids] userId:", JSON.stringify(userId), "body:", JSON.stringify(req.body));
      if (!userId) {
        return res.status(401).json({ error: "No user ID found in session" });
      }
      const parsed = insertKidSchema.safeParse(req.body);
      if (!parsed.success) {
        console.log("[POST /api/kids] validation error:", parsed.error.message);
        return res.status(400).json({ error: parsed.error.message });
      }

      const kids = await storage.getKids(userId);
      if (kids.length >= 6) {
        return res.status(400).json({ error: "Maximum 6 kids allowed" });
      }

      const newName = parsed.data.name.trim().toLowerCase();
      const duplicate = kids.find(k => k.name.trim().toLowerCase() === newName);
      if (duplicate) {
        return res.status(400).json({ error: `A kid named "${parsed.data.name}" already exists` });
      }

      const kid = await storage.createKid(parsed.data, userId);
      console.log("[POST /api/kids] created kid:", JSON.stringify(kid));
      res.status(201).json(kid);
    } catch (error: any) {
      console.error("[POST /api/kids] FAILED:", error?.message, error?.stack);
      res.status(500).json({ error: "Failed to create kid", detail: error?.message });
    }
  });

  app.patch("/api/kids/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = req.params.id as string;
      const { name } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: "Name is required" });
      }
      const kids = await storage.getKids(userId);
      const newName = name.trim().toLowerCase();
      const duplicate = kids.find(k => k.id !== id && k.name.trim().toLowerCase() === newName);
      if (duplicate) {
        return res.status(400).json({ error: `A kid named "${name.trim()}" already exists` });
      }
      const kid = await storage.updateKid(id, userId, { name: name.trim() });
      if (!kid) {
        return res.status(404).json({ error: "Kid not found" });
      }
      res.json(kid);
    } catch (error) {
      res.status(500).json({ error: "Failed to update kid" });
    }
  });

  app.post("/api/kids/cleanup-duplicates", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const kids = await storage.getKids(userId);
      const grouped = new Map<string, Kid[]>();
      for (const kid of kids) {
        const key = kid.name.toLowerCase().trim();
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(kid);
      }

      let hasDups = false;
      for (const g of Array.from(grouped.values())) { if (g.length > 1) { hasDups = true; break; } }
      if (!hasDups) return res.json({ removed: 0 });

      const videos = await storage.getVideos(userId);
      const deleteIds: string[] = [];

      for (const group of Array.from(grouped.values())) {
        if (group.length <= 1) continue;
        group.sort((a: Kid, b: Kid) => a.id.localeCompare(b.id));
        const keeper = group[0];
        for (let i = 1; i < group.length; i++) {
          const dupId = group[i].id;
          deleteIds.push(dupId);
          for (const video of videos) {
            if (video.assigned[dupId]) {
              video.assigned[keeper.id] = true;
              delete video.assigned[dupId];
            }
            if (video.progress[dupId]) {
              if (!video.progress[keeper.id]?.watched) {
                video.progress[keeper.id] = video.progress[dupId];
              }
              delete video.progress[dupId];
            }
          }
        }
      }

      for (const video of videos) {
        await db.update(videosTable)
          .set({ assigned: video.assigned, progress: video.progress })
          .where(eq(videosTable.id, video.id));
      }
      for (const dupId of deleteIds) {
        await storage.deleteKid(dupId, userId);
      }
      res.json({ removed: deleteIds.length });
    } catch (error) {
      res.status(500).json({ error: "Failed to clean up duplicates" });
    }
  });

  app.delete("/api/kids/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = req.params.id as string;
      const deleted = await storage.deleteKid(id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Kid not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete kid" });
    }
  });

  app.get("/api/folders", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const folders = await storage.getFolders(userId);
      res.json(folders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch folders" });
    }
  });

  app.post("/api/folders", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = insertFolderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const folder = await storage.createFolder(parsed.data, userId);
      res.status(201).json(folder);
    } catch (error) {
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  app.patch("/api/folders/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = req.params.id as string;
      const { name } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: "Name is required" });
      }
      const folder = await storage.updateFolder(id, userId, { name: name.trim() });
      if (!folder) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json(folder);
    } catch (error) {
      res.status(500).json({ error: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = req.params.id as string;
      await storage.deleteFolder(id, userId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  const masterCleanedUp = new Set<string>();
  app.get("/api/videos", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (MASTER_USER_ID && userId === MASTER_USER_ID && !masterCleanedUp.has(userId)) {
        await storage.cleanupGlobalData(userId);
        masterCleanedUp.add(userId);
      }
      if (MASTER_USER_ID && userId !== MASTER_USER_ID) {
        await storage.syncAllSubscriptions(userId, MASTER_USER_ID);
      }
      const videos = await storage.getVideos(userId);
      res.json(videos);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch videos" });
    }
  });

  app.post("/api/videos", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = insertVideoSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      const allKids = await storage.getKids(userId);
      const result = await storage.createVideo(parsed.data.url, parsed.data.kidIds, allKids, userId, parsed.data.folderId, parsed.data.priority);
      
      if (!result.video) {
        return res.status(400).json({ error: result.error || "Failed to add video" });
      }

      res.status(201).json(result.video);
    } catch (error) {
      res.status(500).json({ error: "Failed to create video" });
    }
  });

  app.patch("/api/videos/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = req.params.id as string;
      const { priority, folderId } = req.body;
      
      const updates: { priority?: number; folderId?: string | null } = {};
      if (priority !== undefined) updates.priority = Math.min(9, Math.max(1, parseInt(priority)));
      if (folderId !== undefined) updates.folderId = folderId;
      
      const video = await storage.updateVideo(id, userId, updates);
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }
      res.json(video);
    } catch (error) {
      res.status(500).json({ error: "Failed to update video" });
    }
  });

  app.delete("/api/videos/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const id = req.params.id as string;
      const deleted = await storage.deleteVideo(id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Video not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete video" });
    }
  });

  app.post("/api/videos/:videoId/watched/:kidId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const videoId = req.params.videoId as string;
      const kidId = req.params.kidId as string;
      const { voiceRecording } = req.body;
      
      if (!voiceRecording || typeof voiceRecording.recordedAt !== 'string' || typeof voiceRecording.duration !== 'number' || voiceRecording.duration <= 0) {
        return res.status(400).json({ error: "A valid voice recording with duration > 0 is required to complete the video" });
      }

      const result = await storage.markVideoWatched(videoId, kidId, voiceRecording, userId);
      
      if (!result.video) {
        return res.status(400).json({ error: result.error || "Failed to mark video as watched" });
      }

      res.json(result.video);
    } catch (error) {
      res.status(500).json({ error: "Failed to mark video as watched" });
    }
  });

  app.get("/api/public/kid/:kidId", async (req: Request, res: Response) => {
    try {
      const kidId = req.params.kidId as string;
      const kid = await storage.getKidById(kidId);
      if (!kid) {
        return res.status(404).json({ error: "Kid not found" });
      }
      res.json({ id: kid.id, name: kid.name, avatar: kid.avatar });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch kid" });
    }
  });

  app.get("/api/public/kid/:kidId/videos", async (req: Request, res: Response) => {
    try {
      const kidId = req.params.kidId as string;
      const kid = await storage.getKidById(kidId);
      if (!kid) {
        return res.status(404).json({ error: "Kid not found" });
      }
      const allVideos = await storage.getVideosByOwner(kid.userId);
      const kidVideos = allVideos.filter(v => v.assigned?.[kidId]);
      res.json(kidVideos);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch videos" });
    }
  });

  app.get("/api/public/kid/:kidId/folders", async (req: Request, res: Response) => {
    try {
      const kidId = req.params.kidId as string;
      const kid = await storage.getKidById(kidId);
      if (!kid) {
        return res.status(404).json({ error: "Kid not found" });
      }
      const folders = await storage.getFoldersByOwner(kid.userId);
      res.json(folders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch folders" });
    }
  });

  app.post("/api/public/kid/:kidId/videos/:videoId/watched", async (req: Request, res: Response) => {
    try {
      const kidId = req.params.kidId as string;
      const videoId = req.params.videoId as string;
      const { voiceRecording } = req.body;

      if (!voiceRecording || typeof voiceRecording.recordedAt !== 'string' || typeof voiceRecording.duration !== 'number' || voiceRecording.duration <= 0) {
        return res.status(400).json({ error: "A valid voice recording with duration > 0 is required to complete the video" });
      }

      const kid = await storage.getKidById(kidId);
      if (!kid) {
        return res.status(404).json({ error: "Kid not found" });
      }

      const result = await storage.markVideoWatchedPublic(videoId, kidId, voiceRecording, kid.userId);

      if (!result.video) {
        return res.status(400).json({ error: result.error || "Failed to mark video as watched" });
      }

      res.json(result.video);
    } catch (error) {
      res.status(500).json({ error: "Failed to mark video as watched" });
    }
  });

  // Badge count endpoints
  app.get("/api/badge/parent", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const count = await storage.getBadgeCountForParent(userId);
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get badge count" });
    }
  });

  app.post("/api/badge/parent/clear", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      await storage.clearParentBadge(userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear badge" });
    }
  });

  app.get("/api/badge/kid/:kidId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const kidId = req.params.kidId as string;
      const count = await storage.getBadgeCountForKid(kidId, userId);
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get badge count" });
    }
  });

  // Public badge endpoint for kid PWA (uses same public kid endpoint pattern)
  app.get("/api/public/kid/:kidId/badge", async (req: Request, res: Response) => {
    try {
      const kidId = req.params.kidId as string;
      if (!kidId || kidId.length < 10) {
        return res.status(404).json({ count: 0 });
      }
      const kid = await storage.getKidById(kidId);
      if (!kid) {
        return res.status(404).json({ count: 0 });
      }
      const count = await storage.getBadgeCountForKid(kidId, kid.userId);
      res.json({ count });
    } catch (error) {
      res.json({ count: 0 });
    }
  });

  app.get("/api/download-source", async (_req: Request, res: Response) => {
    const zipPath = path.resolve(process.cwd(), "client/public/kid-video-app-source.zip");
    const txtPath = path.resolve(process.cwd(), "client/public/source-export.txt");
    const { existsSync, createReadStream } = await import("fs");
    if (existsSync(zipPath)) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", "attachment; filename=kid-video-app-source.zip");
      createReadStream(zipPath).pipe(res);
    } else if (existsSync(txtPath)) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      createReadStream(txtPath).pipe(res);
    } else {
      res.status(404).json({ error: "Source file not found" });
    }
  });

  app.get("/api/download-icon", (_req: Request, res: Response) => {
    const iconPath = path.resolve(process.cwd(), "client/public/favicon.png");
    res.download(iconPath, "kid-video-app-icon.png", (err) => {
      if (err) {
        res.status(404).json({ error: "Icon not found" });
      }
    });
  });

  const MASTER_USER_ID = process.env.MASTER_USER_ID || '';

  app.get("/api/global/is-master", isAuthenticated, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    res.json({ isMaster: !!MASTER_USER_ID && userId === MASTER_USER_ID });
  });

  app.get("/api/global/playlists", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!MASTER_USER_ID) return res.json([]);
      const foldersWithCounts = await storage.getGlobalFoldersWithCounts(MASTER_USER_ID);
      res.json(foldersWithCounts);
    } catch (error) {
      console.error("Failed to get global playlists:", error);
      res.status(500).json({ error: "Failed to get global playlists" });
    }
  });

  app.get("/api/global/playlists/:id/videos", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!MASTER_USER_ID) return res.json([]);
      const videos = await storage.getGlobalVideos(MASTER_USER_ID, req.params.id as string);
      res.json(videos);
    } catch (error) {
      res.status(500).json({ error: "Failed to get global playlist videos" });
    }
  });

  app.get("/api/global/subscriptions", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const subs = await storage.getSubscriptions(userId);
      res.json(subs);
    } catch (error) {
      res.status(500).json({ error: "Failed to get subscriptions" });
    }
  });

  app.post("/api/global/subscribe", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!MASTER_USER_ID) return res.status(400).json({ error: "No master account configured" });
      if (userId === MASTER_USER_ID) return res.status(400).json({ error: "You already own these playlists" });
      const parsed = insertGlobalSubscriptionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const masterFolders = await storage.getGlobalFolders(MASTER_USER_ID);
      const folderExists = masterFolders.some(f => f.id === parsed.data.masterFolderId);
      if (!folderExists) return res.status(404).json({ error: "Playlist not found" });
      const sub = await storage.subscribe(userId, parsed.data.masterFolderId, parsed.data.kidIds, MASTER_USER_ID);
      res.status(201).json(sub);
    } catch (error) {
      console.error("Failed to subscribe:", error);
      res.status(500).json({ error: "Failed to subscribe" });
    }
  });

  app.post("/api/global/unsubscribe", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = insertGlobalSubscriptionSchema.pick({ masterFolderId: true }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      await storage.unsubscribe(userId, parsed.data.masterFolderId);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to unsubscribe:", error);
      res.status(500).json({ error: "Failed to unsubscribe" });
    }
  });

  app.post("/api/global/sync", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!MASTER_USER_ID) return res.status(400).json({ error: "No master account configured" });
      const parsed = insertGlobalSubscriptionSchema.pick({ masterFolderId: true }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      await storage.syncSubscription(userId, parsed.data.masterFolderId, MASTER_USER_ID);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to sync" });
    }
  });

  app.post("/api/feedback", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const parsed = insertFeedbackSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const feedback = await storage.createFeedback(parsed.data, userId);
      res.status(201).json(feedback);
    } catch (error) {
      console.error("Failed to create feedback:", error);
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  });

  return httpServer;
}
