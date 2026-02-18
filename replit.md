# Kid Video App

## Overview

A kid-friendly YouTube video watching application where parents can manage a curated playlist of videos for their children. Parents add YouTube video URLs and assign them to kids (up to 6 children), while kids can watch videos in a safe, distraction-free environment. Videos must be completed before being marked as watched.

## Recent Changes (February 2026)
- Added trial status display in parent dashboard: shows countdown (30-15 days), freezes to "upgrade anytime" (<=15 days), hidden after 30 days or for expired trials
- Added master admin / global playlists system: app developer (MASTER_USER_ID env var) creates global playlists; parents can subscribe to add them to their kids' libraries
- Global playlist subscription copies master videos into parent's library with "Curated" badge; auto-syncs new videos on every dashboard load
- Added "Move to folder" button on each video in library (FolderPlus icon) - move unfiled videos into folders without losing recordings
- Custom YouTube player for kid mode: distraction-free with play/pause, rewind 10s, fast-forward 10s, scrub bar, and time display (uses YouTube IFrame API with controls=0)
- Progress tracking now uses actual watched time (only counts when playing, pauses don't count)
- Fixed "Last 7 Days" stats to always show rolling 7-day total regardless of which day it is
- Renamed "Folder" to "Playlist" throughout the UI
- Added inline "Add Kid" on parent home screen (between header and Add Video card)
- Added "Download App Icon" button in the Add to Home Screen dialog
- Added direct icon download endpoint at /api/download-icon
- Added PWA badge counts on home screen icons (WhatsApp-style): kids see unwatched video count, parents see new completion count
- Improved voice recording UX: larger timer, re-record option, 0-second recordings rejected with feedback
- Fixed error messages showing raw JSON - now displays clean user-friendly text
- Fixed kids list not updating after adding a kid (queryFn override bug)
- Added multi-family support with Replit Auth - each family has separate private data (kids, videos, folders)
- Added feedback system with 4 input types: text, voice recording, video link, screenshot
- Parent mode header now includes: feedback button, settings button, logout button
- Landing page for unauthenticated users with features showcase and login

## Recent Changes (January 2026)
- Added quick priority editing: tap the Lv.X button on any video in library to cycle through levels 1-9
- Improved paste button UX: now pastes directly without confirmation toast
- Added TikTok video support (add TikTok links, embedded playback within app)
- Added paste button for quickly pasting video links from clipboard
- Added folder renaming feature (click pencil icon to edit folder names)
- Added PWA support with per-kid home screen shortcuts (copy kid link at /kid/:kidId, add to home screen on iOS/Android)
- Added "Add to Home Screen" button in kid mode with platform-specific instructions (iOS/Android)
- Added folder organization for videos (create folders like "Crude Oil Videos", assign videos to folders)
- Added video preview/play feature in parent mode (click thumbnail or play button to preview before assigning)
- Video library now organized by collapsible folders with "Unfiled" section for videos without folders
- Added multi-select kid assignment when adding videos (can assign to specific kids or "all kids")
- Added voice recording requirement for video completion (kids must record voice description after watching)
- Implemented max 4 views per video limit with UI feedback (view count badges, red warning when maxed)
- Backend validation for voice recording duration > 0
- Added data-testids to all interactive and key display elements
- Fixed hover/active class violations in buttons per design guidelines
- Moved "Add Kid" functionality to settings dialog (accessible via settings icon in header)
- Added per-kid stats summary badges showing watched/total video counts on parent home screen
- Enhanced voice recording to save audio data (base64 data URL) for parent playback
- Added playback buttons for kid voice recordings in video library (parents can listen to kid recordings)
- Made UI more compact with smaller fonts throughout

## Core Features
- **Master Admin / Global Playlists**: App developer (MASTER_USER_ID) creates global playlists; parents subscribe to add curated videos to their kids' libraries. Subscribed playlists show "Curated" badge and auto-sync new videos.
- **Parent Mode**: Add kids (max 6), create folders, add YouTube videos with folder/kid selection, preview videos, manage video library
- **Folder Organization**: Create named folders (e.g., "Crude Oil Videos") to organize videos; videos grouped by folder in library
- **Video Preview**: Parents can preview videos before assigning by clicking thumbnail or play button
- **Kid Mode**: Select kid profile, view assigned videos organized by folders/topics, watch videos in embedded player
- **Video Completion**: 2-step completion: 1) watch video (3 second demo timeout), 2) record voice description
- **Voice Recording**: Press-and-hold mic button to record what was learned from the video
- **Video Priority**: Parents set priority levels 1-9 (1=basic, 9=advanced); kids must watch lower-level videos before unlocking advanced ones in each folder
- **View Limits**: Each video can be watched max 4 times total; videos at limit are disabled with red warning
- **Progress Tracking**: Each kid has separate watched/pending statistics
- **PWA Badge Counts**: Home screen icons show notification badges - kids see unwatched video count, parents see new completion count from all kids

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight alternative to React Router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Build Tool**: Vite with hot module replacement

### Backend Architecture
- **Framework**: Express 5 (ES modules)
- **Runtime**: Node.js with tsx for TypeScript execution
- **API Design**: RESTful JSON API under `/api/*` prefix
- **Storage**: In-memory storage with interface abstraction (IStorage) for future database migration

### Data Storage
- **Current**: PostgreSQL database with Drizzle ORM for persistent storage
- **Schema**: Drizzle ORM with PostgreSQL dialect - tables: `kids`, `folders`, `videos`
- **Validation**: Zod schemas shared between client and server in `/shared/schema.ts`
- **Connection**: Node-postgres (pg) driver via `server/db/index.ts`

### Key Design Patterns
- **Shared Types**: Common schemas and types in `/shared` directory imported by both client and server
- **Path Aliases**: `@/` for client source, `@shared/` for shared code
- **Storage Interface**: Abstract storage interface allows swapping between memory and database storage

### Build System
- **Development**: Vite dev server with Express backend via middleware
- **Production**: Vite builds to `dist/public`, esbuild bundles server to `dist/index.cjs`
- **Database**: `npm run db:push` for Drizzle schema migrations

## External Dependencies

### Database
- **PostgreSQL**: Configured via `DATABASE_URL` environment variable
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Session Store**: connect-pg-simple for session persistence (available but not currently used)

### Third-Party Services
- **YouTube**: Extracts video IDs from YouTube URLs (watch, youtu.be, shorts, embed formats)
- **TikTok**: Extracts video IDs from TikTok URLs, auto-resolves short links (vm.tiktok.com, tiktok.com/t/) to full URLs server-side
- No external API integrations currently active

### Key npm Packages
- **UI**: Full shadcn/ui component suite (40+ Radix UI components)
- **Data Fetching**: @tanstack/react-query
- **Validation**: zod, drizzle-zod
- **Utilities**: date-fns, clsx, class-variance-authority