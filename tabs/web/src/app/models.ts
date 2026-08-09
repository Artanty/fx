export interface Artist {
  id: number;
  name: string;
  slug: string;
  song_count: number;
}

export interface ArtistSong {
  id: number;
  title: string;
  tab_count: number;
  tempo: number | null;
}

export interface TrackInfo {
  name: string;
  shortName: string;
  program: number | undefined;
  isPercussion: boolean;
  tunings: number[][];
  capo: number;
}

export interface TabItem {
  id: number;
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
}

export interface TabDetail extends TabItem {
  artist_id: number;
  artist: string;
  song_id: number;
  song_title: string;
  created_at: string;
  path: string;
}

export interface SongDetail {
  id: number;
  title: string;
  artist_id: number;
  artist: string;
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
