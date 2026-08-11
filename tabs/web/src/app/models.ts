export interface Artist {
  id: number;
  name: string;
  slug: string;
  song_count: number;
  favorited?: boolean;
}

export interface ArtistSong {
  id: number;
  title: string;
  tab_count: number;
  tempo: number | null;
  favorited?: boolean;
}

export interface TrackInfo {
  id: number;
  name: string;
  shortName: string;
  program: number | undefined;
  isPercussion: boolean;
  tunings: number[][];
  capo: number;
}

export interface TabItem {
  id: number;
  kind: string;
  title: string | null;
  album: string | null;
  tempo: number | null;
  gp_version: string | null;
  measures: number | null;
  capo: number;
  tunings: number[][];
  tracks: TrackInfo[];
  file_id: number;
  filename: string;
  ext: string;
  size: number;
  ug_type?: string;
  rating?: number;
  votes?: number;
  url?: string;
  favorited?: boolean;
  folders?: { id: number; name: string }[];
}

export interface TabDetail extends TabItem {
  artist_id: number;
  artist: string;
  song_id: number;
  song_title: string;
  created_at: string;
  path: string;
  favorited?: boolean;
  folders?: { id: number; name: string }[];
}

export interface UgTabDetail {
  id: number;
  kind: string;
  title: string | null;
  ug_type: string;
  rating: number;
  votes: number;
  version: number;
  difficulty: string | null;
  url: string;
  content: string;
  created_at: string;
  artist_id: number;
  artist: string;
  song_id: number;
  song_title: string;
  favorited?: boolean;
  folders?: { id: number; name: string }[];
}

export interface UgSearchResult {
  id: number;
  url: string;
  artist: string;
  song: string;
  type: string;
  version: number;
  votes: number;
  rating: number;
  difficulty: string | null;
  date: number | null;
}

export interface SongDetail {
  id: number;
  title: string;
  artist_id: number;
  artist: string;
  favorited?: boolean;
}

export interface SearchHit {
  rank: number;
  id: number;
  title: string | null;
  artist: string;
  album: string | null;
  artist_id: number;
  song_id: number;
}

export interface ImportStatus {
  pending: number;
  indexed: number;
  error: number;
  total: number;
  artists: number;
  songs: number;
  tabs: number;
}

export interface Folder {
  id: number;
  name: string;
  tab_count: number;
}

export interface LibraryTabItem {
  id: number;
  kind: string;
  title: string | null;
  artist: string;
  artist_id: number;
  song_id: number;
  song_title: string;
  album: string | null;
  tempo: number | null;
  gp_version: string | null;
  measures: number | null;
  ug_type: string | null;
  rating: number | null;
  votes: number | null;
  favorited: boolean;
  folders: { id: number; name: string }[];
}

export interface FavoriteStatus {
  artists: number[];
  songs: number[];
  tabs: { id: number; kind: string }[];
}

export interface FavoriteTabRef {
  id: number;
  kind: string;
}

export interface Chord {
  id: number;
  root: string;
  quality: string;
  name: string;
  notes: string;
  base_fret: number;
  frets: string;
}
