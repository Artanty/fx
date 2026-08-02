export interface FilterOption {
  name: string;
  slug?: string;
  count: number;
}

export interface Filters {
  families: FilterOption[];
  algorithms: FilterOption[];
  categories: FilterOption[];
  tags: FilterOption[];
  extensions: FilterOption[];
}

export interface PatchItem {
  file_id: number;
  patch_id: number;
  slug: string;
  title: string;
  url: string;
  author: string | null;
  revision: string | null;
  updated_at: string | null;
  download_count: number;
  view_count: number;
  like_count: number;
  license: string | null;
  artwork_url: string | null;
  filename: string;
  extension: string;
  preset_name: string | null;
  algorithm: string | null;
  secondary_algorithm: string | null;
  effect_family: string | null;
  path: string | null;
  filesize: number;
  notes: string | null;
  categories: string[];
  tags: string[];
}

export interface PatchesResponse {
  total: number;
  page: number;
  per_page: number;
  pages: number;
  items: PatchItem[];
}

export interface PatchDetail {
  id: number;
  slug: string;
  title: string;
  url: string;
  excerpt: string;
  content: string;
  revision: string | null;
  author: string | null;
  created_at: string | null;
  updated_at: string | null;
  view_count: number;
  like_count: number;
  download_count: number;
  comment_count: number;
  license: string | null;
  artwork_url: string | null;
  file_id: number;
  filename: string;
  extension: string;
  preset_name: string | null;
  algorithm: string | null;
  secondary_algorithm: string | null;
  effect_family: string | null;
  path: string | null;
  filesize: number;
  notes: string | null;
  categories: string[];
  tags: string[];
  tag_slugs: string[];
}

export interface PatchParams {
  families?: string[];
  algorithms?: string[];
  categories?: string[];
  tags?: string[];
  extensions?: string[];
  q?: string;
  sort?: string;
  page?: number;
  per_page?: number;
}
